import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Description,
  Label,
  Modal,
  ScrollShadow,
  Typography,
} from "@heroui/react";
import { useReactFlow } from "@xyflow/react";
import { Trash2 } from "./icons";
import {
  normalizeCommitUrl,
  normalizeRepositoryUrl,
  projectPaths,
  removeProject,
  repositoryLayout,
  workspaceKind,
  taskReferenceId,
  event,
  uid,
  type Activity,
  type Status,
} from "./domain";
import { repository, useWorkspace } from "./store";
import {
  Choice,
  Dialog,
  Field,
  IconButton,
  LabelPicker,
  ProjectPicker,
  SettingsCard,
  statusOptions,
  TextareaField,
} from "./ui";
import { randomOrb } from "./orb-settings";
import { OrbEditor } from "./OrbEditor";
import { ProjectFolderPicker } from "./ProjectFolderPicker";
import {
  connectedRepositories,
  GitHubRepositorySelect,
  ReadOnlySetting,
  useCollaborator,
  useGitHubStatus,
} from "./WorkspaceGitHubSettings";

export type EditorMode = {
  type: "task" | "project";
  parentId?: string;
  editId?: string;
};
export function EditorModal({
  mode,
  projectId,
  onClose,
  onCreated,
  author,
}: {
  mode: EditorMode;
  projectId: string;
  onClose: () => void;
  onCreated: (id: string, type: "task" | "project") => void;
  /** Who is creating: a new task's first activity entry names them. */
  author: Pick<Activity, "author" | "authorType" | "authorId">;
}) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const editing = state.projects.find((p) => p.id === mode.editId);
  const parent = state.tasks.find((t) => t.id === mode.parentId);
  const [name, setName] = useState(editing?.name ?? "");
  const [orb, setOrb] = useState(() => editing?.orb ?? randomOrb());
  const [repo, setRepo] = useState(editing?.repositoryUrl ?? "");
  const [paths, setPaths] = useState<string[]>(() =>
    projectPaths({ paths: editing?.paths }),
  );
  const monorepo = repositoryLayout(state) === "monorepo";
  const coding = workspaceKind(state) === "coding";
  const workspaceId = repository.getActiveWorkspaceId();
  const { status: githubStatus } = useGitHubStatus(workspaceId);
  const repositories = connectedRepositories(githubStatus);
  // The owner decides which repositories and folders the workspace reads; the
  // server refuses anyone else's change. A collaborator keeps an existing
  // project's repository and folders as they are, and may start a new project
  // only on a repository the owner already chose (the status lists just those).
  const collaborator = useCollaborator(workspaceId);
  const twoColumn = mode.type === "project" && coding;
  const [projectIds, setProjectIds] = useState(
    parent?.projectIds ??
      ([
        state.projects.some((p) => p.id === projectId)
          ? projectId
          : state.projects[0]?.id,
      ].filter(Boolean) as string[]),
  );
  const [status, setStatus] = useState<Status>("todo");
  const [objective, setObjective] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [commit, setCommit] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const flow = useReactFlow();
  let repoError = "",
    commitError = "";
  try {
    if (repo) normalizeRepositoryUrl(repo);
  } catch {
    repoError = t("mapEditor.repositoryError");
  }
  try {
    if (commit) normalizeCommitUrl(commit);
  } catch {
    commitError = t("editor.invalidCommit");
  }
  const nameField = (
    <Field
      label={
        mode.type === "project"
          ? t("editor.projectName")
          : t("editor.newTaskName")
      }
      value={name}
      onChange={setName}
      autoFocus
      required
      error={submitted && !name.trim() ? t("editor.enterName") : undefined}
    />
  );
  if (deleting && editing)
    return (
      <Dialog title={t("editor.deleteProjectTitle")} onClose={onClose}>
        <Modal.Body>
          <Typography>
            {t("editor.deleteProjectConfirm", { name: editing.name })}
          </Typography>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onPress={() => setDeleting(false)}>
            {t("editor.cancel")}
          </Button>
          <Button
            variant="danger"
            onPress={() => {
              repository.commit((s) => removeProject(s, editing.id));
              onClose();
            }}
          >
            {t("editor.deleteProject")}
          </Button>
        </Modal.Footer>
      </Dialog>
    );
  return (
    <Dialog
      title={
        editing
          ? t("editor.editProject")
          : mode.type === "project"
            ? t("editor.newProject")
            : parent
              ? t("editor.newSubtask")
              : t("editor.newTask")
      }
      onClose={onClose}
      dialogClassName={
        twoColumn ? "w-[calc(100vw-2rem)] max-w-[920px]" : undefined
      }
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (
            !name.trim() ||
            (mode.type === "project"
              ? repoError
              : commitError || !projectIds.length)
          )
            return;
          const id = editing?.id ?? uid();
          if (mode.type === "project") {
            const chosen = collaborator ? [] : projectPaths({ paths });
            const details = {
              name: name.trim(),
              color: orb.colors[0],
              orb,
              repositoryUrl: normalizeRepositoryUrl(repo),
            };
            repository.commit((s) => ({
              ...s,
              projects: editing
                ? s.projects.map((p) => {
                    if (p.id !== id) return p;
                    if (collaborator)
                      return {
                        ...p,
                        name: details.name,
                        color: details.color,
                        orb,
                      };
                    const next = { ...p, ...details };
                    if (chosen.length) next.paths = chosen;
                    else delete next.paths;
                    return next;
                  })
                : [
                    ...s.projects,
                    chosen.length
                      ? { id, ...details, paths: chosen }
                      : { id, ...details },
                  ],
            }));
          } else {
            const board = document
              .querySelector('[data-testid="board-area"]')
              ?.getBoundingClientRect();
            const position = parent
              ? { x: parent.position.x + 380, y: parent.position.y + 270 }
              : flow.screenToFlowPosition({
                  x: (board?.left ?? 200) + (board?.width ?? 800) / 2 - 140,
                  y: (board?.top ?? 200) + (board?.height ?? 600) / 2 - 120,
                });
            while (
              state.tasks.some(
                (t) =>
                  Math.abs(t.position.x - position.x) < 290 &&
                  Math.abs(t.position.y - position.y) < 250,
              )
            )
              position.y += 270;
            repository.commit((s) => {
              const labelsToAdd = labels.filter((name) =>
                s.labels.some((label) => label.name === name),
              );
              return {
                ...s,
                tasks: [
                  ...s.tasks,
                  {
                    id,
                    referenceId: taskReferenceId(s.tasks),
                    name: name.trim(),
                    projectIds,
                    status,
                    objective: objective.trim(),
                    labels: [...new Set(labelsToAdd)],
                    commitUrls: commit ? [normalizeCommitUrl(commit)] : [],
                    parentId: parent?.id ?? null,
                    position,
                    activity: [event("Task created", author)],
                  },
                ],
              };
            });
          }
          onCreated(id, mode.type);
        }}
      >
        <Modal.Body className="flex min-h-0 flex-col p-0">
          <ScrollShadow
            orientation="vertical"
            variant="fade"
            hideScrollBar
            className={
              twoColumn
                ? "grid max-h-[76dvh] min-w-0 items-start gap-3 p-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                : "flex min-h-0 flex-1 flex-col gap-3 p-1"
            }
          >
            {twoColumn ? (
              <>
                <div className="flex min-w-0 flex-col gap-3">
                  <SettingsCard title={t("editor.sectionProject")}>
                    {nameField}
                  </SettingsCard>
                  <SettingsCard
                    title={t("editor.sectionLook")}
                    note={t("editor.sectionLookNote")}
                  >
                    <OrbEditor value={orb} onChange={setOrb} />
                  </SettingsCard>
                </div>
                <SettingsCard title={t("editor.sectionCode")}>
                  <div className="flex min-w-0 flex-col gap-4">
                    {monorepo ? (
                      <div className="flex flex-col gap-1">
                        <Label>{t("editor.githubRepository")}</Label>
                        <Description>
                          {state.map.repositoryUrl
                            ? t("editor.inheritedRepository", {
                                repository: state.map.repositoryUrl,
                              })
                            : t("editor.setWorkspaceRepository")}{" "}
                          {t("editor.switchRepositoryMode")}
                        </Description>
                      </div>
                    ) : collaborator && (editing || !repositories.length) ? (
                      <ReadOnlySetting
                        label={t("editor.githubRepository")}
                        value={repo}
                        empty={t("githubAccess.noRepository")}
                        description={t("githubAccess.ownerOnly")}
                      />
                    ) : repositories.length ? (
                      <GitHubRepositorySelect
                        label={t("editor.githubRepository")}
                        value={repo}
                        onChange={setRepo}
                        repositories={repositories}
                        description={
                          collaborator
                            ? t("githubAccess.ownerOnly")
                            : t("editor.projectRepositoryDescription")
                        }
                        error={repoError}
                        allowOther={!collaborator}
                      />
                    ) : (
                      <Field
                        label={t("editor.githubRepository")}
                        value={repo}
                        onChange={setRepo}
                        placeholder="https://github.com/owner/repository"
                        description={t("editor.projectRepositoryDescription")}
                        error={repoError}
                        maxLength={500}
                      />
                    )}
                    <ProjectFolderPicker
                      value={paths}
                      onChange={setPaths}
                      repositoryUrl={
                        monorepo ? state.map.repositoryUrl : repo.trim()
                      }
                      workspaceId={workspaceId}
                      connected={!!githubStatus?.connected}
                      readOnly={collaborator}
                    />
                  </div>
                </SettingsCard>
              </>
            ) : mode.type === "project" ? (
              <>
                <SettingsCard title={t("editor.sectionProject")}>
                  {nameField}
                </SettingsCard>
                <SettingsCard
                  title={t("editor.sectionLook")}
                  note={t("editor.sectionLookNote")}
                >
                  <OrbEditor value={orb} onChange={setOrb} />
                </SettingsCard>
              </>
            ) : (
              <>
                {nameField}
                <ProjectPicker
                  projects={state.projects}
                  value={projectIds}
                  onChange={setProjectIds}
                />
                {!projectIds.length && (
                  <Description>{t("editor.chooseProject")}</Description>
                )}
                <Choice
                  label={t("editor.taskStatus")}
                  value={status}
                  onChange={(v) => setStatus(v as Status)}
                  options={statusOptions}
                />
                <TextareaField
                  label={t("editor.taskObjective")}
                  value={objective}
                  onChange={setObjective}
                  placeholder={t("editor.objectivePlaceholder")}
                />
                <LabelPicker
                  labels={state.labels}
                  value={labels}
                  onChange={setLabels}
                />
                {coding && (
                  <Field
                    label={t("editor.githubCommit")}
                    value={commit}
                    onChange={setCommit}
                    placeholder="https://github.com/owner/repository/commit/..."
                    description={t("editor.commitDescription")}
                    error={commitError}
                    maxLength={500}
                  />
                )}
              </>
            )}
          </ScrollShadow>
        </Modal.Body>
        <Modal.Footer>
          {editing && (
            <IconButton
              label={t("editor.deleteProject")}
              onPress={() => setDeleting(true)}
              variant="danger-soft"
            >
              <Trash2 size={16} />
            </IconButton>
          )}
          <Button variant="tertiary" onPress={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            isDisabled={!!(mode.type === "project" ? repoError : commitError)}
          >
            {editing
              ? t("editor.saveChanges")
              : mode.type === "project"
                ? t("editor.createProject")
                : parent
                  ? t("editor.createSubtask")
                  : t("editor.createTask")}
          </Button>
        </Modal.Footer>
      </form>
    </Dialog>
  );
}
