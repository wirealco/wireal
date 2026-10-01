import type { Task, Workspace } from "./domain";
import { CommitsView } from "./CommitsView";
import { taskLabel, type CommitFilesResult } from "./task-files";

export function TaskFiles({
  state,
  task,
  results,
  onOpenCanvas,
  onOpenWorkspaceSettings,
}: {
  state: Workspace;
  task: Task;
  results?: CommitFilesResult[];
  onOpenCanvas?: () => void;
  onOpenWorkspaceSettings?: () => void;
}) {
  return (
    <CommitsView
      state={state}
      urls={task.commitUrls}
      label={taskLabel(task)}
      results={results}
      showGrouping={false}
      zoom="corner"
      onOpenCanvas={onOpenCanvas}
      onOpenWorkspaceSettings={onOpenWorkspaceSettings}
    />
  );
}

export default TaskFiles;
