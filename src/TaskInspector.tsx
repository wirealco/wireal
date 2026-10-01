import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { activityAgentBrand, activityAuthorName } from "./activity-author";
import { PersonAvatar, PersonFace, TaskEditorList } from "./TaskPeople";
import { personOf, taskPeople } from "./task-people";
import { ActivityBloub } from "./ActivityBloub";
import {
  Button,
  Chip,
  Input,
  Label,
  Modal,
  ScrollShadow,
  Surface,
  TextField,
  Tooltip,
  Typography,
} from "@heroui/react";
import { ArrowUpRight, Lock, Pencil, Trash2, Undo2, Unlock } from "./icons";
import {
  agentSettings,
  event,
  openReview,
  removeTask,
  sendBack,
  updateTask,
  type Activity,
  type Status,
  type Task,
} from "./domain";
import { repository, useWorkspace } from "./store";
import { formatDateTime } from "./i18n";
import {
  Dialog,
  Field,
  IconButton,
  LabelPicker,
  ProjectPicker,
  SettingRow,
  SettingsCard,
  StatusMenu,
  TaskId,
  TextareaField,
} from "./ui";
import { TaskRelations } from "./TaskRelations";
import { brandName, type TaskLock } from "./runners";
import { CommitLinks } from "./CommitLinks";
import { TaskFiles } from "./TaskFiles";
import { taskRepository, workspaceKind } from "./domain";
import {
  ActivityFacts,
  ActivityKindLabel,
  ActivityText,
  activityCommitUrl,
  commitShaUrl,
} from "./ActivityText";
import { ReportView, TaskStatusLine } from "./TaskReport";

/* Entries the app writes for itself when a task is edited. They are kept —
   they are how a card knows who has worked on it — but the list below is for
   what people and agents said, so the bookkeeping stays out of it. */
const automaticActivity =
  /^(Task created|Added label |Removed label |Added as subtask|Removed relation to |Depends on |Connected to |Status changed to |Task renamed|Objective updated|Updated project membership|Updated task labels)/;

function ActivityAvatar({ activity }: { activity: Activity }) {
  if (activity.authorType === "user") {
    // The same face the card wears for them: their photo when the app has
    // one, their initials on the avatar's own ground when it does not.
    const person = personOf(activity);
    if (person) return <PersonFace person={person} size="lg" />;
    // An entry that never recorded an account is nobody in particular, so it
    // gets the initials of the name it was signed with and no photo: a picture
    // would have to be chosen by name, and a name is not evidence of who acted.
    const name = activity.author.trim();
    return name ? (
      <PersonAvatar
        name={name}
        size="md"
        className="task-people__face task-people__face--lg task-people__face--person"
        aria-hidden={true}
      />
    ) : null;
  }
  const brand = activityAgentBrand(activity);
  const delay =
    Array.from(activity.id).reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    ) % 5;
  return (
    <span className="task-people__face task-people__face--lg task-people__face--agent">
      <ActivityBloub
        brand={brand}
        label={activityAuthorName(activity)}
        delay={delay}
      />
    </span>
  );
}
type LockPrompt = { action: "lock" | "unlock"; line: boolean };

export function TaskInspector({
  task,
  onClose,
  onAddSubtask,
  onSelect,
  onStatus,
  activityAuthor,
  lock,
  canLock,
  lockHint,
  canUnlock,
  line,
  onLock,
  onUnlock,
  onSendBack,
  onOpenCommits,
  onOpenWorkspaceSettings,
}: {
  task: Task;
  onClose: () => void;
  onAddSubtask: () => void;
  onSelect: (id: string) => void;
  onStatus: (id: string, status: Status) => void;
  activityAuthor: { author: string; authorType: "user"; authorId?: string };
  lock?: TaskLock | null;
  canLock?: boolean;
  lockHint?: string;
  canUnlock?: boolean;
  line?: Task[];
  onLock?: (line: boolean) => void;
  onUnlock?: (line: boolean) => void;
  /** Holds the task for the named roster agent so the runner that seats it
   *  picks the review up. Without a runner the entry still stands and the
   *  card still shows it; nothing is silently dropped. */
  onSendBack?: (taskId: string, agent: string) => void;
  onOpenCommits?: () => void;
  onOpenWorkspaceSettings?: () => void;
}) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const [name, setName] = useState(task.name);
  const [objective, setObjective] = useState(task.objective);
  const [activity, setActivity] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [prompt, setPrompt] = useState<LockPrompt | null>(null);
  const [returning, setReturning] = useState(false);
  const [complaint, setComplaint] = useState("");
  const [addressee, setAddressee] = useState("");
  const locked = !!lock;
  const lockOwner = lock?.owner_name || t("locks.someone");
  const lockedBy = t("locks.lockedBy", { name: lockOwner });
  const lockLine = line ?? [task];
  useEffect(() => setName(task.name), [task.name]);
  useEffect(() => setObjective(task.objective), [task.objective]);
  const children = state.tasks.filter((t) => t.parentId === task.id);
  const activities = task.activity
    .filter((item) => !automaticActivity.test(item.text))
    .slice()
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const people = taskPeople(task);
  const coding = workspaceKind(state) === "coding";
  const repositoryUrl = taskRepository(state, task);
  const review = openReview(task);
  const roster =
    agentSettings(state).roster?.filter((spec) => spec.enabled) ?? [];
  function saveName() {
    if (name.trim() && name.trim() !== task.name)
      repository.commit((s) =>
        updateTask(
          s,
          task.id,
          { name: name.trim() },
          "Task renamed",
          activityAuthor,
        ),
      );
    else setName(task.name);
  }
  const details = (
    <ScrollShadow
      orientation="vertical"
      variant="fade"
      hideScrollBar
      className="task-inspector__scroll flex max-h-[76dvh] min-h-0 min-w-0 flex-1 flex-col gap-3 p-4"
    >
      {coding && (
        <div className="flex min-w-0 shrink-0 flex-col">
          <TaskFiles
            state={state}
            task={task}
            onOpenCanvas={onOpenCommits}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          />
        </div>
      )}
      <div className="grid min-w-0 items-start gap-3 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          {!!review && (
            <div className="task-inspector__review">
              <span className="task-inspector__review-head">
                <Undo2 size={14} />
                {t("review.banner", { name: activityAuthorName(review) })}
                {!!review.to && (
                  <span className="task-inspector__review-to">
                    {t("review.to", { name: review.to })}
                  </span>
                )}
              </span>
              <span className="task-inspector__review-text">{review.text}</span>
            </div>
          )}
          {locked && (
            <div className="task-inspector__lock" title={lockedBy}>
              <Lock size={14} />
              <span>{lockedBy}</span>
              {!!lock?.agent && (
                <span className="task-inspector__lock-agent">
                  {t("locks.lockedToAgent")}
                </span>
              )}
            </div>
          )}
          <SettingsCard
            title={t("taskInspector.details")}
            end={
              <Chip size="sm" variant="soft">
                <Chip.Label>
                  <TaskId value={task.referenceId} />
                </Chip.Label>
              </Chip>
            }
          >
            <div className="flex min-w-0 flex-col gap-4">
              {editingName && (
                <Field
                  label={t("taskInspector.taskName")}
                  value={name}
                  onChange={setName}
                  onBlur={() => {
                    saveName();
                    setEditingName(false);
                  }}
                  disabled={locked}
                />
              )}
              <SettingRow title={t("taskList.status")}>
                <StatusMenu
                  label={t("taskList.status")}
                  status={task.status}
                  disabled={locked && !canUnlock}
                  onChange={(v) => onStatus(task.id, v)}
                />
              </SettingRow>
              <div className="flex min-w-0 flex-col gap-2">
                <Label>{t("taskPeople.editors")}</Label>
                <TaskEditorList people={people} />
              </div>
            </div>
          </SettingsCard>
          <SettingsCard
            title={t("taskInspector.objective")}
            end={
              <Button
                size="sm"
                variant="tertiary"
                isDisabled={locked || objective.trim() === task.objective}
                onPress={() =>
                  repository.commit((current) =>
                    updateTask(
                      current,
                      task.id,
                      { objective: objective.trim() },
                      "Objective updated",
                      activityAuthor,
                    ),
                  )
                }
              >
                Save
              </Button>
            }
          >
            <TextareaField
              label={t("taskInspector.objective")}
              value={objective}
              onChange={setObjective}
              placeholder="Describe the result this task should achieve..."
              rows={3}
              showLabel={false}
              autoSize
              disabled={locked}
            />
          </SettingsCard>
          <SettingsCard>
            <ProjectPicker
              projects={state.projects}
              value={task.projectIds}
              presentation="orbs"
              onChange={(ids) =>
                repository.commit((s) =>
                  updateTask(
                    s,
                    task.id,
                    { projectIds: ids },
                    "Updated project membership",
                    activityAuthor,
                  ),
                )
              }
            />
          </SettingsCard>
          <TaskRelations
            task={task}
            onSelect={onSelect}
            onAddSubtask={onAddSubtask}
            onStatus={onStatus}
            locked={locked}
          />
          {coding && (
            <SettingsCard>
              <CommitLinks task={task} author={activityAuthor} />
            </SettingsCard>
          )}
          <SettingsCard>
            <LabelPicker
              labels={state.labels}
              value={task.labels}
              onChange={(labels) =>
                repository.commit((current) =>
                  updateTask(
                    current,
                    task.id,
                    { labels },
                    "Updated task labels",
                    activityAuthor,
                  ),
                )
              }
            />
          </SettingsCard>
        </div>
        <SettingsCard
          title={t("taskInspector.activity")}
          end={
            <Chip size="sm" variant="soft">
              <Chip.Label>{activities.length}</Chip.Label>
            </Chip>
          }
        >
          <div className="flex min-w-0 flex-col gap-3">
            <TaskStatusLine task={task} />
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (activity.trim())
                  repository.commit((s) => ({
                    ...s,
                    tasks: s.tasks.map((t) =>
                      t.id === task.id
                        ? {
                            ...t,
                            activity: [
                              event(activity.trim(), activityAuthor),
                              ...t.activity,
                            ],
                          }
                        : t,
                    ),
                  }));
                setActivity("");
              }}
            >
              <TextField
                aria-label={t("taskInspector.addActivity")}
                className="min-w-0 flex-1"
                value={activity}
                onChange={setActivity}
              >
                <Input
                  aria-label={t("taskInspector.addActivity")}
                  placeholder="Write an update..."
                  maxLength={500}
                />
              </TextField>
              <Button
                type="submit"
                variant="primary"
                isIconOnly
                aria-label={t("taskInspector.saveActivity")}
                isDisabled={!activity.trim()}
              >
                <ArrowUpRight size={16} />
              </Button>
            </form>
            <div data-testid="activity-list" className="flex flex-col">
              {activities.map((a) => (
                <div key={a.id} className="flex items-start gap-2 py-1.5">
                  <span className="mt-0.5 grid size-10 shrink-0 place-items-center">
                    <ActivityAvatar activity={a} />
                  </span>
                  <Surface
                    variant="secondary"
                    className="min-w-0 flex-1 rounded-2xl rounded-tl-md p-3"
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <Typography type="body-xs" weight="semibold">
                        {activityAuthorName(a)}
                      </Typography>
                      <Typography
                        type="body-xs"
                        color="muted"
                        className="ml-auto"
                      >
                        {formatDateTime(a.at)}
                      </Typography>
                      <IconButton
                        label={t("taskInspector.deleteActivity", {
                          author: a.author,
                        })}
                        onPress={() =>
                          repository.commit((s) => ({
                            ...s,
                            tasks: s.tasks.map((t) =>
                              t.id === task.id
                                ? {
                                    ...t,
                                    activity: t.activity.filter(
                                      (item) => item.id !== a.id,
                                    ),
                                  }
                                : t,
                            ),
                          }))
                        }
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                    <Typography type="body-xs" className="break-words">
                      {a.kind && <ActivityKindLabel kind={a.kind} to={a.to} />}
                      {a.kind === "report" ? (
                        <ReportView text={a.text} />
                      ) : (
                        <ActivityText
                          text={a.text}
                          statusOrbs={state.statusOrbs}
                          commitUrl={
                            coding
                              ? activityCommitUrl(a.text, task.commitUrls)
                              : undefined
                          }
                        />
                      )}
                    </Typography>
                    <ActivityFacts
                      commit={a.commit}
                      commitUrl={
                        coding && a.commit
                          ? commitShaUrl(repositoryUrl, a.commit)
                          : undefined
                      }
                    />
                  </Surface>
                </div>
              ))}
              {!activities.length && (
                <Typography type="body-xs" color="muted">
                  No activity yet
                </Typography>
              )}
            </div>
          </div>
        </SettingsCard>
      </div>
    </ScrollShadow>
  );
  if (returning)
    return (
      <Dialog
        title={t("review.title")}
        description={t("review.intro")}
        onClose={() => setReturning(false)}
      >
        <Modal.Body className="flex min-h-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <Label>{t("review.agent")}</Label>
            {roster.length ? (
              <div className="task-inspector__agents">
                {roster.map((spec) => (
                  <button
                    key={spec.id}
                    type="button"
                    className="task-inspector__agent"
                    aria-pressed={spec.id === addressee}
                    data-chosen={spec.id === addressee || undefined}
                    onClick={() =>
                      setAddressee((current) =>
                        current === spec.id ? "" : spec.id,
                      )
                    }
                  >
                    <span className="task-inspector__agent-bloub">
                      <ActivityBloub
                        brand={spec.kind}
                        label={spec.name.trim() || brandName(spec.kind)}
                      />
                    </span>
                    {spec.name.trim() || brandName(spec.kind)}
                  </button>
                ))}
              </div>
            ) : (
              <Typography type="body-xs" color="muted">
                {t("review.noRoster")}
              </Typography>
            )}
            <Typography type="body-xs" color="muted">
              {addressee
                ? t("review.directed", {
                    name:
                      roster
                        .find((spec) => spec.id === addressee)
                        ?.name.trim() || t("review.thatAgent"),
                  })
                : agentSettings(state).mode === "directed"
                  ? t("review.anyoneDirected")
                  : t("review.anyoneAutomatic")}
            </Typography>
          </div>
          <TextareaField
            label={t("review.wrong")}
            value={complaint}
            onChange={setComplaint}
            placeholder={t("review.wrongPlaceholder")}
            rows={5}
            maxLength={2000}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="tertiary"
            size="sm"
            onPress={() => setReturning(false)}
          >
            {t("review.cancel")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="review-action review-action--solid"
            isDisabled={!complaint.trim()}
            onPress={() => {
              const spec = roster.find((entry) => entry.id === addressee);
              repository.commit((current) =>
                sendBack(
                  current,
                  task.id,
                  { text: complaint.trim(), to: spec?.name },
                  activityAuthor,
                ),
              );
              if (spec) onSendBack?.(task.id, spec.id);
              setReturning(false);
              setComplaint("");
            }}
          >
            <Undo2 size={14} />
            {t("review.send")}
          </Button>
        </Modal.Footer>
      </Dialog>
    );
  if (prompt)
    return (
      <Dialog
        title={t(
          prompt.action === "lock"
            ? "locks.lockLineTitle"
            : prompt.line
              ? "locks.unlockLineTitle"
              : "locks.unlockTitle",
        )}
        onClose={() => setPrompt(null)}
      >
        <Modal.Body className="flex min-h-0 flex-col gap-3">
          <Typography type="body-sm">
            {t(
              prompt.action === "lock"
                ? "locks.lockLineIntro"
                : "locks.unlockIntro",
            )}
          </Typography>
          {prompt.line && (
            <ScrollShadow
              orientation="vertical"
              variant="fade"
              hideScrollBar
              className="task-inspector__line"
            >
              {lockLine.map((entry) => (
                <div className="task-inspector__line-row" key={entry.id}>
                  <span className="task-inspector__line-name">
                    <TaskId value={entry.referenceId} /> {entry.name}
                  </span>
                  <Typography type="body-xs" color="muted">
                    {entry.objective.trim() || t("locks.noObjective")}
                  </Typography>
                </div>
              ))}
            </ScrollShadow>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" size="sm" onPress={() => setPrompt(null)}>
            {t("locks.cancel")}
          </Button>
          <Button
            variant={prompt.action === "lock" ? "primary" : "danger"}
            size="sm"
            onPress={() => {
              if (prompt.action === "lock") onLock?.(prompt.line);
              else onUnlock?.(prompt.line);
              setPrompt(null);
            }}
          >
            {t("locks.confirm")}
          </Button>
        </Modal.Footer>
      </Dialog>
    );
  return (
    <Dialog
      title={task.name}
      onClose={onClose}
      size="sm"
      dialogClassName="w-[calc(100vw-2rem)] max-w-[1000px]"
      headerEnd={
        <IconButton
          label={t("taskInspector.editName")}
          disabled={locked}
          onPress={() => setEditingName((current) => !current)}
        >
          <Pencil size={16} />
        </IconButton>
      }
    >
      <Modal.Body className="task-inspector__body flex min-h-0 flex-col p-0">
        {details}
      </Modal.Body>
      <Modal.Footer className="flex-wrap justify-between gap-2">
        <span className="inline-flex" title={locked ? lockedBy : undefined}>
          <Button
            variant="danger"
            size="sm"
            isDisabled={locked}
            onPress={() => {
              repository.commit((s) => removeTask(s, task.id));
              onClose();
            }}
          >
            <Trash2 size={14} />
            Delete task{children.length ? " & subtasks" : ""}
          </Button>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {task.status === "done" && !review && (
            <Button
              variant="secondary"
              size="sm"
              className="review-action"
              isDisabled={locked}
              onPress={() => {
                setComplaint("");
                setAddressee("");
                setReturning(true);
              }}
            >
              <Undo2 size={14} />
              {t("review.sendBack")}
            </Button>
          )}
          {locked ? (
            canUnlock && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => setPrompt({ action: "unlock", line: false })}
                >
                  <Unlock size={14} />
                  {t("locks.unlock")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => setPrompt({ action: "unlock", line: true })}
                >
                  <Unlock size={14} />
                  {t("locks.unlockLine")}
                </Button>
              </>
            )
          ) : (
            <>
              <Tooltip delay={0} isDisabled={canLock}>
                <Tooltip.Trigger className="inline-flex">
                  <Button
                    variant="secondary"
                    size="sm"
                    isDisabled={!canLock}
                    onPress={() => onLock?.(false)}
                  >
                    <Lock size={14} />
                    {t("locks.lock")}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content placement="top">
                  {lockHint ?? t("locks.needRunner")}
                </Tooltip.Content>
              </Tooltip>
              <Tooltip delay={0} isDisabled={canLock}>
                <Tooltip.Trigger className="inline-flex">
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={!canLock}
                    onPress={() => setPrompt({ action: "lock", line: true })}
                  >
                    <Lock size={14} />
                    {t("locks.lockLine")}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content placement="top">
                  {lockHint ?? t("locks.needRunner")}
                </Tooltip.Content>
              </Tooltip>
            </>
          )}
        </div>
      </Modal.Footer>
    </Dialog>
  );
}
