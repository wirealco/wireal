using Microsoft.EntityFrameworkCore;

namespace Wireal.Api.Data;

public sealed class WorkspaceProject
{
    public Guid WorkspaceId { get; set; }
    public string Id { get; set; } = "";
    public int SortOrder { get; set; }
    public string Name { get; set; } = "";
    public string RepositoryUrl { get; set; } = "";
    public string SettingsJson { get; set; } = "{}";
}

public sealed class WorkspaceTask
{
    public Guid WorkspaceId { get; set; }
    public string Id { get; set; } = "";
    public int SortOrder { get; set; }
    public string Name { get; set; } = "";
    public string ReferenceId { get; set; } = "";
    public string Status { get; set; } = "todo";
    public string Objective { get; set; } = "";
    public string? ParentId { get; set; }
    public double PositionX { get; set; }
    public double PositionY { get; set; }
    public string SettingsJson { get; set; } = "{}";
    public List<WorkspaceProjectTask> Projects { get; set; } = [];
    public List<WorkspaceTaskLabel> Labels { get; set; } = [];
    public List<WorkspaceTaskActivity> Activities { get; set; } = [];
}

public sealed class WorkspaceLabel
{
    public Guid WorkspaceId { get; set; }
    public string Id { get; set; } = "";
    public int SortOrder { get; set; }
    public string Name { get; set; } = "";
    public string SettingsJson { get; set; } = "{}";
}

public sealed class WorkspaceDependency
{
    public Guid WorkspaceId { get; set; }
    public string Id { get; set; } = "";
    public int SortOrder { get; set; }
    public string SourceId { get; set; } = "";
    public string TargetId { get; set; } = "";
    public string SettingsJson { get; set; } = "{}";
}

public sealed class WorkspaceProjectTask
{
    public Guid WorkspaceId { get; set; }
    public string TaskId { get; set; } = "";
    public string ProjectId { get; set; } = "";
    public int SortOrder { get; set; }
}

public sealed class WorkspaceTaskLabel
{
    public Guid WorkspaceId { get; set; }
    public string TaskId { get; set; } = "";
    public string LabelId { get; set; } = "";
    public int SortOrder { get; set; }
}

public sealed class WorkspaceTaskActivity
{
    public Guid WorkspaceId { get; set; }
    public string TaskId { get; set; } = "";
    public string Id { get; set; } = "";
    public int SortOrder { get; set; }
    public string Text { get; set; } = "";
    public string OccurredAt { get; set; } = "";
    public string Author { get; set; } = "";
    public string AuthorType { get; set; } = "user";
    public string? AuthorId { get; set; }
    public string? Kind { get; set; }
    public string? Commit { get; set; }
    public string? PathsJson { get; set; }
    public string SettingsJson { get; set; } = "{}";
}

public static class WorkspaceGraphModel
{
    public static void Configure(ModelBuilder model)
    {
        var workspace = model.Entity<WorkspaceDocument>();
        workspace.Property(x => x.Kind).HasMaxLength(20);
        workspace.Property(x => x.RepositoryLayout).HasMaxLength(20);
        workspace.HasMany(x => x.Projects).WithOne().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        workspace.HasMany(x => x.Tasks).WithOne().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        workspace.HasMany(x => x.Labels).WithOne().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        workspace.HasMany(x => x.Dependencies).WithOne().HasForeignKey(x => x.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        workspace.Navigation(x => x.Projects).AutoInclude();
        workspace.Navigation(x => x.Tasks).AutoInclude();
        workspace.Navigation(x => x.Labels).AutoInclude();
        workspace.Navigation(x => x.Dependencies).AutoInclude();

        var project = model.Entity<WorkspaceProject>();
        project.ToTable("Projects");
        project.HasKey(x => new { x.WorkspaceId, x.Id });
        var task = model.Entity<WorkspaceTask>();
        task.ToTable("Tasks");
        task.HasKey(x => new { x.WorkspaceId, x.Id });
        task.Property(x => x.Status).HasMaxLength(20);
        task.HasIndex(x => new { x.WorkspaceId, x.Status });
        task.HasOne<WorkspaceTask>().WithMany().HasForeignKey(x => new { x.WorkspaceId, x.ParentId }).OnDelete(DeleteBehavior.ClientSetNull);
        task.HasMany(x => x.Projects).WithOne().HasForeignKey(x => new { x.WorkspaceId, x.TaskId }).OnDelete(DeleteBehavior.Cascade);
        task.HasMany(x => x.Labels).WithOne().HasForeignKey(x => new { x.WorkspaceId, x.TaskId }).OnDelete(DeleteBehavior.Cascade);
        task.HasMany(x => x.Activities).WithOne().HasForeignKey(x => new { x.WorkspaceId, x.TaskId }).OnDelete(DeleteBehavior.Cascade);
        task.Navigation(x => x.Projects).AutoInclude();
        task.Navigation(x => x.Labels).AutoInclude();
        task.Navigation(x => x.Activities).AutoInclude();

        var projectTask = model.Entity<WorkspaceProjectTask>();
        projectTask.ToTable("ProjectTasks");
        projectTask.HasKey(x => new { x.WorkspaceId, x.TaskId, x.ProjectId });
        projectTask.HasOne<WorkspaceProject>().WithMany().HasForeignKey(x => new { x.WorkspaceId, x.ProjectId }).OnDelete(DeleteBehavior.ClientCascade);
        var label = model.Entity<WorkspaceLabel>();
        label.ToTable("WorkspaceLabels");
        label.HasKey(x => new { x.WorkspaceId, x.Id });
        var taskLabel = model.Entity<WorkspaceTaskLabel>();
        taskLabel.ToTable("TaskLabels");
        taskLabel.HasKey(x => new { x.WorkspaceId, x.TaskId, x.LabelId });
        taskLabel.HasOne<WorkspaceLabel>().WithMany().HasForeignKey(x => new { x.WorkspaceId, x.LabelId }).OnDelete(DeleteBehavior.ClientCascade);
        var activity = model.Entity<WorkspaceTaskActivity>();
        activity.ToTable("TaskActivities");
        activity.HasKey(x => new { x.WorkspaceId, x.TaskId, x.Id });
        activity.Property(x => x.Kind).HasMaxLength(20);
        activity.Property(x => x.Commit).HasMaxLength(40);
        var dependency = model.Entity<WorkspaceDependency>();
        dependency.ToTable("TaskDependencies");
        dependency.HasKey(x => new { x.WorkspaceId, x.Id });
        dependency.HasOne<WorkspaceTask>().WithMany().HasForeignKey(x => new { x.WorkspaceId, x.SourceId }).OnDelete(DeleteBehavior.ClientCascade);
        dependency.HasOne<WorkspaceTask>().WithMany().HasForeignKey(x => new { x.WorkspaceId, x.TargetId }).OnDelete(DeleteBehavior.ClientCascade);

        foreach (var type in new[] { typeof(WorkspaceProject), typeof(WorkspaceTask), typeof(WorkspaceLabel), typeof(WorkspaceDependency),
            typeof(WorkspaceProjectTask), typeof(WorkspaceTaskLabel), typeof(WorkspaceTaskActivity) })
        {
            var entity = model.Entity(type);
            // Ids are compared ordinally; PostgreSQL's default collation already treats "a" and "A" as different.
            foreach (var property in entity.Metadata.GetProperties().Where(p => p.ClrType == typeof(string)))
                if (property.Name.EndsWith("Id", StringComparison.Ordinal)) property.SetMaxLength(200);
        }
    }
}
