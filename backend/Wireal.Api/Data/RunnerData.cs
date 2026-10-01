using Microsoft.EntityFrameworkCore;

namespace Wireal.Api.Data;

public sealed class WorkspaceRunner
{
    public Guid WorkspaceId { get; set; }
    public string RunnerId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Host { get; set; } = "";
    public Guid OwnerUserId { get; set; }
    public DateTime Since { get; set; } = DateTime.UtcNow;
    public DateTime LastSeen { get; set; } = DateTime.UtcNow;
    public string AgentsJson { get; set; } = "[]";
    public string? WantedAgentsJson { get; set; }
    public string? HostsJson { get; set; }
    public string? RateLimitsJson { get; set; }
    public string? FolderJson { get; set; }
    public decimal CostUsd { get; set; }
    public DateTime? PingRequestedAt { get; set; }
    public DateTime? PingAnsweredAt { get; set; }
}

public sealed class WorkspaceLease
{
    public Guid WorkspaceId { get; set; }
    public string TaskId { get; set; } = "";
    public string Agent { get; set; } = "";
    public string RunnerId { get; set; } = "";
    public DateTime Since { get; set; } = DateTime.UtcNow;
    public DateTime Until { get; set; }
}

public sealed class WorkspaceFlowRequest
{
    public Guid WorkspaceId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TaskId { get; set; } = "";
    public string Agent { get; set; } = "";
    public string Kind { get; set; } = "run";
    public Guid RequestedByUserId { get; set; }
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
}

public sealed class WorkspaceTaskLock
{
    public Guid WorkspaceId { get; set; }
    public string TaskId { get; set; } = "";
    public Guid OwnerUserId { get; set; }
    public string? Agent { get; set; }
    public DateTime Since { get; set; } = DateTime.UtcNow;
}

public sealed class WorkspaceAgentSeat
{
    public Guid WorkspaceId { get; set; }
    public string AgentId { get; set; } = "";
    public string RunnerId { get; set; } = "";
    public Guid OwnerUserId { get; set; }
    public DateTime Since { get; set; } = DateTime.UtcNow;
}

/// <summary>A person working through the Wireal MCP from their own Claude Code or
/// Codex session, outside any runner. Rows are refreshed by touch_presence and
/// count as live for ten minutes.</summary>
public sealed class WorkspacePresence
{
    public Guid WorkspaceId { get; set; }
    public Guid UserId { get; set; }
    public string Session { get; set; } = "";
    public string Client { get; set; } = "";
    public string? Handle { get; set; }
    public string? TaskId { get; set; }
    public string? Note { get; set; }
    public DateTime LastSeen { get; set; } = DateTime.UtcNow;
}

public static class RunnerDataModel
{
    public static void Configure(ModelBuilder model)
    {
        var runner = model.Entity<WorkspaceRunner>();
        runner.ToTable("WorkspaceRunners");
        runner.HasKey(x => new { x.WorkspaceId, x.RunnerId });
        runner.HasOne<WorkspaceDocument>().WithMany().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        runner.HasOne<AppUser>().WithMany().HasForeignKey(x => x.OwnerUserId).OnDelete(DeleteBehavior.NoAction);
        runner.Property(x => x.RunnerId).HasMaxLength(100);
        runner.Property(x => x.Name).HasMaxLength(200);
        runner.Property(x => x.Host).HasMaxLength(200);
        runner.Property(x => x.WantedAgentsJson).HasMaxLength(4000);
        runner.Property(x => x.HostsJson).HasMaxLength(500);
        runner.Property(x => x.RateLimitsJson).HasMaxLength(8192);
        runner.Property(x => x.FolderJson).HasMaxLength(500);
        runner.Property(x => x.CostUsd).HasPrecision(18, 6);
        runner.HasIndex(x => new { x.WorkspaceId, x.LastSeen });

        var lease = model.Entity<WorkspaceLease>();
        lease.ToTable("WorkspaceLeases");
        lease.HasKey(x => new { x.WorkspaceId, x.TaskId });
        lease.HasOne<WorkspaceDocument>().WithMany().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        lease.Property(x => x.TaskId).HasMaxLength(200);
        lease.Property(x => x.Agent).HasMaxLength(200);
        lease.Property(x => x.RunnerId).HasMaxLength(100);
        lease.HasIndex(x => new { x.WorkspaceId, x.RunnerId });

        var request = model.Entity<WorkspaceFlowRequest>();
        request.ToTable("WorkspaceFlowRequests");
        request.HasKey(x => new { x.WorkspaceId, x.Id });
        request.HasOne<WorkspaceDocument>().WithMany().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        request.HasOne<AppUser>().WithMany().HasForeignKey(x => x.RequestedByUserId).OnDelete(DeleteBehavior.NoAction);
        request.Property(x => x.TaskId).HasMaxLength(200);
        request.Property(x => x.Agent).HasMaxLength(50);
        request.Property(x => x.Kind).HasMaxLength(20).HasDefaultValue("run");
        request.HasIndex(x => new { x.WorkspaceId, x.RequestedAt });

        var taskLock = model.Entity<WorkspaceTaskLock>();
        taskLock.ToTable("WorkspaceTaskLocks");
        taskLock.HasKey(x => new { x.WorkspaceId, x.TaskId });
        taskLock.HasOne<WorkspaceDocument>().WithMany().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        taskLock.HasOne<AppUser>().WithMany().HasForeignKey(x => x.OwnerUserId).OnDelete(DeleteBehavior.NoAction);
        taskLock.Property(x => x.TaskId).HasMaxLength(200);
        taskLock.Property(x => x.Agent).HasMaxLength(200);

        var seat = model.Entity<WorkspaceAgentSeat>();
        seat.ToTable("WorkspaceAgentSeats");
        seat.HasKey(x => new { x.WorkspaceId, x.AgentId });
        seat.HasOne<WorkspaceDocument>().WithMany().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        seat.HasOne<AppUser>().WithMany().HasForeignKey(x => x.OwnerUserId).OnDelete(DeleteBehavior.NoAction);
        seat.Property(x => x.AgentId).HasMaxLength(200);
        seat.Property(x => x.RunnerId).HasMaxLength(100);
        seat.HasIndex(x => new { x.WorkspaceId, x.RunnerId });

        var presence = model.Entity<WorkspacePresence>();
        presence.ToTable("WorkspacePresence");
        presence.HasKey(x => new { x.WorkspaceId, x.UserId, x.Session });
        presence.HasOne<WorkspaceDocument>().WithMany().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        presence.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
        presence.Property(x => x.Session).HasMaxLength(100);
        presence.Property(x => x.Client).HasMaxLength(60);
        presence.Property(x => x.Handle).HasMaxLength(60);
        presence.Property(x => x.TaskId).HasMaxLength(200);
        presence.Property(x => x.Note).HasMaxLength(200);
        presence.HasIndex(x => new { x.WorkspaceId, x.LastSeen });
    }
}
