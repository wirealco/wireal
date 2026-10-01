import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button, Typography } from "@heroui/react";
import type { Task, Workspace } from "./domain";
import { CommitsView } from "./CommitsView";
import { commitTasks, commitUrls } from "./task-files";

export function WorkspaceCommits({
  state,
  tasks,
  projectId,
  headerSlot,
  onOpenTask,
  onOpenWorkspaceSettings,
  onCreate,
}: {
  state: Workspace;
  tasks: readonly Task[];
  projectId?: string | null;
  headerSlot?: string;
  onOpenTask?: (id: string) => void;
  onOpenWorkspaceSettings?: () => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const urls = useMemo(() => commitUrls(tasks), [tasks]);
  const owners = useMemo(() => commitTasks(tasks), [tasks]);

  return (
    <CommitsView
      state={state}
      urls={urls}
      label={state.map.name}
      owners={owners}
      projectId={projectId}
      className="task-files--canvas"
      zoom="dock"
      headerSlot={headerSlot}
      onOpenTask={onOpenTask}
      onOpenWorkspaceSettings={onOpenWorkspaceSettings}
      empty={
        <div className="task-files-empty">
          <div className="flex flex-col items-center gap-4">
            <Typography type="body-sm" color="muted">
              {tasks.length
                ? t("taskFiles.noCommits")
                : state.projects.length
                  ? t("workspace.noTasks")
                  : t("workspace.firstProject")}
            </Typography>
            {!tasks.length && (
              <Button variant="primary" onPress={onCreate}>
                {state.projects.length
                  ? t("workspace.newTask")
                  : t("workspace.createProject")}
              </Button>
            )}
          </div>
        </div>
      }
    />
  );
}

export default WorkspaceCommits;
