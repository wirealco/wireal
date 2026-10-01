using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Wireal.Api.Data;

namespace Wireal.Api.Auth;

public sealed class PasswordWork(IPasswordHasher<AppUser> hasher)
{
    public AppUser DummyUser { get; } = new();
    public string DummyHash { get; } = hasher.HashPassword(new AppUser(), TokenService.RandomToken());
}

public sealed class AccountService(AppDbContext db, IPasswordHasher<AppUser> passwords, PasswordWork work,
    TokenService tokens, JwtSettings jwt, IConfiguration config, CloudflareEmailSettings email,
    IDataProtectionProvider protection, TimeProvider clock, ILogger<AccountService> logger)
{
    public async Task RegisterAsync(string email, string password, string displayName, CancellationToken ct)
    {
        var normalized = EmailAddress.Normalize(email)!;
        // Perform password hashing for invited, existing and unknown addresses alike.
        var user = new AppUser { Email = email.Trim(), NormalizedEmail = normalized, DisplayName = displayName.Trim() };
        user.PasswordHash = passwords.HashPassword(user, password);
        // Every outcome answers 202 so the form cannot be used to discover who
        // holds an account, which leaves the log as the only place that says
        // whether an email was queued. It names no address.
        var permitted = RegistrationPolicy.AllowsEmail(config, email) ||
            await Wireal.Api.Projects.WorkspaceTeams.Invited(db, "email", normalized, ct);
        if (!permitted || await db.Users.AnyAsync(x => x.NormalizedEmail == normalized, ct))
        {
            logger.LogInformation("Registration ignored ({Reason})", permitted ? "already registered" : "not permitted");
            return;
        }
        db.Users.Add(user);
        QueueVerification(user);
        try
        {
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Registration queued verification for user {UserId}", user.Id);
        }
        catch (DbUpdateException) // A concurrent registration may have won the unique email index.
        {
            db.ChangeTracker.Clear();
            if (!await db.Users.AnyAsync(x => x.NormalizedEmail == normalized, ct)) throw;
            logger.LogInformation("Registration ignored (already registered)");
        }
    }

    public async Task ResendAsync(string email, CancellationToken ct)
    {
        var normalized = EmailAddress.Normalize(email);
        if (normalized is null) return;
        var user = await db.Users.SingleOrDefaultAsync(x => x.NormalizedEmail == normalized, ct);
        var now = clock.GetUtcNow().UtcDateTime;
        var refusal =
            user is null ? "unknown address"
            : user.Disabled ? "account disabled"
            : user.EmailVerified ? "already verified"
            : user.PasswordHash is null ? "external account"
            : user.LastVerificationSentAt > now.AddMinutes(-2) ? "throttled"
            // Two-minute spacing caps the rate; this caps the total, which is what a
            // fixed daily quota at the provider actually needs.
            : await RationedAsync(user.Id, now, ct) ? "daily limit"
            : null;
        if (refusal is not null)
        {
            logger.LogInformation("Verification resend ignored ({Reason})", refusal);
            return;
        }
        QueueVerification(user!);
        try
        {
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Verification resend queued for user {UserId}", user!.Id);
        }
        catch (DbUpdateConcurrencyException) { db.ChangeTracker.Clear(); }
    }

    public async Task ChangeEmailAsync(AppUser user, string email, CancellationToken ct)
    {
        var normalized = EmailAddress.Normalize(email)!;
        if (user.NormalizedEmail == normalized || await db.Users.AnyAsync(x => x.NormalizedEmail == normalized, ct)) return;
        var now = clock.GetUtcNow().UtcDateTime;
        if (user.LastVerificationSentAt > now.AddMinutes(-2))
            throw new Wireal.Api.Projects.DataFault("Wait two minutes before requesting another verification email.", 429);
        // Said out loud here, unlike a resend: the caller is signed in as this account, so
        // the limit tells them nothing they could not already learn.
        if (await RationedAsync(user.Id, now, ct))
            throw new Wireal.Api.Projects.DataFault("This account has requested too many verification emails today. Try again tomorrow.", 429);
        var pending = await db.EmailVerifications.Where(x => x.UserId == user.Id && x.ConsumedAt == null).ToListAsync(ct);
        foreach (var verification in pending) verification.ConsumedAt = clock.GetUtcNow().UtcDateTime;
        QueueVerification(user, email.Trim());
    }

    /// <summary>Whether this account has already asked for its day's verification emails.
    /// Counted where the send was requested, so a message still waiting in the outbox counts
    /// as much as one the provider took.</summary>
    private async Task<bool> RationedAsync(Guid userId, DateTime now, CancellationToken ct) =>
        await db.EmailOutbox.Where(x => x.CreatedAt > now.AddDays(-1))
            .Join(db.EmailVerifications, x => x.VerificationId, x => x.Id, (_, verification) => verification.UserId)
            .CountAsync(id => id == userId, ct) >= email.PerAccountDailyLimit;

    private void QueueVerification(AppUser user, string? pendingEmail = null)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var raw = TokenService.RandomToken();
        var verification = new EmailVerification
        {
            User = user, Hash = TokenService.Hash(raw), ExpiresAt = now.AddMinutes(30), PendingEmail = pendingEmail
        };
        // The fragment is never transmitted in an HTTP request or Referer header.
        var url = new Uri(new Uri(config["App:ClientOrigin"]!), $"/verify-email#verify={raw}").AbsoluteUri;
        db.EmailVerifications.Add(verification);
        db.EmailOutbox.Add(new EmailOutboxMessage
        {
            VerificationId = verification.Id, CreatedAt = now, NextAttemptAt = now,
            ProtectedPayload = protection.CreateProtector(EmailOutboxProcessor.ProtectionPurpose)
                .Protect(JsonSerializer.Serialize(new VerificationMail(pendingEmail ?? user.Email!, url)))
        });
        user.LastVerificationSentAt = now;
    }

    public async Task<bool> VerifyEmailAsync(string raw, CancellationToken ct)
    {
        if (raw.Length != 43) return false;
        var hash = TokenService.Hash(raw);
        var verification = await db.EmailVerifications.Include(x => x.User).SingleOrDefaultAsync(x => x.Hash == hash, ct);
        var now = clock.GetUtcNow().UtcDateTime;
        if (verification is null || verification.ConsumedAt != null || verification.ExpiresAt <= now || verification.User.Disabled) return false;
        verification.ConsumedAt = now;
        if (verification.PendingEmail is not null)
        {
            var normalized = EmailAddress.Normalize(verification.PendingEmail)!;
            if (await db.Users.AnyAsync(x => x.Id != verification.UserId && x.NormalizedEmail == normalized, ct)) return false;
            verification.User.Email = verification.PendingEmail;
            verification.User.NormalizedEmail = normalized;
        }
        verification.User.EmailVerified = true;
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return false; }
        logger.LogInformation("Email verified for user {UserId}", verification.UserId);
        return true;
    }

    public async Task<IssuedTokens?> LoginAsync(string email, string password, CancellationToken ct)
    {
        var normalized = EmailAddress.Normalize(email);
        if (normalized is null) return null;
        var user = await db.Users.SingleOrDefaultAsync(x => x.NormalizedEmail == normalized, ct);
        var check = passwords.VerifyHashedPassword(user ?? work.DummyUser, user?.PasswordHash ?? work.DummyHash, password);
        var now = clock.GetUtcNow().UtcDateTime;
        if (user is null || user.PasswordHash is null || user.Disabled || user.LockoutEnd > now) return null;
        if (check == PasswordVerificationResult.Failed)
        {
            // Atomic SQL update counts concurrent failures instead of losing increments.
            await db.Users.Where(x => x.Id == user.Id && (x.LockoutEnd == null || x.LockoutEnd <= now))
                .ExecuteUpdateAsync(update => update
                    .SetProperty(x => x.FailedLoginCount, x => x.FailedLoginCount >= 4 ? 0 : x.FailedLoginCount + 1)
                    .SetProperty(x => x.LockoutEnd, x => x.FailedLoginCount >= 4 ? now.AddMinutes(15) : x.LockoutEnd)
                    .SetProperty(x => x.Version, Guid.NewGuid()), ct);
            return null;
        }
        if (!user.EmailVerified) return null;
        user.FailedLoginCount = 0;
        user.LockoutEnd = null;
        if (check == PasswordVerificationResult.SuccessRehashNeeded) user.PasswordHash = passwords.HashPassword(user, password);
        var session = new AuthSession { User = user, ExpiresAt = now.AddDays(jwt.SessionDays) };
        db.AuthSessions.Add(session);
        var issued = AddRefresh(user, session);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return null; }
        logger.LogInformation("Password session created for user {UserId}", user.Id);
        return issued;
    }

    public async Task<IssuedTokens?> ExchangeAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        if (!Guid.TryParse(principal.FindFirstValue("sid"), out var sid)) return null;
        var now = clock.GetUtcNow().UtcDateTime;
        var session = await db.AuthSessions.Include(x => x.User).SingleOrDefaultAsync(x => x.Id == sid, ct);
        if (session is null || session.RevokedAt != null || session.ExpiresAt <= now || session.User.Disabled || session.BridgeExchangedAt != null) return null;
        session.BridgeExchangedAt = now;
        var issued = AddRefresh(session.User, session);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return null; }
        return issued;
    }

    private IssuedTokens AddRefresh(AppUser user, AuthSession session)
    {
        var raw = TokenService.RandomToken();
        db.RefreshTokens.Add(new RefreshToken { Session = session, Hash = TokenService.Hash(raw) });
        return new(tokens.Access(user, session), raw, session.ExpiresAt);
    }

    public async Task<IssuedTokens?> RefreshAsync(string? raw, CancellationToken ct)
    {
        if (raw?.Length != 43) return null;
        var hash = TokenService.Hash(raw);
        var refresh = await db.RefreshTokens.Include(x => x.Session).ThenInclude(x => x.User)
            .SingleOrDefaultAsync(x => x.Hash == hash, ct);
        var now = clock.GetUtcNow().UtcDateTime;
        if (refresh is null) return null;
        if (refresh.ConsumedAt != null)
        {
            await RevokeAsync(refresh.SessionId, ct);
            logger.LogWarning("Refresh replay revoked session {SessionId}", refresh.SessionId);
            return null;
        }
        if (refresh.Session.RevokedAt != null || refresh.Session.ExpiresAt <= now || refresh.Session.User.Disabled) return null;
        refresh.ConsumedAt = now;
        var issued = AddRefresh(refresh.Session.User, refresh.Session);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            await RevokeAsync(refresh.SessionId, ct);
            return null;
        }
        return issued;
    }

    public async Task LogoutAsync(ClaimsPrincipal principal, string? rawRefresh, CancellationToken ct)
    {
        if (Guid.TryParse(principal.FindFirstValue("sid"), out var sid)) await RevokeAsync(sid, ct);
        if (rawRefresh?.Length == 43)
        {
            var hash = TokenService.Hash(rawRefresh);
            var token = await db.RefreshTokens.AsNoTracking().SingleOrDefaultAsync(x => x.Hash == hash, ct);
            if (token != null) await RevokeAsync(token.SessionId, ct);
        }
    }

    private Task<int> RevokeAsync(Guid id, CancellationToken ct) => db.AuthSessions.Where(x => x.Id == id && x.RevokedAt == null)
        .ExecuteUpdateAsync(update => update.SetProperty(x => x.RevokedAt, clock.GetUtcNow().UtcDateTime), ct);
}
