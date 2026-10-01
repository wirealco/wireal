import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button, Dropdown, toast, Typography } from "@heroui/react";
import { ArrowUpRight, Layers2, Refresh } from "./icons";
import type { Workspace } from "./domain";
import {
  commitUrlFiles,
  filesModel,
  groupModes,
  storedGroupBy,
  type CommitFilesError,
  type CommitTask,
  type CommitFilesResult,
  type GroupBy,
} from "./task-files";
import { TaskFilesMap } from "./TaskFilesMap";
import { backend } from "./backend";
import { repository } from "./store";
import { Choice } from "./ui";
import "./task-files.css";

const tokenKinds = new Set<CommitFilesError["kind"]>([
  "unauthorized",
  "not-found",
  "rate-limited",
  "not-connected",
]);

const groupLabels: Record<GroupBy, string> = {
  projects: "taskFiles.groupProjects",
  paths: "taskFiles.groupPaths",
  types: "taskFiles.groupTypes",
};

export function CommitsView({
  state,
  urls,
  label,
  owners,
  results,
  projectId,
  empty = null,
  className = "",
  headerSlot,
  showGrouping = true,
  zoom = "none",
  onOpenTask,
  onOpenCanvas,
  onOpenWorkspaceSettings,
}: {
  state: Workspace;
  urls: readonly string[];
  label: string;
  owners?: ReadonlyMap<string, CommitTask>;
  results?: CommitFilesResult[];
  projectId?: string | null;
  empty?: ReactNode;
  className?: string;
  /** Id of an element outside the canvas that should carry the header row. */
  headerSlot?: string;
  showGrouping?: boolean;
  zoom?: "none" | "dock" | "corner";
  onOpenTask?: (id: string) => void;
  onOpenCanvas?: () => void;
  onOpenWorkspaceSettings?: () => void;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<CommitFilesResult[] | null>(
    results ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>(() =>
    storedGroupBy(localStorage),
  );
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setSlot(headerSlot ? document.getElementById(headerSlot) : null);
  }, [headerSlot]);
  const key = urls.join(" ");
  const live = !results;
  const latest = useRef(urls);
  latest.current = urls;

  useEffect(() => {
    if (!live) return;
    if (!key) {
      setLoaded([]);
      setLoading(false);
      return;
    }
    let listening = true;
    setLoading(true);
    void commitUrlFiles(latest.current, {
      proxy: backend
        ? (list) =>
            backend!.github.commits(repository.getActiveWorkspaceId(), list)
        : undefined,
    }).then((next) => {
      if (!listening) return;
      setLoaded(next);
      setLoading(false);
      const failed = next.filter((result) => result.error);
      if (!failed.length) return;
      const needsSettings = failed.some(
        (result) => result.error && tokenKinds.has(result.error.kind),
      );
      toast.warning(
        failed.every((result) => result.error?.kind === "not-connected")
          ? t("taskFiles.errorNotConnected")
          : t("taskFiles.failedSummary", { count: failed.length }),
        {
          ...(needsSettings && onOpenWorkspaceSettings
            ? {
                actionProps: {
                  children: t("taskFiles.openSettings"),
                  onPress: onOpenWorkspaceSettings,
                },
              }
            : {}),
        },
      );
    });
    return () => {
      listening = false;
    };
  }, [live, key, attempt]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  const group = useCallback((next: GroupBy) => {
    setGroupBy(next);
    try {
      localStorage.setItem("wireal.commits.groupBy", next);
    } catch {
      return;
    }
  }, []);

  const model = useMemo(
    () =>
      filesModel(state, loaded ?? [], label, owners, { groupBy, projectId }),
    [state, loaded, label, owners, groupBy, projectId],
  );
  const focused = model.timeline.find(
    (commit) => commit.ref.sha === focus && commit.ref.sha,
  );
  const chosen = focused ?? model.latest;

  if (!urls.length) return <>{empty}</>;

  const header = (
    <div className="task-files__head">
      <div className="task-files__counts">
        <Typography type="body-sm">
          {t("taskFiles.commits", { count: model.loaded.length })}
          {chosen && chosen.ref.sha ? (
            <>
              {" · "}
              <span className="task-files__sha">
                {chosen.ref.sha.slice(0, 7)}
              </span>
              {!focused && (
                <>
                  {" "}
                  <span className="task-files__latest">
                    {t("taskFiles.latest")}
                  </span>
                </>
              )}
            </>
          ) : null}
          {" · "}
          {t("taskFiles.files", {
            count: chosen ? chosen.paths.length : model.files.length,
          })}
        </Typography>
        <Typography type="body-xs" className="font-mono">
          <span className="task-files__added">
            +{chosen ? chosen.additions : model.additions}
          </span>{" "}
          <span className="task-files__removed">
            −{chosen ? chosen.deletions : model.deletions}
          </span>
        </Typography>
      </div>
      <div className="task-files__actions">
        {showGrouping && (
          <>
            <div className="workspace-commits-group--wide">
              <Choice
                label={t("taskFiles.groupLabel")}
                showLabel={false}
                value={groupBy}
                onChange={(value) => group(value as GroupBy)}
                options={groupModes.map((mode) => ({
                  id: mode,
                  name: t(groupLabels[mode]),
                }))}
              />
            </div>
            <Dropdown>
              <Dropdown.Trigger
                className="button button--icon-only button--sm button--tertiary workspace-commits-group__trigger"
                aria-label={t("taskFiles.groupLabel")}
              >
                <Layers2 size={16} />
              </Dropdown.Trigger>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu
                  aria-label={t("taskFiles.groupLabel")}
                  selectionMode="single"
                  selectedKeys={new Set([groupBy])}
                  onAction={(key) => group(String(key) as GroupBy)}
                >
                  {groupModes.map((mode) => (
                    <Dropdown.Item
                      id={mode}
                      key={mode}
                      textValue={t(groupLabels[mode])}
                    >
                      {t(groupLabels[mode])}
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </>
        )}
        {chosen?.taskId && onOpenTask && (
          <Button
            size="sm"
            variant="primary"
            onPress={() => onOpenTask(chosen.taskId!)}
          >
            {t("taskFiles.openTask")}
          </Button>
        )}
        {onOpenCanvas && (
          <Button size="sm" variant="primary" onPress={onOpenCanvas}>
            <ArrowUpRight size={14} />
            {t("taskFiles.openCanvas")}
          </Button>
        )}
        <Button
          size="sm"
          variant="tertiary"
          isIconOnly
          aria-label={t("taskFiles.retry")}
          onPress={retry}
          isDisabled={loading}
        >
          <Refresh size={14} />
        </Button>
      </div>
    </div>
  );

  return (
    <div className={`task-files ${className}`}>
      {headerSlot ? (slot ? createPortal(header, slot) : null) : header}

      {loading && !model.files.length ? (
        <div className="task-files-skeleton">
          <span aria-hidden="true" />
          <Typography type="body-sm" color="muted">
            {t("taskFiles.loading")}
          </Typography>
        </div>
      ) : (
        <TaskFilesMap
          model={model}
          focus={focus}
          onFocus={setFocus}
          zoom={zoom}
        />
      )}
    </div>
  );
}

export default CommitsView;
