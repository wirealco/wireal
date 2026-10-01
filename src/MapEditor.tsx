import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, ScrollShadow, Typography } from "@heroui/react";
import { Plus, Trash2 } from "./icons";
import {
  normalizeRepositoryUrl,
  repositoryLayout as currentRepositoryLayout,
  type RepositoryLayout,
  workspaceKind,
  type WorkspaceKind,
} from "./domain";
import { repository, useWorkspace, useWorkspaces } from "./store";
import {
  Choice,
  Dialog,
  Field,
  LabelBadge,
  ProjectOrbGroup,
  SettingRow,
  SettingsCard,
} from "./ui";
import { OrbEditor } from "./OrbEditor";
import { randomOrb } from "./orb-settings";
import { WorkspaceKindPicker } from "./WorkspaceKindPicker";
import { workspaceDeletion } from "./workspace-delete";
import { WorkspaceTeamSettings } from "./WorkspaceTeamDialog";
import {
  connectedRepositories,
  GitHubSectionTitle,
  useCollaborator,
  useGitHubStatus,
  WorkspaceGitHubSettings,
  WorkspaceRepositorySettings,
  type GitHubNotice,
} from "./WorkspaceGitHubSettings";
import { backend } from "./backend";

export function MapEditor({
  onClose,
  onCreateProject,
  onEditProject,
  onEditLabels,
  onSaved,
  githubNotice,
}: {
  onClose: () => void;
  onCreateProject: () => void;
  onEditProject: (id: string) => void;
  onEditLabels: () => void;
  onSaved?: () => void;
  githubNotice?: GitHubNotice;
}) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const workspaces = useWorkspaces();
  const [name, setName] = useState(state.map.name);
  const [kind, setKind] = useState(() => workspaceKind(state));
  const [repositoryUrl, setRepositoryUrl] = useState(state.map.repositoryUrl);
  const [orb, setOrb] = useState(state.map.orb);
  const [layout, setLayout] = useState<RepositoryLayout>(() =>
    currentRepositoryLayout(state),
  );
  const [error, setError] = useState("");
  const [repoError, setRepoError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const workspaceId = repository.getActiveWorkspaceId();
  const { status } = useGitHubStatus(workspaceId);
  const repositories = connectedRepositories(status);
  // Only the owner picks the repository and layout; the server refuses anyone
  // else's change, so a collaborator sees them as text and saves them as-is.
  const collaborator = useCollaborator(workspaceId);
  const deletion = workspaceDeletion(workspaces, workspaceId, !!backend);

  function updateRepository(value: string) {
    setRepositoryUrl(value);
    try {
      normalizeRepositoryUrl(value);
      setRepoError("");
    } catch {
      setRepoError(t("mapEditor.repositoryError"));
    }
  }

  if (deleting)
    return (
      <Dialog
        title={t("mapEditor.deleteTitle")}
        onClose={() => setDeleting(false)}
      >
        <Modal.Body className="flex flex-col gap-2">
          <Typography>
            {t("mapEditor.deleteConfirm", { name: state.map.name })}
          </Typography>
          <Typography type="body-sm" color="muted">
            {t("mapEditor.deleteWarning")}
          </Typography>
          <Typography type="body-sm" color="muted">
            {deletion.opens
              ? t("mapEditor.deleteThenOpens", { name: deletion.opens.name })
              : t("mapEditor.deleteThenNothing")}
          </Typography>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onPress={() => setDeleting(false)}>
            {t("mapEditor.cancel")}
          </Button>
          <Button
            variant="danger"
            onPress={async () => {
              try {
                await repository.deleteWorkspace(
                  repository.getActiveWorkspaceId(),
                );
                onClose();
              } catch (cause) {
                setDeleting(false);
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                );
              }
            }}
          >
            {t("mapEditor.delete")}
          </Button>
        </Modal.Footer>
      </Dialog>
    );

  return (
    <Dialog
      title={t("mapEditor.title")}
      onClose={onClose}
      size="sm"
      dialogClassName="w-[calc(100vw-2rem)] max-w-[920px]"
    >
      <Modal.Body className="flex min-h-0 flex-col p-0">
        <ScrollShadow
          orientation="vertical"
          variant="fade"
          hideScrollBar
          className="grid max-h-[76dvh] min-w-0 gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        >
          <div className="flex min-w-0 flex-col gap-3">
            <SettingsCard
              title={t("mapEditor.sectionWorkspace")}
              note={t("mapEditor.sectionWorkspaceNote")}
              footer={
                deletion.allowed ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onPress={() => setDeleting(true)}
                  >
                    <Trash2 size={14} />
                    {t("mapEditor.delete")}
                  </Button>
                ) : undefined
              }
            >
              <div className="flex min-w-0 flex-col gap-5">
                <SettingRow
                  title={t("workspaceKind.label")}
                  hint={t(`workspaceKind.${kind}Description`)}
                >
                  <div className="w-[10rem]">
                    <Choice
                      label={t("workspaceKind.label")}
                      value={kind}
                      showLabel={false}
                      options={[
                        { id: "coding", name: t("workspaceKind.coding") },
                        { id: "everyday", name: t("workspaceKind.everyday") },
                      ]}
                      onChange={(value) =>
                        setKind(value === "everyday" ? "everyday" : "coding")
                      }
                    />
                  </div>
                </SettingRow>
                <Field
                  label={t("mapEditor.workspaceName")}
                  value={name}
                  onChange={setName}
                  error={error}
                  required
                />
              </div>
            </SettingsCard>
            <SettingsCard
              title={t("mapEditor.sectionLook")}
              note={t("mapEditor.sectionLookNote")}
            >
              <OrbEditor value={orb} onChange={setOrb} />
            </SettingsCard>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {kind === "coding" && (
              <SettingsCard>
                <WorkspaceGitHubSettings
                  workspaceId={workspaceId}
                  layout={layout}
                  onLayoutChange={setLayout}
                  repositoryUrl={repositoryUrl}
                  onRepositoryUrlChange={updateRepository}
                  repositoryError={repoError}
                  repositories={repositories}
                  kind={kind}
                  notice={githubNotice}
                  readOnly={collaborator}
                />
              </SettingsCard>
            )}
            {backend && (
              <SettingsCard>
                <WorkspaceTeamSettings
                  workspaceId={workspaceId}
                  onClose={onClose}
                />
              </SettingsCard>
            )}
            <SettingsCard
              title={t("mapEditor.projects")}
              note={t("mapEditor.projectsDescription")}
              end={
                <Button
                  isIconOnly
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  aria-label={t("mapEditor.newProject")}
                  onPress={onCreateProject}
                >
                  <Plus size={14} />
                </Button>
              }
            >
              {state.projects.length ? (
                <ProjectOrbGroup
                  projects={state.projects}
                  onProjectPress={onEditProject}
                />
              ) : (
                <Typography type="body-sm" color="muted">
                  {t("mapEditor.noProjects")}
                </Typography>
              )}
            </SettingsCard>
            <SettingsCard
              title={t("navigation.labelSettings")}
              note={t("mapEditor.labelsDescription")}
              end={
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  onPress={onEditLabels}
                >
                  {t("mapEditor.editLabels")}
                </Button>
              }
            >
              {state.labels.length ? (
                <div className="flex flex-wrap gap-2">
                  {state.labels.map((label) => (
                    <LabelBadge
                      key={label.id}
                      name={label.name}
                      color={label.color}
                    />
                  ))}
                </div>
              ) : (
                <Typography type="body-sm" color="muted">
                  {t("mapEditor.noLabels")}
                </Typography>
              )}
            </SettingsCard>
          </div>
        </ScrollShadow>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="tertiary" onPress={onClose}>
          {t("mapEditor.cancel")}
        </Button>
        <Button
          variant="primary"
          isDisabled={
            !collaborator &&
            kind === "coding" &&
            layout === "monorepo" &&
            !!repoError
          }
          onPress={() => {
            if (!name.trim()) {
              setError(t("mapEditor.enterName"));
              return;
            }
            repository.commit((current) => ({
              ...current,
              map: {
                ...current.map,
                kind,
                name: name.trim(),
                // A multirepo workspace keeps no repository of its own; leaving a
                // stale one behind would silently claim every project again the
                // moment the setting changed back.
                repositoryUrl:
                  collaborator || kind === "everyday"
                    ? current.map.repositoryUrl
                    : layout === "monorepo"
                      ? normalizeRepositoryUrl(repositoryUrl)
                      : "",
                repositoryLayout: collaborator
                  ? current.map.repositoryLayout
                  : layout,
                orb,
              },
            }));
            onSaved?.();
            onClose();
          }}
        >
          {t("mapEditor.save")}
        </Button>
      </Modal.Footer>
    </Dialog>
  );
}

export function NewWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WorkspaceKind | null>(null);
  const [layout, setLayout] = useState<RepositoryLayout>("multirepo");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [orb, setOrb] = useState(() => randomOrb());
  const [error, setError] = useState("");
  const [repoError, setRepoError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      title={t("mapEditor.newWorkspace")}
      onClose={onClose}
      placement="center"
      /* The kind cards are two tiles wide; what follows them is the settings
         dialog, which is read at its own width. The sheet grows into it. */
      dialogClassName={`transition-[max-width] duration-200 ease-out ${
        kind === null ? "" : "w-[calc(100vw-2rem)] max-w-[30rem]"
      }`}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={async (event) => {
          event.preventDefault();
          if (kind === null) return;
          if (!name.trim()) {
            setError(t("mapEditor.enterName"));
            return;
          }
          if (kind === "coding" && layout === "monorepo" && repoError) return;
          setSaving(true);
          try {
            await repository.createWorkspace({
              name,
              kind,
              repositoryLayout: layout,
              repositoryUrl:
                kind === "coding" && layout === "monorepo"
                  ? normalizeRepositoryUrl(repositoryUrl)
                  : "",
              orb,
            });
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setSaving(false);
          }
        }}
      >
        <Modal.Body className="flex min-h-0 flex-col p-0">
          <ScrollShadow
            orientation="vertical"
            variant="fade"
            hideScrollBar
            /* The cards step is two tiles the sheet is cut to, so it takes the
               room; the settings step is padded like the settings dialog, which
               also keeps its first card clear of the close button — a 40px
               target at the corner that reaches past the header. */
            className={`flex min-h-0 flex-1 flex-col gap-4 ${
              kind === null ? "p-1" : "p-4"
            }`}
          >
            {kind === null ? (
              <WorkspaceKindPicker
                value={kind}
                onChange={setKind}
                variant="cards"
              />
            ) : (
              /* Past the kind cards this is the workspace settings dialog:
                 the same sections, in the same order, with the same controls,
                 so what a workspace is made with is what it is edited with. */
              <div className="workspace-kind__reveal flex shrink-0 flex-col gap-3">
                <SettingsCard
                  title={t("mapEditor.sectionWorkspace")}
                  note={t("mapEditor.sectionWorkspaceNote")}
                >
                  <div className="flex min-w-0 flex-col gap-5">
                    <SettingRow
                      title={t("workspaceKind.label")}
                      hint={t(`workspaceKind.${kind}Description`)}
                    >
                      <div className="w-[10rem]">
                        <Choice
                          label={t("workspaceKind.label")}
                          value={kind}
                          showLabel={false}
                          options={[
                            { id: "coding", name: t("workspaceKind.coding") },
                            {
                              id: "everyday",
                              name: t("workspaceKind.everyday"),
                            },
                          ]}
                          onChange={(value) =>
                            setKind(
                              value === "everyday" ? "everyday" : "coding",
                            )
                          }
                        />
                      </div>
                    </SettingRow>
                    <Field
                      label={t("mapEditor.workspaceName")}
                      value={name}
                      onChange={setName}
                      error={error}
                      autoFocus
                      required
                    />
                  </div>
                </SettingsCard>
                {kind === "coding" && (
                  <SettingsCard>
                    <section
                      aria-label={t("github.title")}
                      className="flex min-w-0 flex-col gap-3"
                    >
                      <GitHubSectionTitle />
                      <Typography type="body-sm" color="muted">
                        {t("github.afterCreate")}
                      </Typography>
                      <WorkspaceRepositorySettings
                        layout={layout}
                        onLayoutChange={setLayout}
                        repositoryUrl={repositoryUrl}
                        onRepositoryUrlChange={(value) => {
                          setRepositoryUrl(value);
                          try {
                            normalizeRepositoryUrl(value);
                            setRepoError("");
                          } catch {
                            setRepoError(t("mapEditor.repositoryError"));
                          }
                        }}
                        repositoryError={repoError}
                      />
                    </section>
                  </SettingsCard>
                )}
                <SettingsCard
                  title={t("mapEditor.sectionLook")}
                  note={t("mapEditor.sectionLookNote")}
                >
                  <OrbEditor value={orb} onChange={setOrb} />
                </SettingsCard>
              </div>
            )}
          </ScrollShadow>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onPress={onClose}>
            {t("mapEditor.cancel")}
          </Button>
          {kind !== null && (
            <Button
              type="submit"
              variant="primary"
              isDisabled={
                kind === "coding" && layout === "monorepo" && !!repoError
              }
              isPending={saving}
            >
              {t("mapEditor.createWorkspace")}
            </Button>
          )}
        </Modal.Footer>
      </form>
    </Dialog>
  );
}
