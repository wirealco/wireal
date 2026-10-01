using Microsoft.EntityFrameworkCore;
using Wireal.Api.Data;

namespace Wireal.Api.GitHub;

public sealed class WorkspaceGitHubInstallation
{
    public Guid WorkspaceId { get; set; }
    public long InstallationId { get; set; }
    public string AccountLogin { get; set; } = "";
    public string AccountType { get; set; } = "";
    public string RepositorySelection { get; set; } = "";
    public Guid ConnectedBy { get; set; }
    public DateTime ConnectedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeclinedAt { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
}

public sealed class GitHubCommitSnapshot
{
    public string Key { get; set; } = "";
    public string Owner { get; set; } = "";
    public string Repo { get; set; } = "";
    public string Sha { get; set; } = "";
    public DateTime? CommittedAt { get; set; }
    public int Additions { get; set; }
    public int Deletions { get; set; }
    public string FilesJson { get; set; } = "[]";
    public DateTime FetchedAt { get; set; } = DateTime.UtcNow;
}

public static class GitHubDataModel
{
    public static void Configure(ModelBuilder model)
    {
        var installation = model.Entity<WorkspaceGitHubInstallation>();
        installation.ToTable("WorkspaceGitHubInstallations");
        installation.HasKey(x => x.WorkspaceId);
        installation.HasOne<WorkspaceDocument>().WithMany().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        installation.Property(x => x.AccountLogin).HasMaxLength(100);
        installation.Property(x => x.AccountType).HasMaxLength(20);
        installation.Property(x => x.RepositorySelection).HasMaxLength(10);
        installation.Property(x => x.Version).IsConcurrencyToken();
        installation.HasIndex(x => x.InstallationId);

        var snapshot = model.Entity<GitHubCommitSnapshot>();
        snapshot.ToTable("GitHubCommitSnapshots");
        snapshot.HasKey(x => x.Key);
        snapshot.Property(x => x.Key).HasMaxLength(300);
        snapshot.Property(x => x.Owner).HasMaxLength(100);
        snapshot.Property(x => x.Repo).HasMaxLength(150);
        snapshot.Property(x => x.Sha).HasMaxLength(40);
    }
}
