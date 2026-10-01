import {
  Chip,
  Disclosure,
  Link,
  Table,
  Typography,
  ScrollShadow,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { GitCommitHorizontal, Undo2 } from "./icons";
import {
  launchOrder,
  openReview,
  workspaceKind,
  statuses,
  type Status,
  type Task,
  type Workspace,
} from "./domain";
import { LabelBadge, ProjectBadge, StatusChip, StatusMenu, TaskId } from "./ui";
import { TaskPeople } from "./TaskPeople";
import { taskPeople } from "./task-people";
import { useIsCompact } from "./breakpoint";

export function TaskList({
  tasks,
  state,
  projectId,
  groupBy,
  onSelect,
  onStatus,
}: {
  tasks: Task[];
  state: Workspace;
  projectId: string;
  groupBy: string;
  onSelect: (id: string) => void;
  onStatus: (id: string, status: Status) => void;
}) {
  const { t } = useTranslation();
  const order = launchOrder(state);
  const coding = workspaceKind(state) === "coding";
  /* A table this wide only fits by scrolling sideways on a phone, which hides
     the columns that matter. The same rows become cards there instead. */
  const compact = useIsCompact();
  const lastEdited = (task: Task) =>
    task.activity.reduce((latest, item) => {
      const at = Date.parse(item.at);
      return Number.isFinite(at) && at > latest ? at : latest;
    }, 0);
  const mostRecentFirst = (group: Task[]) =>
    [...group].sort(
      (left, right) =>
        lastEdited(right) - lastEdited(left) ||
        (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  const groups: {
    id: string;
    name: string;
    color?: string;
    tasks: Task[];
  }[] =
    groupBy === "status"
      ? Object.keys(statuses).map((id) => ({
          id,
          name: t(`status.${id}`),
          tasks: mostRecentFirst(tasks.filter((t) => t.status === id)),
        }))
      : groupBy === "project"
        ? state.projects.map((p) => ({
            id: p.id,
            name: p.name,
            tasks: mostRecentFirst(
              tasks.filter((t) => t.projectIds.includes(p.id)),
            ),
          }))
        : state.labels.map((label) => ({
            id: label.id,
            name: label.name,
            color: label.color,
            tasks: mostRecentFirst(
              tasks.filter((t) => t.labels.includes(label.name)),
            ),
          }));
  return (
    <ScrollShadow
      orientation="vertical"
      variant="fade"
      hideScrollBar
      className="task-list flex min-h-0 flex-1 flex-col gap-3"
    >
      {groups
        .filter((g) => g.tasks.length > 0)
        .map((group) => (
          <Disclosure key={`${groupBy}-${group.id}`} defaultExpanded>
            <Disclosure.Heading>
              <Disclosure.Trigger className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                <Disclosure.Indicator />
                <span className="flex min-w-0 items-center gap-2">
                  {groupBy === "status" ? (
                    <StatusChip status={group.id as Status} size="md" />
                  ) : groupBy === "project" ? (
                    <ProjectBadge
                      project={state.projects.find((p) => p.id === group.id)!}
                    />
                  ) : (
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: group.color ?? "#a1a1aa" }}
                      />
                      <Typography weight="medium" className="truncate">
                        {group.name}
                      </Typography>
                    </span>
                  )}
                </span>
                <Chip size="sm" variant="secondary">
                  {group.tasks.length}
                </Chip>
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <Disclosure.Body>
                {compact ? (
                  <ul
                    className="task-list-cards"
                    aria-label={t("taskList.groupTasks", { name: group.name })}
                  >
                    {group.tasks.map((task) => (
                      <li key={task.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          data-testid="task-row"
                          data-status={task.status}
                          data-review={openReview(task) ? "open" : undefined}
                          className="task-list-card"
                          onClick={() => onSelect(task.id)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ")
                              return;
                            event.preventDefault();
                            onSelect(task.id);
                          }}
                        >
                          <div className="task-list-card__head">
                            {!!openReview(task) && (
                              <span className="node-tag node-tag--review">
                                <Undo2 size={12} />
                                {t("review.open")}
                              </span>
                            )}
                            {projectId !== "all" &&
                              !task.projectIds.includes(projectId) && (
                                <Chip size="sm" variant="secondary">
                                  {t("taskList.related")}
                                </Chip>
                              )}
                            {/* The menu is a control inside a control: its clicks
                                must not also open the task. */}
                            <div
                              className="task-list-card__status"
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              <StatusMenu
                                label={t("taskList.statusFor", {
                                  name: task.name,
                                })}
                                status={task.status}
                                onChange={(next) => onStatus(task.id, next)}
                              />
                            </div>
                          </div>
                          <div className="task-list-card__name">
                            {task.name}
                          </div>
                          <Typography type="body-xs" color="muted">
                            <TaskId value={task.referenceId} />
                          </Typography>
                          {(task.projectIds.length > 0 ||
                            task.labels.length > 0) && (
                            <div className="task-list-card__meta">
                              {state.projects
                                .filter((p) => task.projectIds.includes(p.id))
                                .map((p) => (
                                  <ProjectBadge key={p.id} project={p} />
                                ))}
                              {task.labels.map((l) => (
                                <LabelBadge key={l} name={l} />
                              ))}
                            </div>
                          )}
                          <TaskPeople people={taskPeople(task)} />
                          {coding && task.commitUrls.length > 0 && (
                            <div onClick={(event) => event.stopPropagation()}>
                              <Link
                                href={task.commitUrls[0]}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t("taskList.openCommit", {
                                  name: task.name,
                                })}
                              >
                                <GitCommitHorizontal size={14} />
                                {task.commitUrls[0]
                                  .split("/")
                                  .at(-1)
                                  ?.slice(0, 8)}
                                {task.commitUrls.length > 1
                                  ? ` +${task.commitUrls.length - 1}`
                                  : ""}
                              </Link>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Table>
                    <Table.ScrollContainer>
                      <Table.Content
                        aria-label={t("taskList.groupTasks", {
                          name: group.name,
                        })}
                        className="min-w-[600px]"
                        onRowAction={(key) => onSelect(String(key))}
                      >
                        <Table.Header>
                          <Table.Column
                            isRowHeader
                            className="whitespace-nowrap"
                          >
                            {t("taskList.task")}
                          </Table.Column>
                          <Table.Column className="whitespace-nowrap">
                            {t("taskList.solutions")}
                          </Table.Column>
                          <Table.Column className="whitespace-nowrap">
                            {t("taskList.labels")}
                          </Table.Column>
                          <Table.Column className="whitespace-nowrap">
                            {t("taskList.editors")}
                          </Table.Column>
                          {coding && (
                            <Table.Column className="whitespace-nowrap">
                              {t("taskList.commit")}
                            </Table.Column>
                          )}
                          <Table.Column className="whitespace-nowrap">
                            {t("taskList.status")}
                          </Table.Column>
                        </Table.Header>
                        <Table.Body>
                          {group.tasks.map((task) => (
                            <Table.Row
                              key={task.id}
                              id={task.id}
                              data-testid="task-row"
                              data-status={task.status}
                              data-review={
                                openReview(task) ? "open" : undefined
                              }
                              className="workspace-task-row cursor-pointer"
                            >
                              <Table.Cell>
                                <div className="flex items-center gap-1">
                                  <div className="max-w-64 px-3 py-2">
                                    <div className="truncate">{task.name}</div>
                                    <Typography
                                      type="body-xs"
                                      color="muted"
                                      className="truncate"
                                    >
                                      <TaskId value={task.referenceId} />
                                    </Typography>
                                  </div>
                                  {!!openReview(task) && (
                                    <span className="node-tag node-tag--review">
                                      <Undo2 size={12} />
                                      {t("review.open")}
                                    </span>
                                  )}
                                  {projectId !== "all" &&
                                    !task.projectIds.includes(projectId) && (
                                      <Chip size="sm" variant="secondary">
                                        {t("taskList.related")}
                                      </Chip>
                                    )}
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                <div className="flex flex-wrap gap-1">
                                  {state.projects
                                    .filter((p) =>
                                      task.projectIds.includes(p.id),
                                    )
                                    .map((p) => (
                                      <ProjectBadge key={p.id} project={p} />
                                    ))}
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                <div className="flex flex-wrap gap-1.5">
                                  {task.labels.map((l) => (
                                    <LabelBadge key={l} name={l} />
                                  ))}
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                {taskPeople(task).length ? (
                                  <TaskPeople people={taskPeople(task)} />
                                ) : (
                                  <Typography type="body-xs" color="muted">
                                    {t("taskList.none")}
                                  </Typography>
                                )}
                              </Table.Cell>
                              {coding && (
                                <Table.Cell>
                                  {task.commitUrls.length ? (
                                    <Link
                                      href={task.commitUrls[0]}
                                      target="_blank"
                                      rel="noreferrer"
                                      aria-label={t("taskList.openCommit", {
                                        name: task.name,
                                      })}
                                    >
                                      <GitCommitHorizontal size={14} />
                                      {task.commitUrls[0]
                                        .split("/")
                                        .at(-1)
                                        ?.slice(0, 8)}
                                      {task.commitUrls.length > 1
                                        ? ` +${task.commitUrls.length - 1}`
                                        : ""}
                                    </Link>
                                  ) : (
                                    <Typography type="body-xs" color="muted">
                                      {t("taskList.none")}
                                    </Typography>
                                  )}
                                </Table.Cell>
                              )}
                              <Table.Cell>
                                <StatusMenu
                                  label={t("taskList.statusFor", {
                                    name: task.name,
                                  })}
                                  status={task.status}
                                  onChange={(s) => onStatus(task.id, s)}
                                />
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                )}
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        ))}
    </ScrollShadow>
  );
}
