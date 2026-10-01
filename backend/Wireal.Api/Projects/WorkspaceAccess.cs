using Microsoft.EntityFrameworkCore;
using Wireal.Api.Data;

namespace Wireal.Api.Projects;

public static class WorkspaceAccess
{
    public static IQueryable<WorkspaceDocument> Visible(AppDbContext db, Guid user) =>
        db.Workspaces.AsSplitQuery().Where(w => w.UserId == user || db.WorkspaceMembers.Any(m => m.WorkspaceId == w.Id && m.UserId == user));

    public static async Task<Guid?> ActiveId(AppDbContext db, Guid user, CancellationToken ct)
    {
        var chosen = await db.Users.Where(x => x.Id == user).Select(x => x.ActiveWorkspaceId).SingleAsync(ct);
        var visible = Visible(db, user);
        if (chosen is { } id && await visible.AnyAsync(w => w.Id == id, ct)) return id;
        return await visible.OrderByDescending(w => w.UserId == user && w.IsActive).ThenBy(w => w.CreatedAt)
            .Select(w => (Guid?)w.Id).FirstOrDefaultAsync(ct);
    }

    public static async Task<WorkspaceDocument> Require(AppDbContext db, Guid user, Guid id, CancellationToken ct, bool writing = false)
    {
        var workspace = await Visible(db, user).SingleOrDefaultAsync(w => w.Id == id, ct) ?? throw new DataFault("Workspace not found.", 404);
        if (writing)
        {
            db.Entry(workspace).Property(w => w.Version).IsModified = true;
            if (workspace.UserId != user)
            {
                var membership = await db.WorkspaceMembers.SingleAsync(m => m.WorkspaceId == id && m.UserId == user, ct);
                db.Entry(membership).Property(m => m.Version).IsModified = true;
            }
        }
        return workspace;
    }

    public static async Task<object[]> Changes(AppDbContext db, Guid user, CancellationToken ct)
    {
        var active = await ActiveId(db, user, ct);
        return await Visible(db, user).AsNoTracking().OrderBy(w => w.Id)
            .Select(w => (object)new { w.Id, w.Revision, IsActive = w.Id == active }).ToArrayAsync(ct);
    }
}
