using System.Globalization;
using System.Net;
using System.Text.Json.Nodes;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Wireal.Api.Auth;
using Wireal.Api.Data;

namespace Wireal.Api.Projects;

public sealed record InviteWorkspaceRequest(string Kind, string Target);
public interface IGitHubInviteIdentity { Task<string?> Resolve(string username, CancellationToken ct); }
public sealed class GitHubInviteIdentity(HttpClient http) : IGitHubInviteIdentity
{
    public async Task<string?> Resolve(string username, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/users/" + Uri.EscapeDataString(username));
        request.Headers.UserAgent.ParseAdd("Wireal.Api/1.0");
        HttpResponseMessage result;
        try { result = await http.SendAsync(request, ct); }
        catch (Exception error) when (error is HttpRequestException || error is OperationCanceledException && !ct.IsCancellationRequested)
        { throw new DataFault("GitHub is unavailable. Try again or use a GitHub ID.", 503); }
        using var response = result;
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        if (!response.IsSuccessStatusCode) throw new DataFault("GitHub is unavailable. Try again or use a GitHub ID.", 503);
        using var data = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return data.RootElement.GetProperty("id").GetInt64().ToString(CultureInfo.InvariantCulture);
    }
}

public sealed class WorkspaceTeams(AppDbContext db, IGitHubInviteIdentity github, IConfiguration config)
{
    private async Task<WorkspaceDocument> RequireOwner(Guid actor, Guid workspaceId, CancellationToken ct, bool writing = false)
    {
        var workspace = await WorkspaceAccess.Require(db, actor, workspaceId, ct, writing);
        if (workspace.UserId != actor) throw new DataFault("Only the owner can manage invitations.", 403);
        return workspace;
    }
    public static IQueryable<WorkspaceInvitation> Pending(AppDbContext db) => db.WorkspaceInvitations.Where(i => i.ClosedAt == null && i.ExpiresAt > DateTime.UtcNow);
    public static IQueryable<WorkspaceInvitation> ForUser(AppDbContext db, AppUser user) => Pending(db).Where(i =>
        (i.Kind == "email" && user.EmailVerified && user.NormalizedEmail != null && i.Target == user.NormalizedEmail) ||
        (i.Kind == "github" && user.GitHubId != null && i.Target == user.GitHubId));
    public static Task<bool> Invited(AppDbContext db, string kind, string? target, CancellationToken ct) =>
        target is null ? Task.FromResult(false) : Pending(db).AnyAsync(i => i.Kind == kind && i.Target == target, ct);

    public async Task<object> Team(Guid actor, Guid workspaceId, CancellationToken ct)
    {
        var workspace = await WorkspaceAccess.Require(db, actor, workspaceId, ct);
        var memberIds = db.WorkspaceMembers.Where(m => m.WorkspaceId == workspaceId).Select(m => m.UserId);
        var members = await db.Users.AsNoTracking().Where(u => u.Id == workspace.UserId || memberIds.Contains(u.Id))
            .Select(u => new { id = u.Id, name = u.DisplayName, email = u.Email, avatarUrl = u.AvatarUrl,
                role = u.Id == workspace.UserId ? "owner" : "collaborator" }).ToArrayAsync(ct);
        var invitations = await Pending(db).Where(i => i.WorkspaceId == workspaceId)
            .OrderByDescending(i => i.ExpiresAt).Select(i => new { id = i.Id, target = i.Label, expiresAt = i.ExpiresAt }).ToArrayAsync(ct);
        return new { role = workspace.UserId == actor ? "owner" : "collaborator", currentUserId = actor, members, invitations };
    }

    public async Task<object> Invite(Guid actor, Guid workspaceId, InviteWorkspaceRequest input, CancellationToken ct)
    {
        // Authorize before making any external lookup.
        await RequireOwner(actor, workspaceId, ct);
        var label = input.Target?.Trim() ?? "";
        if (label.Length is < 1 or > 254) throw new DataFault("Enter an exact email, GitHub username, or GitHub ID.");
        string target;
        var kind = input.Kind;
        if (kind == "email") target = EmailAddress.Normalize(label) ?? throw new DataFault("Enter a valid email address.");
        else if (kind == "github-id")
        {
            if (!long.TryParse(label, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0) throw new DataFault("Enter a numeric GitHub ID.");
            target = id.ToString(CultureInfo.InvariantCulture); kind = "github";
        }
        else if (kind == "github-username")
        {
            label = label.TrimStart('@');
            if (!Regex.IsMatch(label, "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")) throw new DataFault("Enter a GitHub username.");
            // A missing public GitHub name still gets the same response; no Wireal lookup is exposed.
            target = await github.Resolve(label, ct) ?? "unmatched:" + Guid.NewGuid(); kind = "github";
        }
        else throw new DataFault("Unsupported invitation type.");

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await RequireOwner(actor, workspaceId, ct, writing: true);
        if (await Pending(db).CountAsync(i => i.WorkspaceId == workspaceId && !(i.Kind == kind && i.Target == target), ct) >= 50) throw new DataFault("This workspace has too many pending invitations.", 429);
        if (await db.WorkspaceMembers.CountAsync(m => m.WorkspaceId == workspaceId, ct) >= 49) throw new DataFault("This workspace has reached its team limit.", 409);
        var duplicate = await Pending(db).Where(i => i.WorkspaceId == workspaceId && i.Kind == kind && i.Target == target).ToListAsync(ct);
        foreach (var old in duplicate) { old.ClosedAt = DateTime.UtcNow; }
        var invitation = new WorkspaceInvitation { WorkspaceId = workspaceId, InvitedBy = actor, Kind = kind, Target = target,
            Label = label, ExpiresAt = DateTime.UtcNow.AddDays(7) };
        var link = config["App:ClientOrigin"]!.TrimEnd('/') + "/invitations?invitation_id=" + invitation.Id;
        db.WorkspaceInvitations.Add(invitation);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { id = invitation.Id, link, message = "Invitation created. The matching verified account can accept it within seven days." };
    }

    public async Task<object> Inbox(Guid actor, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == actor, ct);
        var rows = await (from i in ForUser(db, user)
                          join w in db.Workspaces on i.WorkspaceId equals w.Id
                          join inviter in db.Users on i.InvitedBy equals inviter.Id
                          select new
                          {
                              i.Id,
                              i.ExpiresAt,
                              w.Name,
                              w.Kind,
                              w.MapSettingsJson,
                              InviterName = inviter.DisplayName,
                              InviterAvatarUrl = inviter.AvatarUrl,
                              MemberCount = 1 + db.WorkspaceMembers.Count(m => m.WorkspaceId == w.Id)
                          }).Take(100).ToArrayAsync(ct);
        return rows.Select(i => new
        {
            id = i.Id,
            expiresAt = i.ExpiresAt,
            workspaceName = i.Name,
            invitedBy = new { name = i.InviterName, avatarUrl = i.InviterAvatarUrl },
            workspaceKind = i.Kind,
            memberCount = i.MemberCount,
            orb = WorkspaceOrb(i.MapSettingsJson)
        });
    }

    private static JsonNode? WorkspaceOrb(string mapSettingsJson)
    {
        try { return JsonNode.Parse(mapSettingsJson)?["orb"]?.DeepClone(); }
        catch (JsonException) { return null; }
    }

    public async Task<object> Respond(Guid actor, Guid id, bool accept, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await db.Users.SingleAsync(u => u.Id == actor, ct);
        var invitation = await ForUser(db, user).SingleOrDefaultAsync(i => i.Id == id, ct) ?? throw new DataFault("Invitation unavailable or not addressed to your verified identity.", 404);
        var workspace = await db.Workspaces.SingleAsync(w => w.Id == invitation.WorkspaceId, ct);
        db.Entry(workspace).Property(w => w.Version).IsModified = true;
        if (accept && workspace.UserId != actor && !await db.WorkspaceMembers.AnyAsync(m => m.WorkspaceId == workspace.Id && m.UserId == actor, ct))
        {
            if (await db.WorkspaceMembers.CountAsync(m => m.WorkspaceId == workspace.Id, ct) >= 49) throw new DataFault("This workspace has reached its team limit.", 409);
            db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = workspace.Id, UserId = actor });
        }
        if (accept) user.ActiveWorkspaceId = workspace.Id;
        invitation.ClosedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new { workspaceId = workspace.Id, accepted = accept };
    }

    public async Task Revoke(Guid actor, Guid workspaceId, Guid invitationId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await RequireOwner(actor, workspaceId, ct, writing: true);
        var invitation = await db.WorkspaceInvitations.SingleOrDefaultAsync(i => i.WorkspaceId == workspaceId && i.Id == invitationId, ct) ?? throw new DataFault("Invitation not found.", 404);
        invitation.ClosedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }

    public async Task Remove(Guid actor, Guid workspaceId, Guid memberId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var workspace = await WorkspaceAccess.Require(db, actor, workspaceId, ct, writing: true);
        if (memberId == workspace.UserId) throw new DataFault("The owner cannot leave the workspace.", 403);
        if (workspace.UserId != actor && actor != memberId) throw new DataFault("Only the owner can remove another member.", 403);
        var member = await db.WorkspaceMembers.SingleOrDefaultAsync(m => m.WorkspaceId == workspaceId && m.UserId == memberId, ct) ?? throw new DataFault("Member not found.", 404);
        db.WorkspaceMembers.Remove(member);
        db.WorkspacePresence.RemoveRange(await db.WorkspacePresence.Where(p => p.WorkspaceId == workspaceId && p.UserId == memberId).ToListAsync(ct));
        var removed = await db.Users.SingleAsync(u => u.Id == memberId, ct);
        if (removed.ActiveWorkspaceId == workspaceId) removed.ActiveWorkspaceId = null;
        var pending = await ForUser(db, removed).Where(i => i.WorkspaceId == workspaceId).ToListAsync(ct);
        foreach (var invitation in pending) { invitation.ClosedAt = DateTime.UtcNow; }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
}
