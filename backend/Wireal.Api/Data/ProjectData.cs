using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations.Schema;

namespace Wireal.Api.Data;

public sealed class WorkspaceDocument
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "coding";
    public string RepositoryUrl { get; set; } = "";
    public string RepositoryLayout { get; set; } = "multirepo";
    public string SettingsJson { get; set; } = "{}";
    public string MapSettingsJson { get; set; } = "{}";
    public List<WorkspaceProject> Projects { get; set; } = [];
    public List<WorkspaceTask> Tasks { get; set; } = [];
    public List<WorkspaceLabel> Labels { get; set; } = [];
    public List<WorkspaceDependency> Dependencies { get; set; } = [];
    // JSON is an API compatibility projection, never a persisted workspace blob.
    [NotMapped]
    public string Data { get => WorkspaceGraph.Read(this).ToJsonString(); set => WorkspaceGraph.Write(this, value); }
    public bool IsActive { get; set; }
    public long Revision { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public Guid Version { get; set; } = Guid.NewGuid();
}

public sealed class UserAvatar
{
    public Guid UserId { get; set; }
    public byte[] Content { get; set; } = [];
    public string ContentType { get; set; } = "";
}

public static class ProjectDataModel
{
    public static void Configure(ModelBuilder model)
    {
        var workspace = model.Entity<WorkspaceDocument>();
        workspace.HasKey(x => x.Id);
        workspace.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        workspace.Property(x => x.Version).IsConcurrencyToken();
        workspace.HasIndex(x => new { x.UserId, x.CreatedAt });
        workspace.HasIndex(x => x.UserId).IsUnique().HasFilter("\"IsActive\"");
        WorkspaceGraphModel.Configure(model);

        var member = model.Entity<WorkspaceMember>();
        member.HasKey(x => new { x.WorkspaceId, x.UserId });
        member.HasOne<WorkspaceDocument>().WithMany().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        member.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
        member.Property(x => x.Version).IsConcurrencyToken();
        var invitation = model.Entity<WorkspaceInvitation>();
        invitation.HasKey(x => x.Id);
        invitation.HasOne<WorkspaceDocument>().WithMany().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        invitation.Property(x => x.Kind).HasMaxLength(20);
        invitation.Property(x => x.Target).HasMaxLength(254);
        invitation.Property(x => x.Label).HasMaxLength(254);
        invitation.Property(x => x.Version).IsConcurrencyToken();
        invitation.HasIndex(x => new { x.Kind, x.Target, x.ExpiresAt });

        var avatar = model.Entity<UserAvatar>();
        avatar.HasKey(x => x.UserId);
        avatar.Property(x => x.ContentType).HasMaxLength(40);
        avatar.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class WorkspaceMember
{
    public Guid WorkspaceId { get; set; }
    public Guid UserId { get; set; }
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    public Guid Version { get; set; } = Guid.NewGuid();
}

public sealed class WorkspaceInvitation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public Guid InvitedBy { get; set; }
    public string Kind { get; set; } = "";
    public string Target { get; set; } = "";
    public string Label { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? ClosedAt { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
}
