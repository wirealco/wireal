using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Wireal.Api.Auth;

public interface ITurnstileVerifier
{
    Task<bool> VerifyAsync(string? token, string action, string? remoteIp, CancellationToken cancellationToken);
}

/// <summary>Used when no Turnstile keys are configured (a self-hosted server): every request passes. The rate
/// limits on the credential endpoints still apply; only the bot challenge is gone.</summary>
public sealed class DisabledTurnstileVerifier : ITurnstileVerifier
{
    public Task<bool> VerifyAsync(string? token, string action, string? remoteIp, CancellationToken cancellationToken) =>
        Task.FromResult(true);
}

public sealed class TurnstileVerifier(HttpClient http, TurnstileSettings settings, TimeProvider clock,
    ILogger<TurnstileVerifier> logger) : ITurnstileVerifier
{
    public async Task<bool> VerifyAsync(string? token, string action, string? remoteIp, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 2048) return false;
        try
        {
            using var response = await http.PostAsync("https://challenges.cloudflare.com/turnstile/v0/siteverify",
                new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["secret"] = settings.SecretKey, ["response"] = token,
                    ["remoteip"] = remoteIp ?? "", ["idempotency_key"] = Guid.NewGuid().ToString()
                }), cancellationToken);
            if (!response.IsSuccessStatusCode) return false;
            var result = await response.Content.ReadFromJsonAsync<TurnstileResult>(cancellationToken);
            var now = clock.GetUtcNow();
            return result is { Success: true } && result.Action == action &&
                settings.Hostnames.Contains(result.Hostname, StringComparer.OrdinalIgnoreCase) &&
                result.ChallengeTime is { } timestamp && timestamp <= now.AddSeconds(30) && timestamp >= now.AddMinutes(-5);
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException ||
            exception is OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            // Provider payloads and tokens never enter logs, including exception text.
            logger.LogWarning("Turnstile validation unavailable ({FailureType})", exception.GetType().Name);
            return false;
        }
    }

    private sealed record TurnstileResult(bool Success, string? Hostname, string? Action,
        [property: JsonPropertyName("challenge_ts")] DateTimeOffset? ChallengeTime);
}

public interface IVerificationEmailSender
{
    Task SendAsync(string recipient, string verificationUrl, CancellationToken cancellationToken);
}

/// <summary>Used when no email provider is configured (a self-hosted server). Nothing is sent: the verification
/// link is written to the API log at Warning level, for the operator to hand to the person who registered. The
/// link signs nobody in by itself; it only confirms the address, and it expires in 30 minutes.</summary>
public sealed class LogVerificationEmailSender(ILogger<LogVerificationEmailSender> logger) : IVerificationEmailSender
{
    public Task SendAsync(string recipient, string verificationUrl, CancellationToken cancellationToken)
    {
        logger.LogWarning("Email is not configured. Verification link for {Recipient}: {VerificationUrl}", recipient, verificationUrl);
        return Task.CompletedTask;
    }
}

public sealed class CloudflareEmailSender(HttpClient http, CloudflareEmailSettings settings) : IVerificationEmailSender
{
    // Web-safe stack: an email client renders with what the reading device already has.
    private const string Font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

    public Task SendAsync(string recipient, string verificationUrl, CancellationToken cancellationToken) =>
        SendMail(recipient, "Confirm your Wireal email address",
            VerificationText(recipient, verificationUrl), VerificationHtml(recipient, verificationUrl, settings.LogoUrl), cancellationToken);

    private static string VerificationText(string recipient, string url) =>
        $"""
        Confirm your email address to finish setting up your Wireal account.

        {url}

        The link expires in 30 minutes.

        This message was sent to {recipient}. If you did not create a Wireal account,
        ignore it and the address will never be confirmed.
        """;

    /// <summary>The same message as markup, because a transactional email with no HTML part
    /// scores against itself: a bare link and four lines of text is the shape a filter has
    /// learned to read as phishing. Tables, inline styles and absolute URLs only — an email
    /// client is not a browser, and half of them delete a stylesheet before rendering.</summary>
    private static string VerificationHtml(string recipient, string url, string logoUrl)
    {
        var link = WebUtility.HtmlEncode(url);
        var address = WebUtility.HtmlEncode(recipient);
        var logo = string.IsNullOrWhiteSpace(logoUrl) ? "" :
            $"""<tr><td style="padding:32px 32px 0 32px;"><img src="{WebUtility.HtmlEncode(logoUrl)}" width="132" alt="Wireal" style="display:block;width:132px;max-width:132px;height:auto;border:0;"></td></tr>""";
        return $"""
        <!doctype html>
        <html lang="en">
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm your Wireal email address</title></head>
        <body style="margin:0;padding:0;background:#f5f5f5;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Confirm your email address to finish setting up your Wireal account.</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;">
          <tr><td align="center" style="padding:32px 16px;">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e6e6e6;border-radius:14px;">
              {logo}
              <tr><td style="padding:28px 32px 0 32px;font-family:{Font};font-size:20px;line-height:28px;font-weight:600;color:#09090b;">
                Confirm your email address
              </td></tr>
              <tr><td style="padding:12px 32px 0 32px;font-family:{Font};font-size:15px;line-height:24px;color:#3f3f46;">
                A Wireal account was created with this address. Confirm it to finish setting the account up and sign in.
              </td></tr>
              <tr><td style="padding:26px 32px 0 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td align="center" bgcolor="#09090b" style="border-radius:10px;">
                    <a href="{link}" style="display:inline-block;padding:13px 26px;font-family:{Font};font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px;">Confirm email address</a>
                  </td>
                </tr></table>
              </td></tr>
              <tr><td style="padding:26px 32px 0 32px;font-family:{Font};font-size:13px;line-height:20px;color:#71717a;">
                The link expires in 30 minutes. If the button does not work, paste this into your browser:<br>
                <span style="color:#3f3f46;word-break:break-all;">{link}</span>
              </td></tr>
              <tr><td style="padding:24px 32px 32px 32px;">
                <div style="border-top:1px solid #ededed;padding-top:20px;font-family:{Font};font-size:12px;line-height:19px;color:#8b8b93;">
                  This message was sent to {address}. If you did not create a Wireal account, ignore it and the address will never be confirmed.
                </div>
              </td></tr>
            </table>
          </td></tr>
        </table>
        </body>
        </html>
        """;
    }

    private async Task SendMail(string recipient, string subject, string text, string html, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"https://api.cloudflare.com/client/v4/accounts/{settings.AccountId}/email/sending/send");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiToken);
        request.Content = JsonContent.Create(new
        {
            from = new { address = settings.FromAddress, name = settings.FromName },
            to = new[] { recipient }, subject, text, html
        });
        using var response = await http.SendAsync(request, cancellationToken);
        // A 4xx other than a rate limit faults the request itself — a revoked
        // token, a sender domain that was never onboarded — and sending the
        // same message again cannot change the answer.
        if (!response.IsSuccessStatusCode)
            throw new EmailDeliveryException($"http {(int)response.StatusCode}",
                (int)response.StatusCode is >= 400 and < 500 && response.StatusCode != HttpStatusCode.TooManyRequests);
        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var root = payload.RootElement;
        if (!root.TryGetProperty("success", out var success) || success.ValueKind != JsonValueKind.True ||
            !root.TryGetProperty("result", out var result))
            throw new EmailDeliveryException("rejected", false);
        if (ContainsRecipient(result, "queued", recipient) || ContainsRecipient(result, "delivered", recipient)) return;
        // Cloudflare answers per recipient. A bounce or a suppression is final
        // for this address, and repeating the send only deepens the reputation
        // damage that suppressed it.
        foreach (var refusal in Refusals)
            if (ContainsRecipient(result, refusal, recipient)) throw new EmailDeliveryException(refusal, true);
        throw new EmailDeliveryException("not accepted", false);
    }

    private static readonly string[] Refusals = ["permanent_bounces", "suppressed_recipients"];

    private static bool ContainsRecipient(JsonElement result, string property, string recipient) =>
        result.TryGetProperty(property, out var addresses) && addresses.ValueKind == JsonValueKind.Array &&
        addresses.EnumerateArray().Any(value => value.ValueKind == JsonValueKind.String &&
            string.Equals(value.GetString(), recipient, StringComparison.OrdinalIgnoreCase));
}

public sealed class EmailDeliveryException(string reason, bool permanent)
    : Exception($"Verification email was not accepted for delivery ({reason}).")
{
    /// <summary>Why the provider refused, in words safe to write to a log.</summary>
    public string Reason { get; } = reason;

    /// <summary>Whether sending the same message again could ever succeed.</summary>
    public bool Permanent { get; } = permanent;
}
