import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { ActivityBloub, useReducedMotion } from "./ActivityBloub";
import { IconButton } from "./ui";
import { Trash2 } from "./icons";
import {
  type AgentKind,
  type AgentSpec,
  type Task,
  taskIdLabel,
} from "./domain";
import { currentLanguage } from "./i18n";
import { timeZone, zoneHour12 } from "./time-zone";
import {
  agentSlot,
  agentState,
  agentWaiting,
  brandName,
  formatCountdown,
  formatElapsed,
  isConnected,
  leftOverAgent,
  rateLimitTone,
  seatRunner,
  type ParsedRateWindow,
  type Runner,
  type RunnerAgent,
  type TaskLock,
  type UsageReading,
} from "./runners";

export function useWideLayout(): boolean {
  const [wide, setWide] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia("(min-width: 56rem)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(min-width: 56rem)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

/** A clock that ticks while something on screen counts. Each timer keeps its
 *  own, so a second going by re-renders the timer and nothing around it. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), intervalMs);
    return () => globalThis.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function Elapsed({ since }: { since: string }) {
  const now = useNow();
  const text = formatElapsed(since, now);
  if (!text) return null;
  return (
    <time className="crew-elapsed" dateTime={since}>
      {text}
    </time>
  );
}

/** The runner's pulse: it breathes while the runner answers heartbeats and
 *  sits grey once it has stopped. */
export function LiveDot({ live, label }: { live: boolean; label?: string }) {
  return (
    <span
      className="crew-dot"
      data-live={live}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** Counts up to a number the way the ring fills, so the figure and the arc
 *  arrive together rather than the text jumping ahead. */
function useCountUp(target: number, reduced: boolean): number {
  const [value, setValue] = useState(reduced ? target : 0);
  const current = useRef(value);
  useEffect(() => {
    if (reduced) {
      current.current = target;
      setValue(target);
      return;
    }
    const origin = current.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function step(time) {
      const progress = Math.min(1, (time - start) / 900);
      const eased = 1 - (1 - progress) ** 3;
      current.current = Math.round(origin + (target - origin) * eased);
      setValue(current.current);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);
  return value;
}

function resetTime(at: Date): string {
  return new Intl.DateTimeFormat(currentLanguage(), {
    timeZone: timeZone(),
    hour12: zoneHour12(),
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** One rate window as a small donut: the arc is what is used, the figure in
 *  the middle says how much, and the label under it names the window. */
export function UsageRing({
  label,
  name,
  window,
  now,
  size = 44,
  caption = false,
}: {
  label: string;
  name: string;
  window: ParsedRateWindow;
  now: number;
  size?: number;
  caption?: boolean;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const percent = window.usedPercentage;
  const used = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const shown = useCountUp(Math.round(used), reduced);
  const stroke = size >= 56 ? 5 : 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const countdown = formatCountdown(window.resetsAt, now);
  const resets = window.resetsAt
    ? t("agents.ring.resets", {
        time: resetTime(window.resetsAt),
        countdown,
      })
    : "";
  const spoken =
    percent === null
      ? t("agents.ring.unknown", { name })
      : t("agents.ring.used", { name, percent: Math.round(used) });
  return (
    <Tooltip delay={200}>
      <Tooltip.Trigger
        className="crew-ring"
        data-tone={percent === null ? "none" : rateLimitTone(used)}
        aria-label={resets ? `${spoken}. ${resets}` : spoken}
        style={{ "--ring-size": `${size}px` } as CSSProperties}
      >
        <span className="crew-ring__dial">
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            aria-hidden="true"
          >
            <circle
              className="crew-ring__track"
              cx={size / 2}
              cy={size / 2}
              r={radius}
              strokeWidth={stroke}
            />
            <circle
              className="crew-ring__fill"
              cx={size / 2}
              cy={size / 2}
              r={radius}
              strokeWidth={stroke}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - used / 100)}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ "--ring-length": circumference } as CSSProperties}
            />
          </svg>
          <span className="crew-ring__value" aria-hidden="true">
            {percent === null ? "—" : shown}
            {percent !== null && <small>%</small>}
          </span>
        </span>
        <span className="crew-ring__label" aria-hidden="true">
          {label}
        </span>
        {caption && !!countdown && (
          <span className="crew-ring__caption" aria-hidden="true">
            {t("agents.ring.in", { countdown })}
          </span>
        )}
      </Tooltip.Trigger>
      <Tooltip.Content>
        <span className="flex flex-col">
          <span className="font-medium">{spoken}</span>
          {!!resets && <span className="opacity-75">{resets}</span>}
        </span>
      </Tooltip.Content>
    </Tooltip>
  );
}

/** One CLI's two windows side by side under its name. */
export function UsagePair({
  reading,
  now,
  size,
  caption,
  showRunner,
}: {
  reading: UsageReading;
  now: number;
  size?: number;
  caption?: boolean;
  showRunner?: boolean;
}) {
  const { t } = useTranslation();
  const brand = brandName(reading.kind);
  const title = showRunner
    ? `${brand} · ${reading.runner.name || t("agents.unnamedRunner")}`
    : brand;
  return (
    <div className="crew-usage-pair" data-brand={reading.kind}>
      <span className="crew-usage-pair__title" title={title}>
        {title}
      </span>
      <div className="crew-usage-pair__rings">
        <UsageRing
          label={t("agents.ring.fiveHour")}
          name={t("agents.ring.fiveHourName", { brand })}
          window={reading.fiveHour}
          now={now}
          size={size}
          caption={caption}
        />
        <UsageRing
          label={t("agents.ring.week")}
          name={t("agents.ring.weekName", { brand })}
          window={reading.weekly}
          now={now}
          size={size}
          caption={caption}
        />
      </div>
    </div>
  );
}

export type MemberState =
  "working" | "waiting" | "idle" | "paused" | "locked" | "offline";

/** An agent as the crew views draw it, whether it came from this workspace's
 *  roster or only from a runner's own report. */
export type CrewMember = {
  id: string;
  name: string;
  kind: AgentKind;
  state: MemberState;
  /** The task it holds, when that task is on this board. */
  task?: Task;
  /** The workspace it works in, when its task is on another board. */
  elsewhere?: string;
  step?: string;
  since?: string;
  waiting?: string;
  files?: string[];
  runnerName?: string;
  /** No live runner brings it, so it can be removed from the roster. */
  leftOver: boolean;
  /** Where it is gone to, for a left-over agent: a runner, or none at all. */
  hadRunner: boolean;
  spec?: AgentSpec;
};

export type CrewContext = {
  roster: readonly AgentSpec[];
  runners: readonly Runner[];
  tasks: readonly Task[];
  workspaceId: string;
  locks?: readonly TaskLock[];
  now: number;
};

export function rosterMember(
  spec: AgentSpec,
  context: CrewContext,
): CrewMember {
  const { runners, now } = context;
  const activity = agentState(spec, runners, context.locks ?? [], now);
  const working = activity.state === "working";
  const leftOver = leftOverAgent(spec, runners, working, now);
  const agent = agentSlot(spec, runners, now)?.agent;
  const task =
    working && activity.runner.workspace_id === context.workspaceId
      ? context.tasks.find((item) => item.id === activity.taskId)
      : undefined;
  const lease = working
    ? activity.runner.leases.find((entry) => entry.agent === spec.id)
    : undefined;
  const waiting = working ? "" : agentWaiting(spec, runners, now);
  return {
    id: spec.id,
    name: spec.name.trim() || brandName(spec.kind),
    kind: spec.kind,
    state: leftOver
      ? "offline"
      : working
        ? "working"
        : activity.state === "idle" && waiting
          ? "waiting"
          : activity.state,
    task,
    elsewhere:
      working && !task ? activity.runner.workspace_name || "" : undefined,
    step: agent?.step,
    since: agent?.since || lease?.since,
    waiting,
    files: agent?.files,
    runnerName: seatRunner(runners, spec.id, now)?.name,
    leftOver,
    hadRunner: !!spec.runner,
    spec,
  };
}

function runnerOnlyMember(
  agent: RunnerAgent,
  runner: Runner,
  context: CrewContext,
): CrewMember {
  const online = isConnected(runner, context.now);
  const here = runner.workspace_id === context.workspaceId;
  const task =
    agent.task_id && here
      ? context.tasks.find((item) => item.id === agent.task_id)
      : undefined;
  return {
    id: agent.id,
    name: agent.name.trim() || brandName(agent.kind),
    kind: agent.kind,
    state: !online
      ? "offline"
      : agent.task_id
        ? "working"
        : agent.waiting
          ? "waiting"
          : "idle",
    task,
    elsewhere: agent.task_id && !task ? runner.workspace_name || "" : undefined,
    step: agent.step,
    since: agent.since,
    waiting: agent.waiting,
    files: agent.files,
    runnerName: runner.name,
    leftOver: false,
    hadRunner: true,
  };
}

const stateOrder: Record<MemberState, number> = {
  working: 0,
  waiting: 1,
  idle: 2,
  locked: 3,
  paused: 4,
  offline: 5,
};

export function byActivity(left: CrewMember, right: CrewMember): number {
  return stateOrder[left.state] - stateOrder[right.state];
}

/** The agents a runner card lists: the roster's agents it brought or seats,
 *  then any it reports that the roster does not know, such as the agents of
 *  a runner bound to another workspace. */
export function runnerMembers(
  runner: Runner,
  context: CrewContext,
): CrewMember[] {
  const own = context.roster.filter(
    (spec) =>
      spec.runner === runner.runner_id ||
      seatRunner(context.runners, spec.id, context.now)?.runner_id ===
        runner.runner_id,
  );
  const known = new Set(own.map((spec) => spec.id));
  return [
    ...own.map((spec) => rosterMember(spec, context)),
    ...runner.agents
      .filter((agent) => !!agent.id && !known.has(agent.id))
      .map((agent) => runnerOnlyMember(agent, runner, context)),
  ].sort(byActivity);
}

export function CrewBloub({
  kind,
  name,
  state,
  size = 28,
}: {
  kind: AgentKind;
  name: string;
  state: MemberState;
  size?: number;
}) {
  return (
    <span
      className="crew-bloub"
      data-state={state}
      style={{ "--bloub-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <ActivityBloub brand={kind} label={name} />
    </span>
  );
}

export function MemberRow({
  member,
  index = 0,
  showRunner,
  onOpenTask,
  onRemove,
}: {
  member: CrewMember;
  index?: number;
  showRunner?: boolean;
  onOpenTask?: (taskId: string) => void;
  onRemove?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const working = member.state === "working";
  const status =
    member.state === "offline"
      ? member.leftOver && member.hadRunner
        ? t("agents.runnerGone")
        : t("agents.agentOffline")
      : member.state === "paused"
        ? t("agents.agentPaused")
        : member.state === "locked"
          ? t("agents.agentLocked")
          : member.state === "waiting"
            ? member.waiting || t("agents.agentIdle")
            : t("agents.agentIdle");
  const taskText = member.task
    ? `${taskIdLabel(member.task.referenceId)} ${member.task.name}`
    : "";
  const task = member.task;
  return (
    <li
      className="crew-member"
      data-state={member.state}
      style={{ "--i": index } as CSSProperties}
    >
      <CrewBloub kind={member.kind} name={member.name} state={member.state} />
      <span className="crew-member__main">
        <span className="crew-member__who">
          <span className="crew-member__name">{member.name}</span>
          <span className="crew-member__brand" data-brand={member.kind}>
            {brandName(member.kind)}
          </span>
          {showRunner && !!member.runnerName && (
            <span className="crew-member__where">{member.runnerName}</span>
          )}
        </span>
        <span className="crew-member__doing">
          {working ? (
            <>
              {task && onOpenTask ? (
                <button
                  type="button"
                  className="crew-member__task"
                  title={taskText}
                  onClick={() => onOpenTask(task.id)}
                >
                  <span className="crew-member__ref">
                    {taskIdLabel(task.referenceId)}
                  </span>
                  <span className="crew-member__task-name">{task.name}</span>
                </button>
              ) : (
                <span className="crew-member__task-text" title={taskText}>
                  {taskText ||
                    t("agents.workingIn", {
                      workspace:
                        member.elsewhere || t("agents.unknownWorkspace"),
                    })}
                </span>
              )}
            </>
          ) : (
            <span
              className="crew-member__status"
              data-waiting={member.state === "waiting" || undefined}
              title={status}
            >
              {status}
            </span>
          )}
        </span>
        {working && (!!member.step || !!member.files?.length) && (
          <span className="crew-member__detail">
            {!!member.step && (
              <span className="crew-member__step" title={member.step}>
                {member.step}
              </span>
            )}
            {!!member.files?.length && (
              <span className="crew-member__files">
                {member.files.slice(0, 3).join(", ")}
                {member.files.length > 3 ? ` +${member.files.length - 3}` : ""}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="crew-member__end">
        {working && !!member.since ? (
          <Elapsed since={member.since} />
        ) : member.leftOver && onRemove ? (
          <IconButton
            label={t("agents.removeAgent", { name: member.name })}
            variant="ghost"
            onPress={() => onRemove(member.id)}
          >
            <Trash2 size={14} />
          </IconButton>
        ) : null}
      </span>
    </li>
  );
}
