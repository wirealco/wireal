import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Label, Typography } from "@heroui/react";
import {
  ArrowRight,
  ArrowUpRight,
  Circle,
  CircleCheck,
  GitBranch,
  Plus,
  Unlink,
} from "./icons";
import { canConnect, uid, type Status, type Task } from "./domain";
import { repository, useWorkspace } from "./store";
import { Choice, IconButton, SettingsCard } from "./ui";

export function TaskRelations({
  task,
  onSelect,
  onAddSubtask,
  onStatus,
  locked = false,
}: {
  task: Task;
  onSelect: (id: string) => void;
  onAddSubtask: () => void;
  onStatus: (id: string, status: Status) => void;
  locked?: boolean;
}) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const [existingSubtask, setExistingSubtask] = useState("");
  const [dependency, setDependency] = useState("");
  const [unblockedTask, setUnblockedTask] = useState("");
  const parent = state.tasks.find((item) => item.id === task.parentId);
  const children = state.tasks.filter((item) => item.parentId === task.id);
  const incoming = state.links.filter((edge) => edge.target === task.id);
  const outgoing = state.links.filter((edge) => edge.source === task.id);
  const dependencyChoices = state.tasks.filter((item) =>
    canConnect(state, item.id, task.id),
  );
  const unblockChoices = state.tasks.filter((item) =>
    canConnect(state, task.id, item.id),
  );
  const subtaskChoices = state.tasks.filter(
    (item) =>
      item.id !== task.id &&
      item.parentId !== task.id &&
      canConnect(state, task.id, item.id),
  );
  const relations = [
    ...incoming.map((edge) => ({
      edge,
      incoming: true,
      linked: state.tasks.find((item) => item.id === edge.source),
    })),
    ...outgoing.map((edge) => ({
      edge,
      incoming: false,
      linked: state.tasks.find((item) => item.id === edge.target),
    })),
  ].filter((relation) => relation.linked);

  function addConnection(source: string, target: string) {
    repository.commit((current) =>
      canConnect(current, source, target)
        ? {
            ...current,
            links: [...current.links, { id: uid(), source, target }],
          }
        : current,
    );
  }

  const subtasks = (
    <SettingsCard>
      <div data-testid="task-relations" className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-muted" />
          <Label>{t("relations.subtasks")}</Label>
          <Typography type="body-xs" color="muted">
            {children.filter((child) => child.status === "done").length}/
            {children.length}
          </Typography>
          {parent && (
            <span className="node-tag node-tag--accent ml-1">
              <GitBranch size={12} />
              {t("relations.subtask")}
            </span>
          )}
          <Button
            size="sm"
            variant="tertiary"
            className="ml-auto"
            onPress={onAddSubtask}
          >
            <Plus size={14} />
            {t("relations.new")}
          </Button>
        </div>

        {parent && (
          <div className="flex items-center gap-2">
            <Typography type="body-xs" color="muted" className="w-14 shrink-0">
              {t("relations.parent")}
            </Typography>
            <Button
              data-testid="parent-link"
              size="sm"
              variant="tertiary"
              className="min-w-0 flex-1 justify-start"
              onPress={() => onSelect(parent.id)}
            >
              <span className="truncate">{parent.name}</span>
              <ArrowUpRight size={12} />
            </Button>
            <IconButton
              label={t("relations.removeParent", { name: parent.name })}
              variant="danger-soft"
              disabled={locked}
              onPress={() =>
                repository.commit((current) => ({
                  ...current,
                  tasks: current.tasks.map((item) =>
                    item.id === task.id ? { ...item, parentId: null } : item,
                  ),
                }))
              }
            >
              <Unlink size={14} />
            </IconButton>
          </div>
        )}

        <div className="flex flex-col gap-1">
          {children.map((child) => (
            <div
              key={child.id}
              data-status={child.status}
              className="subtask-row flex items-center gap-1"
            >
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                className={`subtask-row__icon ${child.status === "done" ? "text-success" : "text-muted"}`}
                aria-label={t(
                  child.status === "done"
                    ? "relations.reopen"
                    : "relations.complete",
                  { name: child.name },
                )}
                onPress={() =>
                  onStatus(child.id, child.status === "done" ? "todo" : "done")
                }
              >
                {child.status === "done" ? (
                  <CircleCheck size={16} />
                ) : (
                  <Circle size={16} />
                )}
              </Button>
              <Button
                size="sm"
                variant="tertiary"
                className="min-w-0 flex-1 justify-start"
                onPress={() => onSelect(child.id)}
              >
                <span className="subtask-row__name">{child.name}</span>
              </Button>
              <IconButton
                label={t("relations.detach", { name: child.name })}
                onPress={() =>
                  repository.commit((current) => ({
                    ...current,
                    tasks: current.tasks.map((item) =>
                      item.id === child.id ? { ...item, parentId: null } : item,
                    ),
                  }))
                }
              >
                <Unlink size={14} />
              </IconButton>
            </div>
          ))}
          {!children.length && (
            <Typography type="body-xs" color="muted">
              {t("relations.noSubtasks")}
            </Typography>
          )}
        </div>

        {subtaskChoices.length > 0 && (
          <Choice
            label={t("relations.attachExisting")}
            disabled={locked}
            value={existingSubtask}
            options={[
              { id: "", name: t("relations.chooseTask") },
              ...subtaskChoices.map((item) => ({
                id: item.id,
                name: item.name,
              })),
            ]}
            onChange={(id) => {
              setExistingSubtask(id);
              if (id)
                repository.commit((current) => ({
                  ...current,
                  tasks: current.tasks.map((item) =>
                    item.id === id ? { ...item, parentId: task.id } : item,
                  ),
                }));
              setExistingSubtask("");
            }}
          />
        )}
      </div>
    </SettingsCard>
  );
  const dependencies = (
    <SettingsCard>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <Label>{t("relations.dependencies")}</Label>
          <Typography type="body-xs" color="muted">
            {t("relations.direction")}
          </Typography>
        </div>

        <div className="flex flex-col gap-1">
          {relations.map(({ edge, incoming: isIncoming, linked }) => (
            <div key={edge.id} className="flex min-w-0 items-center gap-2">
              <Typography
                type="body-xs"
                color="muted"
                className="w-16 shrink-0"
              >
                {isIncoming ? t("relations.needs") : t("relations.unblocks")}
              </Typography>
              {isIncoming ? (
                <>
                  <Button
                    size="sm"
                    variant="tertiary"
                    className="min-w-0 flex-1 justify-start"
                    onPress={() => onSelect(linked!.id)}
                  >
                    <span className="truncate">{linked!.name}</span>
                  </Button>
                  <ArrowRight size={14} className="shrink-0 text-accent" />
                  <Typography
                    type="body-xs"
                    weight="semibold"
                    className="shrink-0"
                  >
                    {t("relations.thisTask")}
                  </Typography>
                </>
              ) : (
                <>
                  <Typography
                    type="body-xs"
                    weight="semibold"
                    className="shrink-0"
                  >
                    {t("relations.thisTask")}
                  </Typography>
                  <ArrowRight size={14} className="shrink-0 text-accent" />
                  <Button
                    size="sm"
                    variant="tertiary"
                    className="min-w-0 flex-1 justify-start"
                    onPress={() => onSelect(linked!.id)}
                  >
                    <span className="truncate">{linked!.name}</span>
                  </Button>
                </>
              )}
              <IconButton
                label={t("relations.removeRelation", { name: linked!.name })}
                onPress={() =>
                  repository.commit((current) => ({
                    ...current,
                    links: current.links.filter((item) => item.id !== edge.id),
                  }))
                }
              >
                <Unlink size={14} />
              </IconButton>
            </div>
          ))}
          {!relations.length && (
            <Typography type="body-xs" color="muted">
              {t("relations.noDependencies")}
            </Typography>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Choice
            label={t("relations.addDependency")}
            value={dependency}
            disabled={!dependencyChoices.length}
            options={[
              { id: "", name: t("relations.dependsOn") },
              ...dependencyChoices.map((item) => ({
                id: item.id,
                name: item.name,
              })),
            ]}
            onChange={(id) => {
              setDependency(id);
              if (id) addConnection(id, task.id);
              setDependency("");
            }}
          />
          <Choice
            label={t("relations.addFollowUp")}
            value={unblockedTask}
            disabled={!unblockChoices.length}
            options={[
              { id: "", name: t("relations.unblocksChoice") },
              ...unblockChoices.map((item) => ({
                id: item.id,
                name: item.name,
              })),
            ]}
            onChange={(id) => {
              setUnblockedTask(id);
              if (id) addConnection(task.id, id);
              setUnblockedTask("");
            }}
          />
        </div>
      </div>
    </SettingsCard>
  );
  return (
    <>
      {subtasks}
      {dependencies}
    </>
  );
}
