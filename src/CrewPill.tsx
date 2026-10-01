import {
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Button,
  Drawer,
  Modal,
  Popover,
  ScrollShadow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Settings2 } from "./icons";
import { Dialog, IconButton } from "./ui";
import {
  agentSettings,
  type AgentMode,
  type AgentSettings,
  taskIdLabel,
} from "./domain";
import { repository, useWorkspace } from "./store";
import {
  agentRoster,
  connectedRunners,
  cutsWork,
  isWired,
  livePresence,
  ownsAgentSeat,
  weeklyUsageByKind,
  brandName,
  rateLimitTone,
  seatRunner,
  usageReadings,
  type Runner,
  type TaskLock,
} from "./runners";
import { usePresence } from "./runners-client";
import { startAgentDrag } from "./agent-drag";
import { AwayDigest, useLastSeen } from "./TaskReport";
import { awayItems } from "./task-report";
import {
  byActivity,
  CrewBloub,
  LiveDot,
  MemberRow,
  rosterMember,
  UsagePair,
  useWideLayout,
  type CrewMember,
} from "./CrewParts";
import "./crew.css";

export type AgentsSection = "runners" | "settings";

const agentModes: AgentMode[] = ["paused", "directed", "automatic"];

const modeName = {
  paused: "agents.modePaused",
  directed: "agents.modeDirected",
  automatic: "agents.modeAutomatic",
};
const modeHint = {
  paused: "agents.modePausedHint",
  directed: "agents.modeDirectedHint",
  automatic: "agents.modeAutomaticHint",
};
const modeNote = {
  paused: "agents.switchNotePaused",
  directed: "agents.switchNoteDirected",
  automatic: "agents.switchNoteAutomatic",
};

export function saveAgentSettings(patch: Partial<AgentSettings>) {
  repository.commit((current) => ({
    ...current,
    map: {
      ...current.map,
      agents: { ...agentSettings(current), ...patch },
    },
  }));
}

function AgentModeControl({
  mode,
  onChange,
}: {
  mode: AgentMode;
  onChange: (mode: AgentMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <ToggleButtonGroup
      className="crew-modes"
      size="sm"
      fullWidth
      selectionMode="single"
      disallowEmptySelection
      aria-label={t("agents.modeLabel")}
      selectedKeys={new Set([mode])}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next) onChange(String(next) as AgentMode);
      }}
    >
      {agentModes.map((option) => (
        <ToggleButton
          key={option}
          id={option}
          variant="ghost"
          className="crew-modes__mode"
          aria-label={`${t(modeName[option])} — ${t(modeHint[option])}`}
        >
          {t(modeName[option])}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

function ModeSwitchPrompt({
  next,
  working,
  onCancel,
  onConfirm,
}: {
  next: AgentMode;
  working: CrewMember[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog title={t("agents.switchTitle")} onClose={onCancel}>
      <Modal.Body className="flex min-h-0 flex-col gap-3">
        <Typography type="body-sm">
          {t("agents.switchIntro", { mode: t(modeName[next]) })}
        </Typography>
        <ScrollShadow
          orientation="vertical"
          variant="fade"
          hideScrollBar
          className="agents-switch__list"
        >
          {working.map((agent) => (
            <div className="agents-switch__row" key={agent.id}>
              <span className="agents-switch__name">{agent.name}</span>
              <Typography type="body-xs" color="muted">
                {agent.task
                  ? `${taskIdLabel(agent.task.referenceId)} ${agent.task.name}`
                  : t("agents.workingIn", {
                      workspace:
                        agent.elsewhere || t("agents.unknownWorkspace"),
                    })}
              </Typography>
            </div>
          ))}
        </ScrollShadow>
        <Typography type="body-xs" color="muted">
          {t(modeNote[next])}
        </Typography>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="tertiary" size="sm" onPress={onCancel}>
          {t("agents.cancel")}
        </Button>
        <Button variant="danger" size="sm" onPress={onConfirm}>
          {t("agents.switchConfirm")}
        </Button>
      </Modal.Footer>
    </Dialog>
  );
}

/** An agent that is free: its face, and its name on a small rounded label
 *  under it. In directed mode the owner of its runner drags the face onto a
 *  task to start it there. */
function ReadyTile({
  member,
  draggable,
  runnerId,
  onDragging,
}: {
  member: CrewMember;
  draggable: boolean;
  runnerId?: string;
  onDragging: (dragging: boolean) => void;
}) {
  const spec = member.spec;
  return (
    <li
      className="crew-ready__tile"
      data-state={member.state}
      data-draggable={draggable || undefined}
      title={member.waiting || undefined}
      onPointerDown={
        draggable && spec
          ? (event: ReactPointerEvent<HTMLLIElement>) =>
              startAgentDrag(
                event,
                event.currentTarget.querySelector(".crew-bloub"),
                { agent: spec.id, runnerId },
                {
                  onStart: () => onDragging(true),
                  onEnd: () => onDragging(false),
                },
              )
          : undefined
      }
    >
      <CrewBloub
        kind={member.kind}
        name={member.name}
        state={member.state}
        size={36}
      />
      <span className="crew-ready__name">{member.name}</span>
    </li>
  );
}

/** What the crew is doing, one tap from the board: usage first, then who is
 *  working on what with a clock running, who is free, and the people coding in
 *  their own CLI. The full window is one more press away. */
function CrewSummary({
  runners,
  locks,
  now,
  userId,
  onOpenCrew,
  onOpenTask,
  onDragging,
}: {
  runners: Runner[];
  locks: TaskLock[];
  now: number;
  userId: string;
  onOpenCrew: (section: AgentsSection) => void;
  onOpenTask: (taskId: string) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const workspaceId = repository.getActiveWorkspaceId();
  const settings = agentSettings(state);
  const roster = agentRoster(settings);
  const [switching, setSwitching] = useState<AgentMode | null>(null);
  const people = livePresence(usePresence(workspaceId), now);
  const { seen, markSeen } = useLastSeen(workspaceId);
  const members = roster
    .map((spec) =>
      rosterMember(spec, {
        roster,
        runners,
        tasks: state.tasks,
        workspaceId,
        locks,
        now,
      }),
    )
    .sort(byActivity);
  const working = members.filter((member) => member.state === "working");
  const ready = members.filter(
    (member) => member.state !== "working" && !member.leftOver,
  );
  const readings = usageReadings(runners, now);
  const machines = new Set(readings.map((reading) => reading.runner.runner_id));
  const wired = isWired(runners, workspaceId, now);
  const directed = settings.mode === "directed" && wired;
  // Only the owner of the runner an agent sits on may direct it, and only a
  // switched-on agent takes work at all.
  const draggable = new Set(
    directed
      ? ready
          .filter(
            (member) =>
              !!member.spec?.enabled &&
              ownsAgentSeat(runners, member.id, userId, now),
          )
          .map((member) => member.id)
      : [],
  );
  const changeMode = (next: AgentMode) => {
    if (cutsWork(settings.mode, next, working.length)) setSwitching(next);
    else saveAgentSettings({ mode: next });
  };
  return (
    <div className="crew-summary">
      <header className="crew-summary__head">
        <span className="crew-summary__title">{t("agents.title")}</span>
        <span className="crew-summary__count">
          {t("agents.pill.workingOf", {
            working: working.length,
            total: roster.length,
          })}
        </span>
        <AgentModeControl mode={settings.mode} onChange={changeMode} />
      </header>
      <AwayDigest
        state={state}
        since={seen}
        onDismiss={markSeen}
        onOpenTask={onOpenTask}
      />
      {!wired && (
        <div className="crew-summary__note">
          <span>{t("agents.notWired")}</span>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => onOpenCrew("runners")}
          >
            {t("agents.connectRunner")}
          </Button>
        </div>
      )}
      {readings.length > 0 && (
        <section
          className="crew-summary__usage"
          aria-label={t("agents.usageHeading")}
        >
          {readings.map((reading) => (
            <UsagePair
              key={`${reading.runner.runner_id}:${reading.kind}`}
              reading={reading}
              now={now}
              size={48}
              caption
              showRunner={machines.size > 1}
            />
          ))}
        </section>
      )}
      {working.length > 0 && (
        <section aria-label={t("agents.workingHeading")}>
          <ul className="crew-members">
            {working.map((member, index) => (
              <MemberRow
                key={member.id}
                member={member}
                index={index}
                showRunner
                onOpenTask={onOpenTask}
              />
            ))}
          </ul>
        </section>
      )}
      {ready.length > 0 && (
        <section className="crew-ready" aria-label={t("agents.readyHeading")}>
          <span className="crew-summary__label">
            {working.length
              ? t("agents.readyHeading")
              : t("agents.allReady", { count: ready.length })}
          </span>
          <ul className="crew-ready__grid">
            {ready.map((member) => (
              <ReadyTile
                key={member.id}
                member={member}
                runnerId={seatRunner(runners, member.id, now)?.runner_id}
                draggable={draggable.has(member.id)}
                onDragging={onDragging}
              />
            ))}
          </ul>
          {draggable.size > 0 && (
            <span className="crew-summary__hint">{t("agents.dropHint")}</span>
          )}
        </section>
      )}
      {people.length > 0 && (
        <section className="crew-people">
          <span className="crew-summary__label">
            {t("agents.dock.peopleHeading")}
          </span>
          <ul>
            {people.map((person) => {
              const task = person.task_id
                ? state.tasks.find((item) => item.id === person.task_id)
                : undefined;
              return (
                <li key={`${person.user_id}:${person.session}`}>
                  <span className="crew-people__name">
                    {person.user_name || t("agents.unknownOwner")}
                  </span>
                  <span className="crew-people__client">
                    {[person.client, person.handle].filter(Boolean).join(" · ")}
                  </span>
                  <span className="crew-people__task">
                    {task
                      ? `${taskIdLabel(task.referenceId)} ${task.name}`
                      : person.note || t("agents.dock.noTask")}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <footer className="crew-summary__foot">
        <IconButton
          label={
            state.map.name
              ? t("agents.openRulesFor", { workspace: state.map.name })
              : t("agents.openRules")
          }
          onPress={() => onOpenCrew("settings")}
        >
          <Settings2 size={16} />
        </IconButton>
        <Button
          size="sm"
          variant="primary"
          className="crew-summary__open"
          aria-keyshortcuts="R"
          onPress={() => onOpenCrew("runners")}
        >
          {t("agents.openCrew")}
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </footer>
      {!!switching && (
        <ModeSwitchPrompt
          next={switching}
          working={working}
          onCancel={() => setSwitching(null)}
          onConfirm={() => {
            saveAgentSettings({ mode: switching });
            setSwitching(null);
          }}
        />
      )}
    </div>
  );
}

/** The crew, floating in the corner of the board: a live dot, how many agents
 *  are working, and the fullest weekly window. It opens the summary above it,
 *  or as a sheet from the bottom on a phone. */
export function CrewPill({
  runners,
  locks,
  now,
  userId,
  onOpenCrew,
  onOpenTask,
}: {
  runners: Runner[];
  locks: TaskLock[];
  now: number;
  userId: string;
  onOpenCrew: (section: AgentsSection) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const wide = useWideLayout();
  const [open, setOpen] = useState(false);
  // The popover is never modal: a modal one marks the board inert and lays
  // an underlay over it, and the browser delivers no drop to an inert card,
  // so an agent dragged out of it could never land on a task. It closes on
  // a press outside it or Escape instead, which a modal one does by itself.
  useEffect(() => {
    if (!open || !wide) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".crew-popover, .crew-pill, .modal, .crew-menu"))
        return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open, wide]);
  const workspaceId = repository.getActiveWorkspaceId();
  const { seen } = useLastSeen(workspaceId);
  const news = awayItems(state, seen).length;
  const settings = agentSettings(state);
  const roster = agentRoster(settings);
  const live = connectedRunners(runners, now).length > 0;
  const working = roster.filter(
    (spec) =>
      rosterMember(spec, {
        roster,
        runners,
        tasks: state.tasks,
        workspaceId,
        locks,
        now,
      }).state === "working",
  ).length;
  const weekly = weeklyUsageByKind(runners, now);
  const paused = settings.mode === "paused";
  const usage = weekly
    .map(({ kind, used }) =>
      t("agents.pill.kindWeek", {
        brand: brandName(kind),
        percent: Math.round(used),
      }),
    )
    .join(", ");
  const label = [
    !live
      ? t("agents.pill.offline")
      : t(paused ? "agents.pill.pausedLabel" : "agents.pill.workingLabel", {
          working,
          total: roster.length,
        }),
    usage,
    news ? t("agents.pill.news", { count: news }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const openCrew = (section: AgentsSection) => {
    setOpen(false);
    onOpenCrew(section);
  };
  const openTask = (taskId: string) => {
    setOpen(false);
    onOpenTask(taskId);
  };
  const summary = (
    <CrewSummary
      runners={runners}
      locks={locks}
      now={now}
      userId={userId}
      onOpenCrew={openCrew}
      onOpenTask={openTask}
      onDragging={(on) => {
        // The agent's face is carried on its own above the page, so the
        // popover or sheet steps out of the way at once and the board is
        // what the person sees while they aim.
        if (on) setOpen(false);
      }}
    />
  );
  const pill = (
    <Button
      variant="secondary"
      className="crew-pill"
      data-working={working > 0 || undefined}
      aria-label={label}
      onPress={wide ? undefined : () => setOpen(true)}
    >
      <LiveDot live={live} />
      <span className="crew-pill__count">
        {live ? (
          <>
            <b>
              {working}/{roster.length}
            </b>{" "}
            {paused ? t("agents.pill.paused") : t("agents.pill.working")}
          </>
        ) : (
          t("agents.pill.offline")
        )}
      </span>
      {weekly.length > 0 && (
        // Every CLI's week, each with its own face and colour, then one
        // "week" for all of them: a near-full Codex week is not hidden
        // behind an emptier Claude one.
        <span className="crew-pill__usage">
          {weekly.map(({ kind, used }) => (
            <span
              key={kind}
              className="crew-pill__week"
              data-tone={rateLimitTone(used)}
            >
              <CrewBloub
                kind={kind}
                name={brandName(kind)}
                state="idle"
                size={14}
              />
              {Math.round(used)}%
            </span>
          ))}
          <span className="crew-pill__week-label">
            {t("agents.pill.weekWord")}
          </span>
        </span>
      )}
      {news > 0 && (
        <span className="crew-pill__news" aria-hidden="true">
          {news}
        </span>
      )}
    </Button>
  );
  return (
    <div className="crew-dock">
      {wide ? (
        <Popover isOpen={open} onOpenChange={setOpen}>
          {pill}
          <Popover.Content
            placement="top end"
            offset={10}
            className="crew-popover"
            isNonModal
          >
            <Popover.Dialog aria-label={t("agents.title")}>
              <ScrollShadow
                orientation="vertical"
                variant="fade"
                hideScrollBar
                className="crew-popover__scroll"
              >
                {summary}
              </ScrollShadow>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      ) : (
        <>
          {pill}
          <Drawer isOpen={open} onOpenChange={setOpen}>
            <Drawer.Backdrop>
              <Drawer.Content placement="bottom" className="crew-sheet">
                <Drawer.Dialog
                  aria-label={t("agents.title")}
                  className="crew-sheet__dialog"
                >
                  <Drawer.Handle />
                  <ScrollShadow
                    orientation="vertical"
                    variant="fade"
                    hideScrollBar
                    className="crew-sheet__scroll"
                  >
                    {summary}
                  </ScrollShadow>
                </Drawer.Dialog>
              </Drawer.Content>
            </Drawer.Backdrop>
          </Drawer>
        </>
      )}
    </div>
  );
}
