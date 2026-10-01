using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Wireal.Api.GitHub;

namespace Wireal.Api.Data;

public sealed class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string? GitHubId { get; set; }
    public string? Email { get; set; }
    public string? NormalizedEmail { get; set; }
    public string? PasswordHash { get; set; }
    public bool EmailVerified { get; set; }
    public int FailedLoginCount { get; set; }
    public DateTime? LockoutEnd { get; set; }
    public DateTime? LastVerificationSentAt { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
    public string DisplayName { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool Disabled { get; set; }
    public bool OnboardingDone { get; set; }
    public bool LanguagePromptDone { get; set; }
    public string? PreferredLanguage { get; set; }
    public string? AvatarUrl { get; set; }
    public string? GoogleId { get; set; }
    public Guid? ActiveWorkspaceId { get; set; }
}

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<AuthSession> AuthSessions => Set<AuthSession>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<EmailVerification> EmailVerifications => Set<EmailVerification>();
    public DbSet<EmailOutboxMessage> EmailOutbox => Set<EmailOutboxMessage>();
    public DbSet<WorkspaceDocument> Workspaces => Set<WorkspaceDocument>();
    public DbSet<UserAvatar> Avatars => Set<UserAvatar>();
    public DbSet<WorkspaceMember> WorkspaceMembers => Set<WorkspaceMember>();
    public DbSet<WorkspaceInvitation> WorkspaceInvitations => Set<WorkspaceInvitation>();
    public DbSet<WorkspaceProject> Projects => Set<WorkspaceProject>();
    public DbSet<WorkspaceTask> Tasks => Set<WorkspaceTask>();
    public DbSet<WorkspaceProjectTask> ProjectTasks => Set<WorkspaceProjectTask>();
    public DbSet<WorkspaceLabel> WorkspaceLabels => Set<WorkspaceLabel>();
    public DbSet<WorkspaceTaskLabel> TaskLabels => Set<WorkspaceTaskLabel>();
    public DbSet<WorkspaceTaskActivity> TaskActivities => Set<WorkspaceTaskActivity>();
    public DbSet<WorkspaceDependency> TaskDependencies => Set<WorkspaceDependency>();
    public DbSet<WorkspaceGitHubInstallation> GitHubInstallations => Set<WorkspaceGitHubInstallation>();
    public DbSet<GitHubCommitSnapshot> GitHubCommitSnapshots => Set<GitHubCommitSnapshot>();
    public DbSet<WorkspaceRunner> WorkspaceRunners => Set<WorkspaceRunner>();
    public DbSet<WorkspaceLease> WorkspaceLeases => Set<WorkspaceLease>();
    public DbSet<WorkspaceFlowRequest> WorkspaceFlowRequests => Set<WorkspaceFlowRequest>();
    public DbSet<WorkspaceTaskLock> WorkspaceTaskLocks => Set<WorkspaceTaskLock>();
    public DbSet<WorkspaceAgentSeat> WorkspaceAgentSeats => Set<WorkspaceAgentSeat>();
    public DbSet<WorkspacePresence> WorkspacePresence => Set<WorkspacePresence>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        ProjectDataModel.Configure(model);
        GitHubDataModel.Configure(model);
        RunnerDataModel.Configure(model);
        Wireal.Api.Auth.OAuthServer.ConfigureModel(model);
        var users = model.Entity<AppUser>();
        users.HasKey(x => x.Id);
        users.Property(x => x.GitHubId).HasMaxLength(32);
        users.HasIndex(x => x.GitHubId).IsUnique();
        users.Property(x => x.DisplayName).HasMaxLength(200);
        users.Property(x => x.Email).HasMaxLength(254);
        users.Property(x => x.NormalizedEmail).HasMaxLength(254);
        users.HasIndex(x => x.NormalizedEmail).IsUnique();
        users.Property(x => x.PasswordHash).HasMaxLength(512);
        users.Property(x => x.Version).IsConcurrencyToken();
        users.Property(x => x.PreferredLanguage).HasMaxLength(2);
        users.Property(x => x.AvatarUrl).HasMaxLength(2048);
        users.Property(x => x.GoogleId).HasMaxLength(100);
        users.HasIndex(x => x.GoogleId).IsUnique();

        var sessions = model.Entity<AuthSession>();
        sessions.HasKey(x => x.Id);
        sessions.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        sessions.HasIndex(x => new { x.UserId, x.ExpiresAt });
        sessions.Property(x => x.Version).IsConcurrencyToken();
        sessions.Property(x => x.OAuthClientId).HasMaxLength(36);
        sessions.Property(x => x.Scope).HasMaxLength(200);
        sessions.Property(x => x.Resource).HasMaxLength(2048);

        var refresh = model.Entity<RefreshToken>();
        refresh.HasKey(x => x.Id);
        refresh.Property(x => x.Hash).HasMaxLength(64).IsFixedLength();
        refresh.HasIndex(x => x.Hash).IsUnique();
        refresh.Property(x => x.Version).IsConcurrencyToken();
        refresh.HasOne(x => x.Session).WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);

        var verification = model.Entity<EmailVerification>();
        verification.HasKey(x => x.Id);
        verification.Property(x => x.Hash).HasMaxLength(64).IsFixedLength();
        verification.Property(x => x.PendingEmail).HasMaxLength(254);
        verification.HasIndex(x => x.Hash).IsUnique();
        verification.Property(x => x.Version).IsConcurrencyToken();
        verification.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);

        var outbox = model.Entity<EmailOutboxMessage>();
        outbox.HasKey(x => x.Id);
        outbox.Property(x => x.ProtectedPayload).HasMaxLength(4096);
        outbox.Property(x => x.Version).IsConcurrencyToken();
        outbox.HasIndex(x => new { x.CompletedAt, x.NextAttemptAt });
        // Both rations are counted on every send, so neither may scan the table.
        outbox.HasIndex(x => x.SentAt);
        outbox.HasIndex(x => x.CreatedAt);
        outbox.HasOne<EmailVerification>().WithMany().HasForeignKey(x => x.VerificationId).OnDelete(DeleteBehavior.Cascade);
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder configuration)
    {
        // PostgreSQL stores instants as timestamptz, and Npgsql refuses to write a DateTime whose Kind is not
        // Utc. The code writes DateTime.UtcNow, but a value built another way (arithmetic on a parsed date, a
        // default(DateTime), a test fixture) may carry Unspecified: every DateTime this application stores is
        // UTC, so Unspecified is read as UTC and Local is converted. Values read back are always Kind=Utc.
        configuration.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
        configuration.Properties<DateTimeOffset>().HaveConversion<UtcDateTimeOffsetConverter>();
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        foreach (var entry in ChangeTracker.Entries().Where(x => x.State == EntityState.Modified))
            if (entry.Metadata.FindProperty("Version") is not null) entry.Property("Version").CurrentValue = Guid.NewGuid();
        return base.SaveChangesAsync(cancellationToken);
    }
}

public sealed class AuthSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public DateTime? BridgeExchangedAt { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
    public string? OAuthClientId { get; set; }
    public string Scope { get; set; } = "";
    public string Resource { get; set; } = "";
}

public sealed class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SessionId { get; set; }
    public AuthSession Session { get; set; } = null!;
    public string Hash { get; set; } = "";
    public DateTime? ConsumedAt { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
}

public sealed class EmailVerification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public string Hash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
    public string? PendingEmail { get; set; }
}

public sealed class EmailOutboxMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid VerificationId { get; set; }
    public string ProtectedPayload { get; set; } = "";
    public int Attempts { get; set; }
    public DateTime NextAttemptAt { get; set; }

    /// <summary>When the send was asked for, which is what an account is rationed on.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>When the provider accepted the message, which is what spends the daily quota.
    /// Null on a message that was expired, exhausted or refused: those cost nothing.</summary>
    public DateTime? SentAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
}

public sealed class UtcDateTimeConverter() : Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<DateTime, DateTime>(
    value => value.Kind == DateTimeKind.Utc ? value
        : value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : DateTime.SpecifyKind(value, DateTimeKind.Utc),
    value => value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc));

/// <summary>Npgsql writes a DateTimeOffset to timestamptz only at offset zero.</summary>
public sealed class UtcDateTimeOffsetConverter() : Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<DateTimeOffset, DateTimeOffset>(
    value => value.ToUniversalTime(), value => value);

// Generating migrations requires no live database or OAuth credentials; the connection string is never opened.
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Postgres")
            ?? "Host=localhost;Database=wireal;Username=wireal";
        return new(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connection).Options);
    }
}
