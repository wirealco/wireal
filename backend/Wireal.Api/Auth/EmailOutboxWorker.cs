using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Wireal.Api.Data;

namespace Wireal.Api.Auth;

public sealed record VerificationMail(string Recipient, string Url);

public sealed class EmailOutboxProcessor(AppDbContext db, IDataProtectionProvider protection,
    IVerificationEmailSender sender, CloudflareEmailSettings settings, TimeProvider clock,
    ILogger<EmailOutboxProcessor> logger)
{
    public const string ProtectionPurpose = "Wireal.VerificationMail.v1";

    public async Task ProcessBatchAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var messages = await db.EmailOutbox.Where(x => x.CompletedAt == null && x.NextAttemptAt <= now)
            .OrderBy(x => x.NextAttemptAt).Take(10).ToListAsync(cancellationToken);
        if (messages.Count == 0) return;
        // Every send this UTC day, counted where the quota is actually spent rather than
        // where a message was asked for: registration, resend and email change all pass here.
        var spent = await db.EmailOutbox.CountAsync(x => x.SentAt >= now.Date, cancellationToken);
        foreach (var message in messages)
        {
            if (spent >= settings.DailyBudget)
            {
                // The budget belongs to the day, not to this message, so hold it for the
                // next one instead of spending an attempt on a send that will not go out.
                message.NextAttemptAt = now.Date.AddDays(1);
                logger.LogWarning("Daily email budget {Budget} is spent; outbox {MessageId} held until tomorrow",
                    settings.DailyBudget, message.Id);
                try { await db.SaveChangesAsync(cancellationToken); }
                catch (DbUpdateConcurrencyException) { db.Entry(message).State = EntityState.Detached; }
                continue;
            }
            // Optimistic lease allows another process to win without sending twice.
            message.NextAttemptAt = now.AddMinutes(2);
            message.Attempts++;
            try { await db.SaveChangesAsync(cancellationToken); }
            catch (DbUpdateConcurrencyException) { db.Entry(message).State = EntityState.Detached; continue; }
            var verification = await db.EmailVerifications.AsNoTracking()
                .SingleAsync(x => x.Id == message.VerificationId, cancellationToken);
            if (verification.ConsumedAt != null || verification.ExpiresAt <= now || message.Attempts > 6)
            {
                message.CompletedAt = now;
                message.ProtectedPayload = "";
                logger.LogWarning("Verification delivery expired or exhausted for outbox {MessageId}", message.Id);
            }
            else
            {
                try
                {
                    var payload = protection.CreateProtector(ProtectionPurpose).Unprotect(message.ProtectedPayload);
                    var mail = JsonSerializer.Deserialize<VerificationMail>(payload)!;
                    await sender.SendAsync(mail.Recipient, mail.Url, cancellationToken);
                    message.SentAt = message.CompletedAt = clock.GetUtcNow().UtcDateTime;
                    message.ProtectedPayload = "";
                    spent++;
                    logger.LogInformation("Verification email accepted by provider for outbox {MessageId} ({Spent}/{Budget} today)",
                        message.Id, spent, settings.DailyBudget);
                }
                // A refusal the provider will repeat — a bounced or suppressed
                // address, a rejected request — is finished, not pending.
                catch (EmailDeliveryException refusal) when (refusal.Permanent && !cancellationToken.IsCancellationRequested)
                {
                    message.CompletedAt = clock.GetUtcNow().UtcDateTime;
                    message.ProtectedPayload = "";
                    logger.LogWarning("Verification delivery refused for outbox {MessageId} ({Reason}); no further attempts",
                        message.Id, refusal.Reason);
                }
                catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
                {
                    message.NextAttemptAt = clock.GetUtcNow().UtcDateTime.AddSeconds(Math.Min(300, 15 * Math.Pow(2, message.Attempts)));
                    logger.LogWarning("Verification delivery retry {Attempt} for outbox {MessageId} ({FailureType}: {Reason})",
                        message.Attempts, message.Id, exception.GetType().Name,
                        exception is EmailDeliveryException delivery ? delivery.Reason : "unexpected");
                }
            }
            await db.SaveChangesAsync(cancellationToken);
        }
    }
}

public sealed class EmailOutboxWorker(IServiceScopeFactory scopes, ILogger<EmailOutboxWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<EmailOutboxProcessor>().ProcessBatchAsync(stoppingToken);
            }
            catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogError("Email outbox processing failed ({FailureType})", exception.GetType().Name);
            }
        }
    }
}
