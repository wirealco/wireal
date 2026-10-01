import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Button,
  Dropdown,
  Modal,
  NumberField,
  ScrollShadow,
  Switch,
  Tooltip,
  Typography,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Field, IconButton, SettingRow, SettingsCard } from "./ui";
import {
  ArrowRight,
  Caret,
  CircleCheck,
  Copy,
  MoreHorizontal,
  Plug,
  Plus,
  Settings2,
  Trash2,
  X,
} from "./icons";
import { saveAgentSettings, type AgentsSection } from "./CrewPill";
import {
  agentBranchOf,
  agentSettings,
  mergePolicyOf,
  type AgentSettings,
  type AgentSpec,
} from "./domain";
import { repository, useWorkspace } from "./store";
import { currentLanguage, formatRelativeTime } from "./i18n";
import {
  agentRoster,
  agentState,
  formatUsd,
  isConnected,
  leftOverAgent,
  pingOutcome,
  secondsSince,
  usageReadings,
  type PingRequest,
  type Runner,
} from "./runners";
import {
  forgetRunner,
  pingRunner,
  requestPromote,
  requestPull,
} from "./runners-client";
import { ActivityBloub } from "./ActivityBloub";
import {
  CrewBloub,
  LiveDot,
  MemberRow,
  runnerMembers,
  UsagePair,
  useWideLayout,
  type CrewContext,
  type CrewMember,
} from "./CrewParts";
import "./crew.css";

const npxLines = ["npx wireal-run@latest login", "npx wireal-run@latest run"];
const installLines = [
  "npm install -g wireal-run",
  "wireal-run login",
  "wireal-run run",
];

/** Online first, then the viewer's own, then by name. */
function orderedRunners(
  runners: Runner[],
  userId: string,
  now: number,
): Runner[] {
  const rank = (runner: Runner) =>
    (isConnected(runner, now) ? 0 : 2) +
    (userId && runner.owner_id === userId ? 0 : 1);
  return [...runners].sort((left, right) => {
    const order = rank(left) - rank(right);
    if (order) return order;
    return (left.name || "").localeCompare(right.name || "", currentLanguage());
  });
}

function CommandRow({ title, lines }: { title: string; lines: string[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = globalThis.setTimeout(() => setCopied(false), 1600);
    return () => globalThis.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="agents-command">
      <span className="agents-command__title">{title}</span>
      <pre className="agents-command__code">
        <code>{lines.join("\n")}</code>
      </pre>
      <span className="agents-command__copy">
        <IconButton
          label={copied ? t("agents.copied") : t("agents.copy")}
          onPress={() => {
            if (!navigator.clipboard) return;
            void navigator.clipboard.writeText(lines.join("\n"));
            setCopied(true);
          }}
        >
          {copied ? <CircleCheck size={14} /> : <Copy size={14} />}
        </IconButton>
      </span>
    </div>
  );
}

function OnboardingSteps() {
  const { t } = useTranslation();
  const art: ReactNode[] = [
    <Plug size={16} />,
    <span className="agents-onboard__pair">
      <span className="agents-onboard__bloub">
        <ActivityBloub brand="claude" label="Claude" />
      </span>
      <span className="agents-onboard__bloub">
        <ActivityBloub brand="codex" label="Codex" />
      </span>
    </span>,
    <ArrowRight size={16} />,
  ];
  return (
    <ol
      className="agents-onboard"
      aria-label={t("agents.onboarding.stepsLabel")}
    >
      {[1, 2, 3].map((step) => (
        <li
          className="agents-onboard__step"
          key={step}
          style={{ "--i": step } as CSSProperties}
        >
          <span className="agents-onboard__art" aria-hidden="true">
            {art[step - 1]}
            <span className="agents-onboard__index">{step}</span>
          </span>
          <span className="agents-onboard__text">
            <span className="agents-onboard__title">
              {t(`agents.onboarding.step${step}Title`)}
            </span>
            <span className="agents-onboard__note">
              {t(`agents.onboarding.step${step}Note`)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function LinesSettings({ settings }: { settings: AgentSettings }) {
  const { t } = useTranslation();
  const merging = mergePolicyOf(settings) === "merge";
  const [branch, setBranch] = useState(settings.agentBranch ?? "");
  const landing = agentBranchOf(settings);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SettingRow
        title={
          merging
            ? landing
              ? t("agents.mergeToBranch", { branch: landing })
              : t("agents.mergeToMain")
            : t("agents.mergeLeaveBranch")
        }
      >
        <Switch
          size="sm"
          isSelected={merging}
          aria-label={t("agents.mergePolicy")}
          onChange={(on) =>
            saveAgentSettings({ mergePolicy: on ? "merge" : "branch" })
          }
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </SettingRow>
      {merging && (
        <div className="flex min-w-0 flex-col gap-2">
          <SettingRow title={t("agents.agentBranch")}>
            <div className="w-[11rem]">
              <Field
                label={t("agents.agentBranch")}
                showLabel={false}
                value={branch}
                onChange={setBranch}
                onBlur={() => {
                  const next = agentBranchOf({
                    ...settings,
                    agentBranch: branch,
                  });
                  setBranch(next);
                  if (next !== (settings.agentBranch ?? ""))
                    saveAgentSettings({ agentBranch: next });
                }}
                placeholder={t("agents.agentBranchPlaceholder")}
                maxLength={200}
              />
            </div>
          </SettingRow>
          <SettingRow title={t("agents.checks")} stacked>
            <Typography type="body-xs" color="muted">
              {t("agents.checksMoved")}
            </Typography>
          </SettingRow>
        </div>
      )}
    </div>
  );
}

function LimitRow({
  stacked,
  title,
  hint,
  value,
  minValue,
  maxValue,
  step,
  unit,
  placeholder,
  onChange,
  onClear,
}: {
  stacked?: boolean;
  title: string;
  hint: string;
  value: number;
  minValue: number;
  maxValue: number;
  step: number;
  unit?: string;
  placeholder?: string;
  onChange: (value: number) => void;
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  const set = Number.isFinite(value);
  return (
    <SettingRow stacked={stacked} title={title} hint={hint}>
      <div className="settings-stepper">
        <NumberField
          aria-label={title}
          value={value}
          minValue={minValue}
          maxValue={maxValue}
          step={step}
          onChange={onChange}
        >
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input aria-label={title} placeholder={placeholder} />
            <NumberField.IncrementButton />
          </NumberField.Group>
        </NumberField>
        <Typography type="body-xs" color="muted">
          {unit ?? ""}
        </Typography>
        <span className="settings-stepper__clear">
          {!!onClear && set && (
            <IconButton
              label={t("agents.clearValue", { name: title })}
              onPress={onClear}
            >
              <X size={14} />
            </IconButton>
          )}
        </span>
      </div>
    </SettingRow>
  );
}

function LimitsSettings({
  settings,
  stacked,
}: {
  settings: AgentSettings;
  stacked?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <LimitRow
        stacked={stacked}
        title={t("agents.lease")}
        hint={t("agents.leaseHint")}
        value={settings.leaseMinutes}
        minValue={2}
        maxValue={30}
        step={1}
        unit={t("agents.minutesUnit")}
        onChange={(value) => {
          if (Number.isFinite(value))
            saveAgentSettings({ leaseMinutes: value });
        }}
      />
      <LimitRow
        stacked={stacked}
        title={t("agents.pauseAbove")}
        hint={t("agents.pauseAboveHint")}
        value={settings.pauseAbovePercent ?? Number.NaN}
        minValue={50}
        maxValue={100}
        step={5}
        unit={t("agents.percentUnit")}
        placeholder={t("agents.pauseOff")}
        onChange={(value) =>
          saveAgentSettings({
            pauseAbovePercent: Number.isFinite(value) ? value : undefined,
          })
        }
        onClear={() => saveAgentSettings({ pauseAbovePercent: undefined })}
      />
    </div>
  );
}

function seenText(
  runner: Runner,
  now: number,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const seen = secondsSince(runner.last_seen, now);
  return seen === null
    ? t("agents.never")
    : seen < 90
      ? t("agents.secondsAgo", { seconds: seen })
      : formatRelativeTime(runner.last_seen, now);
}

function FactList({ facts }: { facts: [string, string][] }) {
  return (
    <dl className="crew-facts">
      {facts.map(([label, value]) => (
        <div key={label} className="crew-facts__row">
          <dt>{label}</dt>
          <dd title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RunnerFacts({
  runner,
  mine,
  now,
}: {
  runner: Runner;
  mine: boolean;
  now: number;
}) {
  const { t } = useTranslation();
  return (
    <FactList
      facts={[
        [
          t("agents.owner"),
          mine
            ? t("runners.you", {
                name: runner.owner_name || t("agents.unknownOwner"),
              })
            : runner.owner_name || t("agents.unknownOwner"),
        ],
        [t("agents.machine"), runner.host || t("agents.unknownHost")],
        [
          t("agents.workspace"),
          runner.workspace_name || t("agents.unknownWorkspace"),
        ],
        [t("agents.lastSeen"), seenText(runner, now, t)],
        [t("agents.spend"), formatUsd(runner.cost_usd)],
      ]}
    />
  );
}

function RunnerFolder({ runner }: { runner: Runner }) {
  const { t } = useTranslation();
  const folder = runner.folder;
  if (!folder)
    return (
      <Typography type="body-xs" color="muted">
        {t("runners.noFolder")}
      </Typography>
    );
  return (
    <FactList
      facts={[
        [t("agents.folderPath"), folder.path || t("agents.folderUnknownPath")],
        ...(folder.branch
          ? ([[t("agents.folderBranch"), folder.branch]] as [string, string][])
          : []),
        ...(folder.upstream
          ? ([[t("agents.folderTracks"), folder.upstream]] as [
              string,
              string,
            ][])
          : []),
        [
          t("agents.folderBehind"),
          folder.behind > 0
            ? t("agents.folderBehindValue", { count: folder.behind })
            : t("agents.folderLevel"),
        ],
        ...(folder.ahead
          ? ([
              [
                t("agents.folderAhead"),
                t("agents.folderAheadValue", { count: folder.ahead }),
              ],
            ] as [string, string][])
          : []),
        [
          t("agents.folderChanges"),
          folder.dirty ? t("agents.folderDirty") : t("agents.folderClean"),
        ],
      ]}
    />
  );
}

/** One machine and the agents on it. The head says whether it is alive and
 *  what its CLIs have left; the list says who is doing what; the foot tests
 *  it and holds the rarer actions behind a menu, with the facts and the
 *  folder one press further down. */
export function RunnerCard({
  runner,
  members,
  now,
  mine,
  workspaceOwner,
  branch,
  request,
  testError = "",
  forgetting,
  showUsage = true,
  workspaceLabel,
  arrived = false,
  index = 0,
  onTest,
  onForget,
  onRefresh,
  onOpenTask,
  onRemoveAgent,
}: {
  runner: Runner;
  members: CrewMember[];
  now: number;
  mine: boolean;
  workspaceOwner: boolean;
  branch: string;
  request: PingRequest | null;
  /** Why the last test could not be sent, shown where its answer would be. */
  testError?: string;
  forgetting: boolean;
  showUsage?: boolean;
  /** The workspace it is bound to, for a runner that is not this one's. */
  workspaceLabel?: string;
  arrived?: boolean;
  index?: number;
  onTest: () => void;
  onForget: () => void;
  onRefresh?: () => void;
  onOpenTask?: (taskId: string) => void;
  onRemoveAgent?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [details, setDetails] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState("");
  const online = isConnected(runner, now);
  const name = runner.name || t("agents.unnamedRunner");
  const owner = runner.owner_name || t("agents.unknownOwner");
  const outcome = pingOutcome(runner, request, now);
  const readings = online && showUsage ? usageReadings([runner], now) : [];
  const folder = runner.folder;
  const behind = folder?.behind ?? 0;
  const ahead = folder?.ahead ?? 0;
  const split = behind > 0 && ahead > 0;
  const upstream =
    folder?.upstream || folder?.branch || t("agents.folderBranch");
  const pullable = Boolean(folder && !folder.dirty && behind > 0 && !split);
  const denied = mine ? "" : t("runners.ownerOnly", { owner });
  const ask = (call: () => Promise<unknown>, mark: (busy: boolean) => void) => {
    setError("");
    mark(true);
    void call()
      .then(() => onRefresh?.())
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => mark(false));
  };
  const why = {
    pull:
      denied ||
      (!folder
        ? t("runners.noFolderYet")
        : split
          ? t("runners.pullSplit", { ahead, behind, upstream })
          : folder.dirty && behind > 0
            ? t("runners.pullDirty")
            : behind > 0
              ? t("runners.pullReady", { count: behind, upstream })
              : t("runners.pullLevel", { upstream })),
    promote:
      denied ||
      (branch
        ? t("agents.promoteHint", { branch })
        : t("runners.promoteNoBranch")),
    test: denied || (online ? t("runners.testHint") : t("runners.offlineNow")),
    forget: mine || workspaceOwner ? t("runners.forgetHint") : denied,
  };
  const disabled = [
    ...(!mine || !pullable || pulling ? ["pull"] : []),
    ...(!mine || !branch || promoting ? ["promote"] : []),
    ...((!mine && !workspaceOwner) || forgetting ? ["forget"] : []),
  ];
  const problem = error || testError;
  const said =
    outcome.state === "answered"
      ? t("agents.answered", { seconds: outcome.seconds })
      : outcome.state === "timeout"
        ? t("agents.noAnswer", { seconds: outcome.seconds })
        : outcome.state === "waiting"
          ? t("agents.testing")
          : "";
  const working = members.filter((member) => member.state === "working").length;
  const detailsId = `crew-details-${runner.runner_id}`;
  return (
    <article
      className="crew-card"
      data-online={online}
      data-arrived={arrived || undefined}
      style={{ "--i": index } as CSSProperties}
      aria-label={name}
    >
      <header className="crew-card__head">
        <div className="crew-card__id">
          <h3 className="crew-card__name">
            <LiveDot
              live={online}
              label={online ? t("agents.connected") : t("agents.offline")}
            />
            <span className="truncate">{name}</span>
            {working > 0 && (
              <span className="crew-card__busy">
                {t("agents.cardWorking", { count: working })}
              </span>
            )}
          </h3>
          <p className="crew-card__meta">
            {online
              ? [
                  runner.host || t("agents.unknownHost"),
                  mine ? t("runners.you", { name: owner }) : owner,
                  workspaceLabel ?? "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("agents.offlineSeen", { when: seenText(runner, now, t) })}
          </p>
        </div>
        {readings.length > 0 && (
          <div className="crew-card__usage">
            {readings.map((reading) => (
              <UsagePair key={reading.kind} reading={reading} now={now} />
            ))}
          </div>
        )}
      </header>
      {members.length ? (
        <ul className="crew-members">
          {members.map((member, row) => (
            <MemberRow
              key={member.id}
              member={member}
              index={row}
              onOpenTask={onOpenTask}
              onRemove={onRemoveAgent}
            />
          ))}
        </ul>
      ) : (
        <p className="crew-card__empty">{t("agents.autoEmpty")}</p>
      )}
      <div className="crew-card__details" data-open={details} id={detailsId}>
        <div className="crew-card__details-inner" inert={!details}>
          <section>
            <h4>{t("agents.facts")}</h4>
            <RunnerFacts runner={runner} mine={mine} now={now} />
          </section>
          <section>
            <h4>{t("agents.folder")}</h4>
            <RunnerFolder runner={runner} />
          </section>
        </div>
      </div>
      <footer className="crew-card__foot">
        <Tooltip delay={350}>
          <Tooltip.Trigger className="inline-flex">
            <Button
              size="sm"
              variant="secondary"
              isDisabled={!mine || outcome.state === "waiting"}
              onPress={onTest}
            >
              {t("runners.testShort")}
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>{why.test}</Tooltip.Content>
        </Tooltip>
        {/* The menu sits beside Test, the card's other action, so no round
        button is left in the card's rounded corner. */}
        <Dropdown>
          <Dropdown.Trigger
            className="button button--icon-only button--sm button--ghost"
            aria-label={t("agents.runnerActions", { name })}
          >
            <MoreHorizontal size={16} />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom start" className="crew-menu">
            <Dropdown.Menu
              aria-label={t("agents.runnerActions", { name })}
              disabledKeys={disabled}
              onAction={(key) => {
                if (key === "pull")
                  ask(
                    () => requestPull(runner.workspace_id, runner.runner_id),
                    setPulling,
                  );
                if (key === "promote")
                  ask(
                    () => requestPromote(runner.workspace_id, runner.runner_id),
                    setPromoting,
                  );
                if (key === "forget") onForget();
              }}
            >
              <Dropdown.Item id="pull" textValue={t("agents.pull")}>
                <span className="crew-menu__item">
                  <span className="crew-menu__label">
                    {pulling
                      ? t("agents.pulling")
                      : behind > 0
                        ? t("runners.pullCount", { count: behind })
                        : t("agents.pull")}
                  </span>
                  <span className="crew-menu__why">{why.pull}</span>
                </span>
              </Dropdown.Item>
              <Dropdown.Item id="promote" textValue={t("agents.promote")}>
                <span className="crew-menu__item">
                  <span className="crew-menu__label">
                    {promoting ? t("agents.promoting") : t("agents.promote")}
                  </span>
                  <span className="crew-menu__why">{why.promote}</span>
                </span>
              </Dropdown.Item>
              <Dropdown.Item
                id="forget"
                textValue={t("agents.forget")}
                variant="danger"
              >
                <span className="crew-menu__item">
                  <span className="crew-menu__label">{t("agents.forget")}</span>
                  <span className="crew-menu__why">{why.forget}</span>
                </span>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        <span
          className="crew-card__said"
          data-state={problem ? "error" : outcome.state}
          role="status"
        >
          {outcome.state === "waiting" && !problem && (
            <span className="crew-wait__pulse" aria-hidden="true" />
          )}
          {problem || said}
        </span>
        {behind > 0 && (
          <span className="crew-card__behind" title={why.pull}>
            {t("agents.behindChip", { count: behind })}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="crew-card__more"
          aria-expanded={details}
          aria-controls={detailsId}
          onPress={() => setDetails((open) => !open)}
        >
          {t("agents.details")}
          <Caret
            size={14}
            aria-hidden="true"
            className="crew-card__chevron"
            data-open={details}
          />
        </Button>
      </footer>
    </article>
  );
}

/** The way in for a new machine: one command to copy, the global install for
 *  those who keep it, and a pulse that waits for the runner's first
 *  heartbeat. With no runner at all it is the whole window, with the steps
 *  from there to an agent at work beside it. */
function ConnectCard({
  open,
  hero,
  onOpen,
  onClose,
}: {
  open: boolean;
  hero: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open && !hero)
    return (
      <button type="button" className="crew-connect" onClick={onOpen}>
        <span className="crew-connect__plus" aria-hidden="true">
          <Plus size={18} />
        </span>
        <span className="crew-connect__title">{t("agents.connectRunner")}</span>
        <span className="crew-connect__note">{t("agents.connectNote")}</span>
      </button>
    );
  return (
    <section
      className="crew-connect crew-connect--open"
      data-hero={hero || undefined}
      aria-label={t("agents.connectRunner")}
    >
      <div className="crew-connect__body">
        {hero && (
          <span className="crew-connect__art" aria-hidden="true">
            {(["claude", "codex", "claude"] as const).map((brand, index) => (
              <span
                key={index}
                className="crew-connect__bloub"
                style={{ "--i": index } as CSSProperties}
              >
                <ActivityBloub brand={brand} label={brand} delay={index} />
              </span>
            ))}
          </span>
        )}
        <header className="crew-connect__head">
          <div className="min-w-0">
            <h3 className="crew-connect__heading">
              {hero
                ? t("agents.onboarding.startTitle")
                : t("agents.connectRunner")}
            </h3>
            <p className="crew-connect__lead">
              {t("agents.onboarding.startNote")}
            </p>
          </div>
          {!hero && (
            <IconButton label={t("agents.cancel")} onPress={onClose}>
              <X size={14} />
            </IconButton>
          )}
        </header>
        <CommandRow title={t("agents.connectCommand")} lines={npxLines} />
        <details className="crew-connect__alt">
          <summary>
            <Caret size={14} aria-hidden="true" />
            {t("agents.connectGlobal")}
          </summary>
          <CommandRow
            title={t("docs.runner.globalTitle")}
            lines={installLines}
          />
        </details>
        <div className="crew-connect__wait" role="status">
          <span className="crew-wait__pulse" aria-hidden="true" />
          <span>{t("agents.waitingForRunner")}</span>
          <a className="agents-onboard__link" href="/docs/runner">
            {t("agents.setupGuide")}
            <ArrowRight size={13} aria-hidden="true" />
          </a>
        </div>
      </div>
      {hero && (
        <div className="crew-connect__steps">
          <span className="crew-section-label">
            {t("agents.onboarding.nextTitle")}
          </span>
          <OnboardingSteps />
        </div>
      )}
    </section>
  );
}

function removeAgents(ids: ReadonlySet<string>) {
  if (!ids.size) return;
  repository.commit((current) => {
    const settings = agentSettings(current);
    return {
      ...current,
      map: {
        ...current.map,
        agents: {
          ...settings,
          roster: agentRoster(settings).filter((spec) => !ids.has(spec.id)),
        },
      },
    };
  });
}

function LeftOverBanner({
  specs,
  onRemove,
}: {
  specs: AgentSpec[];
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="crew-banner" role="status">
      <span className="crew-banner__bloubs" aria-hidden="true">
        {specs.slice(0, 3).map((spec) => (
          <CrewBloub
            key={spec.id}
            kind={spec.kind}
            name={spec.name}
            state="offline"
            size={20}
          />
        ))}
      </span>
      <span className="crew-banner__text">
        <span className="crew-banner__title">
          {t("agents.leftOver", { count: specs.length })}
        </span>
        <span className="crew-banner__note">{t("agents.leftOverNote")}</span>
      </span>
      <Button size="sm" variant="danger-soft" onPress={onRemove}>
        <Trash2 size={13} />
        {t("agents.removeLeftOver")}
      </Button>
    </div>
  );
}

type CrewView = "crew" | "rules";

/** One window for the crew: every machine this workspace runs on as a card
 *  with its agents inside and its usage in the corner, a card to connect
 *  another, and the rules every agent works by behind the gear. */
export function CrewWindow({
  runners,
  now,
  workspaceId,
  userId,
  workspaceOwner,
  section,
  error,
  onClose,
  onRefresh,
  onOpenTask,
}: {
  runners: Runner[];
  now: number;
  workspaceId: string;
  userId: string;
  workspaceOwner: boolean;
  section: AgentsSection;
  error?: string;
  onClose: () => void;
  onRefresh?: () => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const settings = agentSettings(state);
  const roster = agentRoster(settings);
  const wide = useWideLayout();
  const [view, setView] = useState<CrewView>(
    section === "settings" ? "rules" : "crew",
  );
  const [pings, setPings] = useState<Record<string, PingRequest>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState("");
  const [forgetting, setForgetting] = useState<Record<string, boolean>>({});
  const [connecting, setConnecting] = useState(false);
  const [showElsewhere, setShowElsewhere] = useState(false);
  const [tick, setTick] = useState(() => Date.now());
  const clock = Math.max(now, tick);
  // Runners already here when the window opened are not news. One that
  // appears later has just been connected, so its card arrives with a flourish
  // and the connect card, its job done, folds away.
  const known = useRef(new Set(runners.map((runner) => runner.runner_id)));
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const fresh = runners
      .map((runner) => runner.runner_id)
      .filter((id) => !known.current.has(id));
    if (!fresh.length) return;
    for (const id of fresh) known.current.add(id);
    setArrived((current) => new Set([...current, ...fresh]));
    setConnecting(false);
  }, [runners]);
  const byId = useMemo(
    () => new Map(runners.map((runner) => [runner.runner_id, runner])),
    [runners],
  );
  const ordered = useMemo(
    () => orderedRunners(runners, userId, clock),
    [runners, userId, clock],
  );
  const bound = (runner: Runner) =>
    !runner.workspace_id || runner.workspace_id === workspaceId;
  const here = ordered.filter(bound);
  const elsewhere = ordered.filter((runner) => !bound(runner));
  const hero = runners.length === 0;
  const listening = connecting || hero;
  const waiting = Object.entries(pings).some(
    ([id, request]) =>
      pingOutcome(byId.get(id), request, clock).state === "waiting",
  );
  useEffect(() => {
    if (!waiting) return;
    const display = globalThis.setInterval(() => setTick(Date.now()), 1000);
    const refresh = globalThis.setInterval(() => onRefresh?.(), 2000);
    return () => {
      globalThis.clearInterval(display);
      globalThis.clearInterval(refresh);
    };
  }, [waiting, onRefresh]);
  // While someone is following the connect steps the list is asked for more
  // often than the board's own poll, so the new card lands soon after the
  // runner's first heartbeat rather than up to ten seconds later.
  useEffect(() => {
    if (!listening) return;
    const refresh = globalThis.setInterval(() => onRefresh?.(), 4000);
    return () => globalThis.clearInterval(refresh);
  }, [listening, onRefresh]);

  const test = async (runner: Runner) => {
    setTestErrors((current) => ({ ...current, [runner.runner_id]: "" }));
    try {
      const at = await pingRunner(runner.workspace_id, runner.runner_id);
      setPings((current) => ({
        ...current,
        [runner.runner_id]: { at, startedAt: Date.now() },
      }));
      setTick(Date.now());
    } catch (cause) {
      setTestErrors((current) => ({
        ...current,
        [runner.runner_id]:
          cause instanceof Error ? cause.message : String(cause),
      }));
    }
  };

  const forget = async (runner: Runner) => {
    const key = `${runner.workspace_id}:${runner.runner_id}`;
    setActionError("");
    setForgetting((current) => ({ ...current, [key]: true }));
    try {
      await forgetRunner(runner.workspace_id, runner.runner_id);
      await onRefresh?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setForgetting((current) => ({ ...current, [key]: false }));
    }
  };

  const context: CrewContext = {
    roster,
    runners,
    tasks: state.tasks,
    workspaceId,
    now: clock,
  };
  const working = roster.filter(
    (spec) => agentState(spec, runners, [], clock).state === "working",
  ).length;
  const stale = roster.filter((spec) =>
    leftOverAgent(
      spec,
      runners,
      agentState(spec, runners, [], clock).state === "working",
      clock,
    ),
  );
  const online = here.filter((runner) => isConnected(runner, clock)).length;
  const branch = agentBranchOf(settings);
  const readings = usageReadings(here, clock);
  const machines = new Set(readings.map((reading) => reading.runner.runner_id));

  const card = (runner: Runner, index: number) => (
    <RunnerCard
      key={runner.runner_id}
      runner={runner}
      members={runnerMembers(runner, context)}
      now={clock}
      mine={!!userId && runner.owner_id === userId}
      workspaceOwner={workspaceOwner}
      branch={branch}
      request={pings[runner.runner_id] ?? null}
      testError={testErrors[runner.runner_id]}
      forgetting={
        forgetting[`${runner.workspace_id}:${runner.runner_id}`] === true
      }
      showUsage={wide}
      workspaceLabel={
        bound(runner)
          ? undefined
          : runner.workspace_name || t("agents.unknownWorkspace")
      }
      arrived={arrived.has(runner.runner_id)}
      index={index}
      onTest={() => void test(runner)}
      onForget={() => void forget(runner)}
      onRefresh={onRefresh}
      onOpenTask={onOpenTask}
      onRemoveAgent={(id) => removeAgents(new Set([id]))}
    />
  );

  const summary = [
    t("agents.summaryWorking", { working, total: roster.length }),
    t("agents.summaryOnline", { count: online }),
  ].join(" · ");

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container
          size="lg"
          className={wide ? undefined : "crew-window--page"}
        >
          <Modal.Dialog
            className={wide ? "crew-window" : "crew-window crew-window__page"}
          >
            <Modal.Header className="crew-head">
              {view === "rules" && (
                <IconButton
                  label={t("agents.backToCrew")}
                  onPress={() => setView("crew")}
                >
                  <ArrowRight size={16} className="rotate-180" />
                </IconButton>
              )}
              <div className="crew-head__titles">
                <Modal.Heading className="crew-head__title">
                  {view === "rules" ? t("agents.rules") : t("agents.title")}
                </Modal.Heading>
                <span className="crew-head__sub">
                  {[
                    state.map.name,
                    view === "rules" ? t("agents.rulesNote") : summary,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {view === "crew" && (
                <IconButton
                  label={t("agents.openRules")}
                  onPress={() => setView("rules")}
                >
                  <Settings2 size={16} />
                </IconButton>
              )}
              <IconButton label={t("agents.close")} onPress={onClose}>
                <X size={16} />
              </IconButton>
            </Modal.Header>
            <Modal.Body className="crew-body">
              <ScrollShadow
                orientation="vertical"
                variant="fade"
                hideScrollBar
                className="crew-body__scroll"
              >
                {!!(actionError || error) && (
                  <Typography type="body-xs" className="text-danger">
                    {actionError || error}
                  </Typography>
                )}
                {view === "rules" ? (
                  <div className="crew-rules" key="rules">
                    <SettingsCard
                      title={t("agents.sectionLines")}
                      note={t("agents.sectionLinesNote")}
                    >
                      <LinesSettings settings={settings} />
                    </SettingsCard>
                    <SettingsCard
                      title={t("agents.sectionLimits")}
                      note={t("agents.sectionLimitsNote")}
                    >
                      <LimitsSettings settings={settings} stacked={!wide} />
                    </SettingsCard>
                  </div>
                ) : (
                  <div
                    className="crew-view"
                    data-hero={hero || undefined}
                    key="crew"
                  >
                    {!wide && readings.length > 0 && (
                      <section
                        className="crew-usage"
                        aria-label={t("agents.usageHeading")}
                      >
                        {readings.map((reading) => (
                          <UsagePair
                            key={`${reading.runner.runner_id}:${reading.kind}`}
                            reading={reading}
                            now={clock}
                            size={64}
                            caption
                            showRunner={machines.size > 1}
                          />
                        ))}
                      </section>
                    )}
                    {stale.length > 0 && (
                      <LeftOverBanner
                        specs={stale}
                        onRemove={() =>
                          removeAgents(new Set(stale.map((spec) => spec.id)))
                        }
                      />
                    )}
                    {hero ? (
                      <ConnectCard
                        open
                        hero
                        onOpen={() => undefined}
                        onClose={() => undefined}
                      />
                    ) : (
                      <div className="crew-grid">
                        {here.map(card)}
                        <ConnectCard
                          open={connecting}
                          hero={false}
                          onOpen={() => setConnecting(true)}
                          onClose={() => setConnecting(false)}
                        />
                      </div>
                    )}
                    {elsewhere.length > 0 && (
                      <section className="crew-elsewhere">
                        <button
                          type="button"
                          className="crew-elsewhere__toggle"
                          aria-expanded={showElsewhere}
                          onClick={() => setShowElsewhere((open) => !open)}
                        >
                          <Caret
                            size={14}
                            aria-hidden="true"
                            className="crew-card__chevron"
                            data-open={showElsewhere}
                          />
                          {t("agents.elsewhereGroup")}
                          <span className="crew-elsewhere__count">
                            {elsewhere.length}
                          </span>
                        </button>
                        {showElsewhere && (
                          <div className="crew-grid">{elsewhere.map(card)}</div>
                        )}
                      </section>
                    )}
                  </div>
                )}
              </ScrollShadow>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
