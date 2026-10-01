import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Chip,
  Description,
  ErrorMessage,
  Label,
  ListBox,
  Select,
  Skeleton,
  Switch,
  Typography,
} from "@heroui/react";
import { backend } from "./backend";
import { GitHubMark } from "./icons";
import { formatDateTime } from "./i18n";
import type { RepositoryLayout, WorkspaceKind } from "./domain";
import type {
  GitHubInstallationChoices,
  GitHubNotice,
  GitHubRepository,
  GitHubStatus,
} from "./github-connection";
import { Field } from "./ui";
import { useWorkspaces } from "./store";
import "./settings-card.css";

/**
 * True when the signed-in person is a collaborator here, not the owner. Only
 * the owner picks the repositories and folders a workspace reads on GitHub;
 * the server refuses anyone else's change, so the fields are read-only.
 */
export function useCollaborator(workspaceId: string): boolean {
  const workspaces = useWorkspaces();
  return (
    workspaces.find((workspace) => workspace.id === workspaceId)?.role ===
    "collaborator"
  );
}

/** A setting shown as plain text to someone who cannot change it. */
export function ReadOnlySetting({
  label,
  value,
  empty,
  description,
}: {
  label: string;
  value: string;
  empty: string;
  description?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label>{label}</Label>
      <Typography type="body-sm" className="min-w-0 break-all">
        {value || empty}
      </Typography>
      {description && <Description>{description}</Description>}
    </div>
  );
}

export type { GitHubNotice };

const statusCache = new Map<string, GitHubStatus>();
const inFlight = new Map<string, Promise<GitHubStatus>>();

function loadStatus(
  workspaceId: string,
  force: boolean,
): Promise<GitHubStatus> {
  if (!backend) return Promise.reject(new Error("No backend"));
  const pending = inFlight.get(workspaceId);
  if (pending && !force) return pending;
  const request = backend.github
    .status(workspaceId)
    .then((value) => {
      statusCache.set(workspaceId, value);
      return value;
    })
    .finally(() => {
      if (inFlight.get(workspaceId) === request) inFlight.delete(workspaceId);
    });
  inFlight.set(workspaceId, request);
  return request;
}

export function useGitHubStatus(workspaceId: string) {
  const [status, setStatus] = useState<GitHubStatus | null>(
    () => statusCache.get(workspaceId) ?? null,
  );
  const [loading, setLoading] = useState(
    () => !!backend && !statusCache.has(workspaceId),
  );
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(
    async (force: boolean) => {
      if (!backend) {
        setStatus(null);
        setLoading(false);
        return;
      }
      setError("");
      if (force || !statusCache.has(workspaceId)) setLoading(true);
      try {
        const value = await loadStatus(workspaceId, force);
        if (alive.current) setStatus(value);
      } catch (cause) {
        if (alive.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (alive.current) setLoading(false);
      }
    },
    [workspaceId],
  );
  useEffect(() => {
    setStatus(statusCache.get(workspaceId) ?? null);
    void run(false);
  }, [workspaceId, run]);
  const reload = useCallback(() => run(true), [run]);
  const apply = useCallback(
    (value: GitHubStatus) => {
      statusCache.set(workspaceId, value);
      if (alive.current) setStatus(value);
    },
    [workspaceId],
  );
  return { status, loading, error, reload, apply };
}

export function repositoryOptionUrl(fullName: string): string {
  return `https://github.com/${fullName}`;
}

export function connectedRepositories(
  status: GitHubStatus | null,
): GitHubRepository[] {
  return status?.connected ? status.repositories : [];
}

const OTHER_URL = "__other__";

export function GitHubRepositorySelect({
  label,
  value,
  onChange,
  repositories,
  description,
  error,
  allowOther = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  repositories: GitHubRepository[];
  description?: string;
  error?: string;
  /** False keeps the choice to the listed repositories, with no free URL. */
  allowOther?: boolean;
}) {
  const { t } = useTranslation();
  const [other, setOther] = useState(
    () =>
      !!value &&
      !repositories.some(
        (repo) => repositoryOptionUrl(repo.fullName) === value,
      ),
  );
  const matched = other
    ? undefined
    : repositories.find((repo) => repositoryOptionUrl(repo.fullName) === value);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Select
        className="min-w-0"
        placeholder={t("github.chooseRepository")}
        selectedKey={
          matched
            ? repositoryOptionUrl(matched.fullName)
            : other
              ? OTHER_URL
              : null
        }
        onSelectionChange={(key) => {
          const chosen = String(key);
          if (chosen === OTHER_URL) {
            setOther(true);
            onChange("");
            return;
          }
          setOther(false);
          onChange(chosen);
        }}
      >
        <Label>{label}</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {repositories.map((repo) => (
              <ListBox.Item
                key={repo.fullName}
                id={repositoryOptionUrl(repo.fullName)}
                textValue={repo.fullName}
              >
                {repo.fullName}
              </ListBox.Item>
            ))}
            {allowOther && (
              <ListBox.Item id={OTHER_URL} textValue={t("github.otherUrl")}>
                {t("github.otherUrl")}
              </ListBox.Item>
            )}
          </ListBox>
        </Select.Popover>
        {description && <Description>{description}</Description>}
      </Select>
      {other && (
        <Field
          label={t("github.otherUrlLabel")}
          value={value}
          onChange={onChange}
          placeholder="https://github.com/owner/repository"
          error={error}
          maxLength={500}
        />
      )}
      {!other && error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}

function NoticeLine({ notice }: { notice: GitHubNotice }) {
  const { t } = useTranslation();
  if (notice === "error")
    return <ErrorMessage role="alert">{t("github.noticeError")}</ErrorMessage>;
  return (
    <Typography type="body-sm" color="muted" role="status">
      {t(
        typeof notice === "object"
          ? "github.noticeChoose"
          : notice === "connected"
            ? "github.noticeConnected"
            : "github.noticeRequested",
      )}
    </Typography>
  );
}

export function GitHubSectionTitle() {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-muted">
        <GitHubMark size={16} />
      </span>
      <Typography type="body-sm" className="font-medium">
        {t("github.title")}
      </Typography>
    </div>
  );
}

export function WorkspaceRepositorySettings({
  layout,
  onLayoutChange,
  repositoryUrl,
  onRepositoryUrlChange,
  repositoryError,
  repositories = [],
  readOnly = false,
}: {
  layout?: RepositoryLayout;
  onLayoutChange?: (layout: RepositoryLayout) => void;
  repositoryUrl?: string;
  onRepositoryUrlChange?: (value: string) => void;
  repositoryError?: string;
  repositories?: GitHubRepository[];
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  if (!layout || !onLayoutChange) return null;
  if (readOnly)
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <ReadOnlySetting
          label={t("mapEditor.monorepo")}
          value={
            layout === "monorepo"
              ? t("mapEditor.monorepoOn")
              : t("mapEditor.monorepoOff")
          }
          empty=""
        />
        {layout === "monorepo" && (
          <ReadOnlySetting
            label={t("mapEditor.workspaceRepository")}
            value={repositoryUrl ?? ""}
            empty={t("githubAccess.noRepository")}
          />
        )}
        <Typography type="body-xs" color="muted">
          {t("githubAccess.ownerOnly")}
        </Typography>
      </div>
    );
  return (
    <>
      {/* Which of the two shapes this workspace is. It decides
      whether a repository is set at all, so it is asked first. */}
      <Switch
        isSelected={layout === "monorepo"}
        onChange={(selected) =>
          onLayoutChange(selected ? "monorepo" : "multirepo")
        }
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Label>{t("mapEditor.monorepo")}</Label>
        </Switch.Content>
        <Description>
          {layout === "monorepo"
            ? t("mapEditor.monorepoOn")
            : t("mapEditor.monorepoOff")}
        </Description>
      </Switch>
      {layout === "monorepo" &&
        repositoryUrl !== undefined &&
        onRepositoryUrlChange &&
        (repositories.length ? (
          <GitHubRepositorySelect
            label={t("mapEditor.workspaceRepository")}
            value={repositoryUrl}
            onChange={onRepositoryUrlChange}
            repositories={repositories}
            description={t("mapEditor.repositoryDescription")}
            error={repositoryError}
          />
        ) : (
          <Field
            label={t("mapEditor.workspaceRepository")}
            value={repositoryUrl}
            onChange={onRepositoryUrlChange}
            placeholder="https://github.com/owner/repository"
            description={t("mapEditor.repositoryDescription")}
            error={repositoryError}
            maxLength={500}
          />
        ))}
    </>
  );
}

export function WorkspaceGitHubSettings({
  workspaceId,
  layout,
  onLayoutChange,
  repositoryUrl,
  onRepositoryUrlChange,
  repositoryError,
  repositories,
  kind,
  notice,
  readOnly = false,
}: {
  workspaceId: string;
  layout?: RepositoryLayout;
  onLayoutChange?: (layout: RepositoryLayout) => void;
  repositoryUrl?: string;
  onRepositoryUrlChange?: (value: string) => void;
  repositoryError?: string;
  repositories?: GitHubRepository[];
  kind: WorkspaceKind;
  notice?: GitHubNotice;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { status, loading, error, reload, apply } =
    useGitHubStatus(workspaceId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const ticket = typeof notice === "object" ? notice.ticket : null;
  const [choices, setChoices] = useState<GitHubInstallationChoices | null>(
    null,
  );
  const [choicesLoading, setChoicesLoading] = useState(false);
  const [choicesError, setChoicesError] = useState("");
  const [chosen, setChosen] = useState<number | null>(null);
  const [bound, setBound] = useState(false);
  useEffect(() => {
    if (!backend || !ticket) return;
    let alive = true;
    setChoicesLoading(true);
    setChoicesError("");
    backend.github
      .installationChoices(workspaceId, ticket)
      .then((value) => {
        if (alive) setChoices(value);
      })
      .catch((cause) => {
        if (alive)
          setChoicesError(
            cause instanceof Error ? cause.message : String(cause),
          );
      })
      .finally(() => {
        if (alive) setChoicesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId, ticket]);

  if (kind !== "coding") return null;

  if (!backend)
    return (
      <section aria-label={t("github.title")} className="flex flex-col gap-2">
        <GitHubSectionTitle />
        <Typography type="body-sm" color="muted">
          {t("github.localPreview")}
        </Typography>
        <WorkspaceRepositorySettings
          layout={layout}
          onLayoutChange={onLayoutChange}
          repositoryUrl={repositoryUrl}
          onRepositoryUrlChange={onRepositoryUrlChange}
          repositoryError={repositoryError}
          repositories={repositories}
        />
      </section>
    );

  const connect = async () => {
    setBusy(true);
    setActionError("");
    try {
      const { url } = await backend!.github.connect(workspaceId);
      window.location.assign(url);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const use = async (installationId: number) => {
    setChosen(installationId);
    setActionError("");
    try {
      apply(
        await backend!.github.useInstallation(workspaceId, {
          ticket: ticket!,
          installationId,
        }),
      );
      setChoices(null);
      setBound(true);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChosen(null);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setActionError("");
    try {
      await backend!.github.disconnect(workspaceId);
      setConfirming(false);
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={t("github.title")}
      className="flex min-w-0 flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !confirming) return;
        event.stopPropagation();
        setConfirming(false);
      }}
    >
      <GitHubSectionTitle />
      {bound ? (
        <NoticeLine notice="connected" />
      ) : (
        notice && <NoticeLine notice={notice} />
      )}
      {loading && !status && (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-4 w-2/3 rounded-md" />
          <Skeleton className="h-4 w-1/2 rounded-md" />
        </div>
      )}
      {error && <ErrorMessage role="alert">{error}</ErrorMessage>}
      {actionError && <ErrorMessage role="alert">{actionError}</ErrorMessage>}
      {status && !status.configured && (
        <Typography type="body-sm" color="muted">
          {t("github.notConfigured")}
        </Typography>
      )}
      {status && status.configured && !status.connected && ticket && !bound && (
        <div className="flex min-w-0 flex-col gap-2">
          {choicesLoading && !choices && (
            <div className="flex flex-col gap-2" aria-hidden>
              <Skeleton className="h-9 w-full rounded-xl" />
              <Skeleton className="h-9 w-full rounded-xl" />
            </div>
          )}
          {choicesError && (
            <ErrorMessage role="alert">{choicesError}</ErrorMessage>
          )}
          {choices && (
            <>
              <ul className="flex min-w-0 flex-col gap-1">
                {choices.installations.map((installation) => (
                  <li key={installation.id} className="min-w-0">
                    <Card
                      variant="secondary"
                      className="settings-card settings-card--tight flex-row flex-wrap items-center gap-2"
                    >
                      <span className="shrink-0 text-muted">
                        <GitHubMark size={16} />
                      </span>
                      <Card.Title className="min-w-0 truncate">
                        {installation.account}
                      </Card.Title>
                      <Chip size="sm" variant="soft">
                        <Chip.Label>
                          {t(
                            installation.accountType === "Organization"
                              ? "github.organization"
                              : "github.personal",
                          )}
                        </Chip.Label>
                      </Chip>
                      {installation.connectedElsewhere && (
                        <Typography
                          type="body-xs"
                          color="muted"
                          className="shrink-0"
                        >
                          {t("github.connectedElsewhere")}
                        </Typography>
                      )}
                      <Button
                        className="ml-auto shrink-0"
                        size="sm"
                        variant="primary"
                        isPending={chosen === installation.id}
                        isDisabled={
                          chosen !== null && chosen !== installation.id
                        }
                        onPress={() => void use(installation.id)}
                      >
                        {t("github.use")}
                      </Button>
                    </Card>
                  </li>
                ))}
              </ul>
              <Button
                className="self-start"
                size="sm"
                variant="tertiary"
                onPress={() => window.location.assign(choices.installUrl)}
              >
                {t("github.installElsewhere")}
              </Button>
            </>
          )}
        </div>
      )}
      {status &&
        status.configured &&
        !status.connected &&
        !(ticket && !bound) && (
          <>
            <Typography type="body-sm" color="muted">
              {t(
                layout === "monorepo"
                  ? "github.connectDescriptionMonorepo"
                  : "github.connectDescription",
              )}
            </Typography>
            {status.role === "owner" ? (
              <>
                <Typography type="body-sm" className="settings-caution">
                  {t("github.scopeWarning")}
                </Typography>
                <Button
                  className="self-start"
                  size="sm"
                  variant="primary"
                  isPending={busy}
                  onPress={() => void connect()}
                >
                  <GitHubMark size={14} />
                  {t("github.connect")}
                </Button>
              </>
            ) : (
              <Typography type="body-sm" color="muted">
                {t("github.askOwner")}
              </Typography>
            )}
          </>
        )}
      {status && status.connected && (
        <Card
          variant="secondary"
          className="settings-card settings-card--tight"
        >
          <Card.Header className="flex-row flex-wrap items-center gap-2">
            <span className="shrink-0 text-muted">
              <GitHubMark size={16} />
            </span>
            <Card.Title className="min-w-0 truncate">
              {status.account}
            </Card.Title>
            <Chip size="sm" variant="soft">
              <Chip.Label>
                {t(
                  status.accountType === "Organization"
                    ? "github.organization"
                    : "github.personal",
                )}
              </Chip.Label>
            </Chip>
          </Card.Header>
          <Card.Content>
            {/* A collaborator's status carries only the repositories the
            owner chose here, and nothing about the installation itself. */}
            <Typography type="body-xs" color="muted">
              {status.role === "owner" && status.repositorySelection === "all"
                ? t("github.allRepositories")
                : t("github.selectedRepositories", {
                    count: status.repositories.length,
                  })}
            </Typography>
            {status.role === "owner" &&
              status.repositorySelection === "all" && (
                <Typography type="body-xs" className="settings-caution">
                  {t("github.allRepositoriesWarning")}
                </Typography>
              )}
            <Typography type="body-xs" color="muted">
              {t("github.connectedBy", {
                name: status.connectedBy.name,
                when: formatDateTime(status.connectedAt),
              })}
            </Typography>
          </Card.Content>
          {status.role === "owner" && (
            <Card.Footer className="flex-wrap gap-2">
              {status.manageUrl && (
                <Button
                  size="sm"
                  variant="primary"
                  render={(props) => (
                    <a
                      {...(props as unknown as ComponentProps<"a">)}
                      href={status.manageUrl}
                      target="_blank"
                      rel="noreferrer"
                    />
                  )}
                >
                  {t("github.manage")}
                </Button>
              )}
              {!confirming && (
                <Button
                  size="sm"
                  variant="danger-soft"
                  onPress={() => setConfirming(true)}
                >
                  {t("github.disconnect")}
                </Button>
              )}
              {confirming && (
                <>
                  <Typography type="body-xs" color="muted">
                    {t("github.confirmDisconnect")}
                  </Typography>
                  <Button
                    size="sm"
                    variant="danger"
                    isPending={busy}
                    onPress={() => void disconnect()}
                  >
                    {t("github.confirm")}
                  </Button>
                  <Button
                    size="sm"
                    variant="tertiary"
                    onPress={() => setConfirming(false)}
                  >
                    {t("github.cancel")}
                  </Button>
                </>
              )}
            </Card.Footer>
          )}
        </Card>
      )}
      <WorkspaceRepositorySettings
        layout={layout}
        onLayoutChange={onLayoutChange}
        repositoryUrl={repositoryUrl}
        onRepositoryUrlChange={onRepositoryUrlChange}
        repositoryError={repositoryError}
        repositories={repositories}
        readOnly={readOnly}
      />
    </section>
  );
}
