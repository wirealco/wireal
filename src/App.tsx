import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import {
  Button,
  Card,
  Drawer,
  Dropdown,
  Kbd,
  Modal,
  Tabs,
  SearchField,
  toast,
  Tooltip,
  Typography,
} from "@heroui/react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  Position,
  MarkerType,
  Panel,
  ViewportPortal,
  applyNodeChanges,
  useEdges,
  useNodes,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import {
  ArrowRight,
  Circle,
  CircleCheck,
  Eye,
  EyeOff,
  Funnel,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  Info,
  SelectArea,
  Layers2,
  Lock,
  Unlock,
  Maximize,
  LayoutTemplate,
  Minus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  Search,
  Settings2,
  Trash2,
  Undo2,
  X,
} from "./icons";
import {
  agentSettings,
  type AgentSpec,
  canConnect,
  connectionKind,
  openReview,
  projectScope,
  projectRepository,
  removeTask,
  reorderProjects,
  setConnectionKind,
  statuses,
  uid,
  updateTask,
  type Project,
  type Status,
  type Task,
} from "./domain";
import {
  connectedTasks,
  createWorkflow,
  deleteWorkflow,
  freeWorkflowName,
  saveWorkflow,
  setWorkflowMembers,
  taskWorkflows,
  workflowGlow,
  workflowProgress,
  workflowsOf,
  workflowTasks,
} from "./workflows";
import { WorkflowSelectionMenu, WorkflowStrip } from "./WorkflowStrip";
import {
  boardViewportKey,
  recallViewport,
  rememberViewport,
} from "./canvas-viewport";
import { repository, useWorkspace, useWorkspaces, useSyncError } from "./store";
import {
  Choice,
  Dialog,
  IconButton,
  StatusChip,
  ProjectBadge,
  LabelBadge,
  statusOptions,
  TaskId,
} from "./ui";
import { AccountSettings } from "./AccountSettings";
import { WorkspaceInvitations } from "./WorkspaceInvitations";
import {
  agentDragType,
  agentLabel,
  agentRoster,
  canUnlockTask,
  lineTasks,
  lockReason,
  parseAgentDrag,
  taskLock,
  workingAgents,
  type Runner,
  type TaskLock,
} from "./runners";
import {
  lockTask,
  unlockTask,
  useRunners,
  useTaskLocks,
} from "./runners-client";
import { CrewWindow } from "./CrewWindow";
import { CrewPill, type AgentsSection } from "./CrewPill";
import { GlobalSearch } from "./GlobalSearch";
import { EditorModal, type EditorMode } from "./EditorModal";
import { TaskInspector } from "./TaskInspector";
import { TaskList } from "./TaskList";
import { WorkspaceCommits } from "./WorkspaceCommits";
import { arrangeWorkspace } from "./layout";
import { canvasShortcut, isCanvasShortcutTarget } from "./canvas-shortcuts";
import { AsciiFluid } from "./AsciiFluid";
import { FluidOrb, setOrbsStill } from "./FluidOrb";
import { LabelManager } from "./LabelManager";
import { MapEditor, NewWorkspaceDialog } from "./MapEditor";
import { PreferencesDialog } from "./PreferencesDialog";
import type { GitHubNotice } from "./WorkspaceGitHubSettings";
import { workspaceKind } from "./domain";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { AuthGate, type WorkspaceUser } from "./AuthGate";
import { useIsCompact } from "./breakpoint";
import { useCommandKey } from "./platform";
import { localPreview } from "./backend";
import { useInvitationInbox } from "./invitation-inbox";
import { PersonPhotos, TaskPeople, useWorkspacePhotos } from "./TaskPeople";
import { ActivityBloub, setBloubsCalm } from "./ActivityBloub";
import { agentDropEvent, dropTarget, type AgentDrop } from "./agent-drag";
import { agentBrand } from "./agent-identity";
import { taskPeople } from "./task-people";
import { FirstRunCoachMark } from "./FirstRunTour";
import { FlowCompass, useFlowCompass } from "./FlowCompass";
import {
  firstRunStart,
  firstRunStepAvailable,
  nextFirstRunStep,
  type FirstRunContext,
  type FirstRunStep,
} from "./first-run";
import { loadOnboardingState, saveOnboardingDone } from "./onboarding";
import {
  useThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";
import { useBoardBackground } from "./board-background";
import { traceChange } from "./boot-trace";
import { useCardDrift } from "./card-drift";

const sidebarWidthKey = "wireal.sidebar.width";

/* Where each coach mark sits relative to the control it points at. */
const firstRunPlacements: Record<
  FirstRunStep,
  ComponentProps<typeof FirstRunCoachMark>["placement"]
> = {
  workspace: "bottom start",
  project: "right top",
  task: "bottom end",
  wire: "top",
  views: "bottom start",
};

const TaskActions = createContext<(id: string, status: Status) => void>(
  () => {},
);
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    const media = matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return matches;
}
function cardDepth(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  return 0.55 + ((hash >>> 0) % 46) / 100;
}
type TaskNode = Node<
  {
    task: Task;
    projects: Project[];
    children: Task[];
    related: boolean;
    coding: boolean;
    droppable: boolean;
    lock: TaskLock | null;
    onFlowDrop: (taskId: string, agent: string) => void;
    /** The box-shadow rings for the workflows this task is in. */
    glow?: string;
  },
  "task"
>;
function TaskCard({ data, selected }: NodeProps<TaskNode>) {
  const { t } = useTranslation();
  const changeStatus = useContext(TaskActions);
  const [over, setOver] = useState(false);
  const { task, projects, children, related } = data;
  const people = taskPeople(task);
  const droppable = data.droppable;
  const lock = data.lock;
  const review = openReview(task);
  return (
    <Card
      data-testid="task-node"
      data-status={task.status}
      data-review={review ? "open" : undefined}
      data-droppable={droppable || undefined}
      data-agent-target={droppable ? `task:${task.id}` : undefined}
      data-over={over || undefined}
      onDragOver={(event) => {
        if (!droppable || !event.dataTransfer.types.includes(agentDragType))
          return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (
          event.currentTarget.contains(
            event.relatedTarget as globalThis.Node | null,
          )
        )
          return;
        setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        if (!droppable) return;
        const drag = parseAgentDrag(event.dataTransfer.getData(agentDragType));
        if (!drag) return;
        event.preventDefault();
        data.onFlowDrop(task.id, drag.agent);
      }}
      variant={selected ? "tertiary" : related ? "default" : "secondary"}
      className={
        related
          ? "task-card w-72 pointer-events-none opacity-35"
          : "task-card w-72"
      }
      data-related={related}
      data-workflow={data.glow ? "" : undefined}
      style={
        {
          "--card-depth": cardDepth(task.id),
          ...(data.glow ? { "--workflow-glow": data.glow } : {}),
        } as CSSProperties
      }
    >
      <Handle
        id="left"
        type="target"
        position={Position.Left}
        className="task-handle task-handle--target"
        title={t("canvas.dropDependency")}
      />
      <Card.Header>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Tooltip delay={250}>
              <Tooltip.Trigger className="inline-flex shrink-0">
                {/* A task in many projects keeps its title the room it
                needs: two badges overlap and a count stands for the rest,
                which the tooltip names. */}
                <div className="node-orbs">
                  {projects.slice(0, 2).map((project) => (
                    <FluidOrb
                      key={project.id}
                      settings={project.orb}
                      size={30}
                      label={`${project.name} project`}
                    />
                  ))}
                  {projects.length > 2 && (
                    <span className="node-orbs__more">
                      +{projects.length - 2}
                    </span>
                  )}
                </div>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <div className="flex flex-wrap gap-1">
                  {projects.map((project) => (
                    <ProjectBadge project={project} key={project.id} />
                  ))}
                </div>
              </Tooltip.Content>
            </Tooltip>
            <div className="min-w-0">
              <Card.Title data-testid="node-name" className="break-words">
                {task.name}
              </Card.Title>
              <Typography type="body-xs" color="muted" className="truncate">
                <TaskId value={task.referenceId} />
              </Typography>
            </div>
          </div>
        </div>
      </Card.Header>
      {task.labels.length > 0 && (
        <Card.Content>
          <div className="flex flex-wrap gap-1.5">
            {task.labels.map((l) => (
              <LabelBadge key={l} name={l} />
            ))}
          </div>
        </Card.Content>
      )}
      {children.length > 0 && (
        <Card.Content>
          <div className="subtask-list">
            <div className="subtask-list__label">
              <span>{t("canvas.subtasks")}</span>
              <span>
                {children.filter((c) => c.status === "done").length}/
                {children.length}
              </span>
            </div>
            {children.map((child) => (
              <button
                type="button"
                className="subtask-row nodrag"
                data-status={child.status}
                key={child.id}
                onClick={(event) => {
                  event.stopPropagation();
                  changeStatus(
                    child.id,
                    child.status === "done" ? "todo" : "done",
                  );
                }}
              >
                <span className="subtask-row__icon">
                  {child.status === "done" ? (
                    <CircleCheck size={14} />
                  ) : (
                    <Circle size={14} />
                  )}
                </span>
                <span className="subtask-row__name">{child.name}</span>
              </button>
            ))}
          </div>
        </Card.Content>
      )}
      {/* The last row, as on the landing card: what the task is on the left,
          who has worked on it pushed to the far right. */}
      <Card.Footer className="flex-wrap gap-x-2 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusChip status={task.status} />
          {data.coding && !!task.commitUrls.length && (
            <a
              className="activity-commit activity-commit--node nodrag"
              href={task.commitUrls[0]}
              target="_blank"
              rel="noreferrer"
              aria-label={t("canvas.openCommit", { name: task.name })}
            >
              <GitCommitHorizontal size={12} />
              {task.commitUrls[0].split("/").at(-1)?.slice(0, 7)}
            </a>
          )}
          {!!review && (
            <span className="node-tag node-tag--review" title={review.text}>
              <Undo2 size={12} />
              <span className="node-tag__label">
                {review.to
                  ? t("review.openTo", { name: review.to })
                  : t("review.open")}
              </span>
            </span>
          )}
          {!!lock && (
            <span className="node-tag node-tag--lock">
              <Lock size={12} />
              <span className="node-tag__label">
                {t("locks.lockedBy", {
                  name: lock.owner_name || t("locks.someone"),
                })}
              </span>
            </span>
          )}
          {related && (
            <span className="node-tag node-tag--accent">
              {t("canvas.related")}
            </span>
          )}
          {task.parentId && (
            <span className="node-tag">
              <GitBranch size={12} />
              {t("canvas.subtask")}
            </span>
          )}
        </div>
        <TaskPeople
          people={people}
          max={3}
          align="end"
          className="task-people--card"
        />
      </Card.Footer>
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className="task-handle task-handle--source"
        title={t("canvas.dragArrow")}
      />
    </Card>
  );
}
const nodeTypes = { task: TaskCard };

function LabelledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  label,
  style,
  selected,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });
  return (
    <>
      {selected && <path d={path} className="canvas-wire__halo" />}
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={26}
        style={style}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="canvas-edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const edgeTypes = { labelled: LabelledEdge };

const bloubFlightMs = 600;
const bloubCardWidth = 288;

type BloubPoint = { x: number; y: number };
type BloubFlight = { start: number; at: (ratio: number) => BloubPoint };

function edgePathElement(edgeId: string): SVGPathElement | null {
  if (typeof document === "undefined") return null;
  const id = typeof CSS?.escape === "function" ? CSS.escape(edgeId) : edgeId;
  return document.querySelector<SVGPathElement>(
    `.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`,
  );
}

function placeBloub(element: HTMLElement, point: { x: number; y: number }) {
  element.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
}

function flightBetween(
  wires: readonly Edge[],
  anchors: ReadonlyMap<string, BloubPoint>,
  from: string,
  to: string,
): BloubFlight | null {
  const start = performance.now();
  const wire = wires.find(
    (edge) =>
      edge.source === from &&
      edge.target === to &&
      !!edge.className?.includes("canvas-wire"),
  );
  const path = wire ? edgePathElement(wire.id) : null;
  const length = path?.getTotalLength() ?? 0;
  if (path && length)
    return { start, at: (ratio) => path.getPointAtLength(length * ratio) };
  const left = anchors.get(from);
  const arrived = anchors.get(to);
  if (!left || !arrived) return null;
  return {
    start,
    at: (ratio) => ({
      x: left.x + (arrived.x - left.x) * ratio,
      y: left.y + (arrived.y - left.y) * ratio,
    }),
  };
}

function AgentBloubs({
  runners,
  locks,
  roster,
  now,
  onCancel,
}: {
  runners: Runner[];
  locks: TaskLock[];
  roster: AgentSpec[];
  now: number;
  onCancel: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const agentOf = (id: string) => {
    const spec = roster.find((candidate) => candidate.id === id);
    return spec
      ? { brand: spec.kind, label: agentLabel(spec) }
      : { brand: agentBrand(id), label: id };
  };
  const nodes = useNodes<TaskNode>();
  const wires = useEdges();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const anchors = useMemo(() => {
    const map = new Map<string, BloubPoint>();
    for (const node of nodes)
      map.set(node.id, {
        x: node.position.x + (node.measured?.width ?? bloubCardWidth),
        y: node.position.y,
      });
    return map;
  }, [nodes]);
  const working = useMemo(() => {
    const seen = new Set<string>();
    return workingAgents(runners, now)
      .map(({ runner, agent }) => ({
        id: agent.id,
        taskId: agent.task_id ?? "",
        runnerName: runner.name,
      }))
      .filter((agent) => {
        if (seen.has(agent.id) || !anchors.has(agent.taskId)) return false;
        seen.add(agent.id);
        return true;
      });
  }, [runners, now, anchors]);
  const pending = useMemo(() => {
    const held = new Set(working.map((agent) => agent.taskId));
    return locks.filter(
      (lock) =>
        !!lock.agent && anchors.has(lock.task_id) && !held.has(lock.task_id),
    );
  }, [locks, working, anchors]);
  const places = working
    .map((agent) => `${agent.id}:${agent.taskId}`)
    .join(" ");
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  const wiresRef = useRef(wires);
  wiresRef.current = wires;
  const placesRef = useRef(new Map<string, string>());
  placesRef.current = new Map(working.map((agent) => [agent.id, agent.taskId]));
  const host = useRef<HTMLDivElement>(null);
  const flights = useRef(new Map<string, BloubFlight>());
  const frame = useRef(0);
  const bloubOf = useCallback(
    (agentId: string) =>
      host.current?.querySelector<HTMLElement>(
        `.agent-bloub[data-agent="${CSS.escape(agentId)}"]`,
      ) ?? null,
    [],
  );
  const settle = useCallback(
    (agentId: string) => {
      const element = bloubOf(agentId);
      if (!element) return;
      const taskId = placesRef.current.get(agentId);
      const anchor = taskId ? anchorsRef.current.get(taskId) : undefined;
      if (anchor) placeBloub(element, anchor);
      element.dataset.flying = "false";
    },
    [bloubOf],
  );
  const run = useCallback(() => {
    frame.current = 0;
    const at = performance.now();
    for (const [agentId, flight] of [...flights.current]) {
      const element = bloubOf(agentId);
      if (!element) {
        flights.current.delete(agentId);
        continue;
      }
      const ratio = Math.min(1, (at - flight.start) / bloubFlightMs);
      if (ratio >= 1) {
        flights.current.delete(agentId);
        settle(agentId);
        continue;
      }
      const eased = ratio * ratio * (3 - 2 * ratio);
      placeBloub(element, flight.at(eased));
    }
    if (flights.current.size) frame.current = requestAnimationFrame(run);
  }, [bloubOf, settle]);
  const previous = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    const current = placesRef.current;
    const before = previous.current;
    previous.current = new Map(current);
    for (const agentId of [...flights.current.keys()])
      if (!current.has(agentId)) flights.current.delete(agentId);
    if (reducedMotion) return;
    for (const [agentId, taskId] of current) {
      const left = before.get(agentId);
      if (!left || left === taskId) continue;
      const flight = flightBetween(
        wiresRef.current,
        anchorsRef.current,
        left,
        taskId,
      );
      if (!flight) continue;
      flights.current.set(agentId, flight);
      const element = bloubOf(agentId);
      if (element) {
        element.dataset.flying = "true";
        placeBloub(element, flight.at(0));
      }
    }
    if (flights.current.size && !frame.current)
      frame.current = requestAnimationFrame(run);
  }, [places, reducedMotion, run, bloubOf]);
  useLayoutEffect(() => {
    for (const agent of working)
      if (!flights.current.has(agent.id)) settle(agent.id);
  }, [working, settle]);
  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );
  return (
    <>
      <ViewportPortal>
        <div className="agent-bloubs" ref={host}>
          {working.map((agent) => (
            <div
              className="agent-bloub"
              data-flying="false"
              data-agent={agent.id}
              data-task={agent.taskId}
              key={agent.id}
            >
              <span className="agent-bloub__pulse" />
              <ActivityBloub
                brand={agentOf(agent.id).brand}
                label={agentOf(agent.id).label}
                ariaLabel={`${agentOf(agent.id).label} on ${agent.runnerName}`}
              />
            </div>
          ))}
          {pending.map((lock) => {
            const anchor = anchors.get(lock.task_id);
            if (!anchor) return null;
            const agent = agentOf(lock.agent ?? "");
            return (
              <button
                type="button"
                className="agent-bloub agent-bloub--ghost"
                key={lock.task_id}
                title={t("locks.waitingForAgent")}
                aria-label={t("locks.unlock")}
                style={{
                  transform: `translate(${anchor.x}px, ${anchor.y}px) translate(-50%, -50%)`,
                }}
                onClick={() => onCancel(lock.task_id)}
              >
                <ActivityBloub
                  brand={agent.brand}
                  label={agent.label || t("agents.title")}
                />
              </button>
            );
          })}
        </div>
      </ViewportPortal>
    </>
  );
}
/** Stills the agents' faces while the board is zoomed out or crowded, where
 *  they are too small to read and their motion only costs frames. */
function CalmFaces({ tasks }: { tasks: number }) {
  const zoom = useStore((state) => state.transform[2]);
  const calm = zoom < 0.7 || (tasks > 60 && zoom < 1);
  useEffect(() => {
    setBloubsCalm(calm);
    setOrbsStill(calm);
  }, [calm]);
  useEffect(
    () => () => {
      setBloubsCalm(false);
      setOrbsStill(false);
    },
    [],
  );
  return null;
}

export function App() {
  const theme = useThemePreference();

  const changeTheme = (preference: ThemePreference) => {
    if (preference === theme.preference) return;
    theme.setPreference(preference);
  };

  return (
    <AuthGate theme={theme.resolved} onThemeChange={changeTheme}>
      {(user, signOut) => (
        <ReactFlowProvider>
          <WorkspaceApp
            user={user}
            onSignOut={signOut}
            resolvedTheme={theme.resolved}
            onThemeChange={changeTheme}
          />
        </ReactFlowProvider>
      )}
    </AuthGate>
  );
}

function WorkspaceApp({
  user,
  onSignOut,
  resolvedTheme,
  onThemeChange,
}: {
  user: WorkspaceUser;
  onSignOut?: () => Promise<void>;
  resolvedTheme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const state = useWorkspace();
  const boardBackground = useBoardBackground();
  const cardDrift = useCardDrift();
  const drifts = cardDrift.drift === "on";
  const compass = useFlowCompass();
  const coding = workspaceKind(state) === "coding";
  const workspaces = useWorkspaces();
  const [projectId, setProjectId] = useState("all");
  const [showRelations, setShowRelations] = useState(true);
  const [linkMode, setLinkMode] = useState<null | "dependency" | "subtask">(
    null,
  );
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [view, setView] = useState("board");
  const [listGroupBy, setListGroupBy] = useState("status");
  const [search, setSearch] = useState("");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const usesCommandKey = useCommandKey();
  const [filter, setFilter] = useState("all");
  const [workflowFilter, setWorkflowFilter] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [modal, setModal] = useState<EditorMode | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [mapEditorOpen, setMapEditorOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [githubNotice, setGithubNotice] = useState<GitHubNotice>();
  const githubWorkspace = useRef<string | null>(null);
  const githubHandled = useRef(false);
  const invitationsOpen = location.pathname === "/invitations";
  const { count: invitationCount, refresh: refreshInvitations } =
    useInvitationInbox({
      enabled: true,
      onNew: (invitations) => {
        for (const invitation of invitations) {
          toast.info(
            t("invitations.notice", {
              name: invitation.invitedBy.name,
              workspace: invitation.workspaceName,
            }),
            {
              actionProps: {
                children: t("team.inbox"),
                onPress: () => navigate("/invitations"),
              },
              timeout: 12000,
            },
          );
        }
      },
    });
  const invitationsWereOpen = useRef(invitationsOpen);
  useEffect(() => {
    if (invitationsWereOpen.current && !invitationsOpen) {
      void refreshInvitations();
    }
    invitationsWereOpen.current = invitationsOpen;
  }, [invitationsOpen, refreshInvitations]);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const {
    runners,
    now: runnersAt,
    error: runnersError,
    reload: reloadRunners,
  } = useRunners(repository.getActiveWorkspaceId());
  const { locks: taskLocks, reload: reloadLocks } = useTaskLocks(
    repository.getActiveWorkspaceId(),
  );
  const [runnersOpen, setRunnersOpen] = useState<AgentsSection | null>(null);
  const workspaceOwner =
    workspaces.find((entry) => entry.id === repository.getActiveWorkspaceId())
      ?.role !== "collaborator";
  const lockBlock = lockReason(
    runners,
    repository.getActiveWorkspaceId(),
    user.id ?? "",
    runnersAt,
  );
  const canLock = !lockBlock;
  const lockHint = lockBlock
    ? lockBlock.reason === "runnerElsewhere"
      ? t("locks.runnerElsewhere", { name: lockBlock.name })
      : t("locks.needRunner")
    : undefined;
  const [firstRunStep, setFirstRunStep] = useState<FirstRunStep | null>(null);
  const [firstRunWaiting, setFirstRunWaiting] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const isMobile = useIsCompact();
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [compactViewTools, setCompactViewTools] = useState(false);
  const [discloseViewTools, setDiscloseViewTools] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem(sidebarWidthKey));
    return Number.isFinite(stored) && stored >= 192 && stored <= 384
      ? stored
      : 240;
  });
  const [boardMenu, setBoardMenu] = useState<{
    x: number;
    y: number;
    taskId?: string;
  } | null>(null);

  useEffect(() => {
    document.title = `Wireal — ${state.map.name}`;
    return () => {
      document.title = "Wireal";
    };
  }, [state.map.name]);

  useEffect(() => {
    if (!coding && view === "commits") setView("board");
  }, [coding, view]);

  useLayoutEffect(() => {
    const viewbar = document.querySelector<HTMLElement>(".workspace-viewbar");
    const tabs = viewbar?.querySelector<HTMLElement>(
      ".workspace-viewbar__tabs",
    );
    const tools = document.getElementById("workspace-view-tools");
    const content = tools?.querySelector<HTMLElement>(
      ".workspace-view-tools__content",
    );
    if (!viewbar || !tabs || !tools || !content) return;

    let frame = 0;
    const measureContent = (compact: boolean) => {
      const clone = content.cloneNode(true) as HTMLElement;
      clone.classList.toggle("workspace-view-tools__content--compact", compact);
      clone.setAttribute("aria-hidden", "true");
      clone.inert = true;
      Object.assign(clone.style, {
        position: "fixed",
        inset: "0 auto auto -10000px",
        display: "inline-flex",
        width: "max-content",
        maxWidth: "none",
        flex: "none",
        flexWrap: "nowrap",
        visibility: "hidden",
        pointerEvents: "none",
      });
      document.body.append(clone);
      const width = clone.getBoundingClientRect().width;
      clone.remove();
      return width;
    };
    const measure = () => {
      const viewbarStyle = getComputedStyle(viewbar);
      const available =
        viewbar.clientWidth -
        (Number.parseFloat(viewbarStyle.paddingLeft) || 0) -
        (Number.parseFloat(viewbarStyle.paddingRight) || 0);
      if (available <= 0) return;

      const tabList = tabs.querySelector<HTMLElement>(".tabs__list");
      const tabsRequired = tabList?.scrollWidth ?? tabs.scrollWidth;
      const gap =
        Number.parseFloat(viewbarStyle.columnGap || viewbarStyle.gap) || 0;
      const expandedRequired = measureContent(false);
      const compactRequired = measureContent(true);
      const toolsAvailable = Math.max(0, available - tabsRequired - gap);
      const nextDisclosure = compactRequired + 8 > toolsAvailable;

      setDiscloseViewTools((current) =>
        current === nextDisclosure ? current : nextDisclosure,
      );
      setCompactViewTools((current) => {
        const next = !nextDisclosure && expandedRequired > toolsAvailable + 1;
        return current === next ? current : next;
      });
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(viewbar);
    resizeObserver.observe(tabs);
    resizeObserver.observe(tools);
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(content, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [i18n.resolvedLanguage, mobileToolsOpen, projectId, view]);

  useEffect(() => {
    if (!discloseViewTools) setMobileToolsOpen(false);
  }, [discloseViewTools]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("github");
    if (!outcome) return;
    githubWorkspace.current = params.get("workspace");
    const ticket = params.get("ticket");
    params.delete("github");
    params.delete("workspace");
    params.delete("ticket");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    setGithubNotice(
      outcome === "connected" || outcome === "requested"
        ? outcome
        : outcome === "choose" && ticket
          ? { kind: "choose", ticket }
          : "error",
    );
  }, []);

  useEffect(() => {
    if (!githubNotice || githubHandled.current || !workspaces.length) return;
    githubHandled.current = true;
    const target = githubWorkspace.current;
    if (
      !target ||
      target === repository.getActiveWorkspaceId() ||
      !workspaces.some((workspace) => workspace.id === target)
    ) {
      setMapEditorOpen(true);
      return;
    }
    void repository
      .switchWorkspace(target)
      .then(() => {
        framedProject.current = null;
        switchProject("all");
        setMapEditorOpen(true);
      })
      .catch((cause) =>
        toast.danger(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [githubNotice, workspaces]);

  useEffect(() => {
    // The signed-out local preview has no profile to read the tour state from;
    // http://localhost:5174/app?tour=1 starts it anyway, for screenshots.
    if (
      localPreview &&
      new URLSearchParams(window.location.search).has("tour")
    ) {
      setFirstRunWaiting(true);
      return;
    }
    if (!user.id) return;
    let active = true;
    void loadOnboardingState(user.id)
      .then((onboarding) => {
        if (!active || onboarding.onboardingDone) return;
        setFirstRunWaiting(true);
      })
      .catch(() => {
        if (active) toast.danger(i18n.t("tour.loadError"));
      });
    return () => {
      active = false;
    };
  }, [i18n, user.id]);

  const finishFirstRun = () => {
    setFirstRunStep(null);
    setFirstRunWaiting(false);
    if (!user.id) return;
    void saveOnboardingDone(user.id).catch(() =>
      toast.danger(t("tour.saveError")),
    );
  };

  const firstRunContext: FirstRunContext = useMemo(
    () => ({
      hasWorkspace: workspaces.length > 0,
      hasProject: state.projects.length > 0,
      onBoard: view === "board",
    }),
    [workspaces.length, state.projects.length, view],
  );

  useEffect(() => {
    if (!firstRunWaiting || firstRunStep) return;
    const start = firstRunStart(firstRunContext);
    if (!start) return;
    setFirstRunWaiting(false);
    setFirstRunStep(start);
  }, [firstRunWaiting, firstRunStep, firstRunContext]);

  const advanceFirstRun = () => {
    if (!firstRunStep) return;
    const next = nextFirstRunStep(firstRunStep, firstRunContext);
    if (next) setFirstRunStep(next);
    else finishFirstRun();
  };

  /* Steps that the user completes by acting on the real control, rather than
     by pressing Next in the bubble. */
  const completeFirstRunStep = (
    step: FirstRunStep,
    context: FirstRunContext = firstRunContext,
  ) => {
    if (firstRunStep !== step) return;
    const next = nextFirstRunStep(step, context);
    if (next) setFirstRunStep(next);
    else finishFirstRun();
  };

  /* A step whose control disappears — leaving the board during "wire", say —
     moves on instead of leaving an invisible bubble behind. The workspace
     itself going away is the one case that is not progress: the tour goes back
     to waiting rather than calling itself finished. */
  useEffect(() => {
    if (!firstRunStep) return;
    if (firstRunStepAvailable(firstRunStep, firstRunContext)) return;
    const next = nextFirstRunStep(firstRunStep, firstRunContext);
    if (next) setFirstRunStep(next);
    else if (!firstRunContext.hasWorkspace) {
      setFirstRunStep(null);
      setFirstRunWaiting(true);
    } else finishFirstRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstRunStep, firstRunContext]);
  const flow = useReactFlow<TaskNode>();
  const boardRef = useRef<HTMLDivElement>(null);
  const boardPhone = useMediaQuery("(max-width: 719px)");
  const boardStill = useMediaQuery("(prefers-reduced-motion: reduce)");
  useEffect(() => {
    const host = boardRef.current;
    if (view !== "board" || !host || boardPhone || boardStill || !drifts)
      return;
    let raf = 0;
    let pointer: { x: number; y: number } | null = null;
    const paint = () => {
      raf = 0;
      if (!pointer || host.dataset.drift === "off") {
        host.style.setProperty("--board-drift-x", "0px");
        host.style.setProperty("--board-drift-y", "0px");
        return;
      }
      const frame = host.getBoundingClientRect();
      if (!frame.width || !frame.height) return;
      const offX =
        (pointer.x - frame.left - frame.width / 2) / (frame.width / 2);
      const offY =
        (pointer.y - frame.top - frame.height / 2) / (frame.height / 2);
      host.style.setProperty("--board-drift-x", `${(-offX * 6).toFixed(2)}px`);
      host.style.setProperty("--board-drift-y", `${(-offY * 6).toFixed(2)}px`);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onLeave = () => {
      pointer = null;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
      host.style.removeProperty("--board-drift-x");
      host.style.removeProperty("--board-drift-y");
    };
  }, [view, boardPhone, boardStill, drifts]);
  useEffect(() => {
    const host = boardRef.current;
    return () => {
      if (host) host.dataset.hover = "off";
    };
  }, [view]);
  const effectiveProjects = useMemo(
    () =>
      state.projects.map((item) => ({
        ...item,
        repositoryUrl: projectRepository(state, item),
      })),
    [state],
  );
  const project = effectiveProjects.find((p) => p.id === projectId);
  const activeWorkspaceId = repository.getActiveWorkspaceId();
  const scoped = projectScope(state, projectId, showRelations);
  const visible = scoped.filter(
    (t) =>
      (filter === "all" || filter === t.status) &&
      (!workflowFilter || !!t.workflowIds?.includes(workflowFilter)) &&
      `${t.name} ${t.labels.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const task = state.tasks.find((t) => t.id === selected);
  const [nodes, setNodes] = useState<TaskNode[]>([]);
  useEffect(() => {
    if (!nodes.length) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        traceChange("painted", {
          nodes: nodes.length,
          cards: document.querySelectorAll(".task-card").length,
          canvases: document.querySelectorAll("canvas").length,
          images: document.querySelectorAll("img").length,
          field: document.querySelector(".workspace-board__field")
            ? "fluid"
            : "dots",
        }),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [nodes.length]);
  // Every height the board has ever reported, so arranging twice in a row does
  // not lay out the second time against cards that are between measurements.
  const cardHeights = useRef(new Map<string, number>());
  /**
   * Restore where this board was left, or fit it if it has never been seen.
   * A task card is 288px wide and a full workspace is far wider than a screen,
   * so opening at 1:1 showed three cards and hid the shape of everything else;
   * fitting is the right first view, and after that the frame is the user's.
   * Capped so a workspace holding one task does not fill the screen with it.
   */
  const framedProject = useRef<string | null>(null);
  useEffect(() => {
    if (view !== "board" || !nodes.length) return;
    // One canvas per workspace: a project in the sidebar is a filter over it,
    // so picking one never moves the frame. Only opening a workspace does.
    const workspaceId = repository.getActiveWorkspaceId();
    if (framedProject.current === workspaceId) return;
    framedProject.current = workspaceId;
    const key = boardViewportKey(workspaceId);
    const remembered = recallViewport(key);
    // A board that has been framed before keeps its frame. This has to be
    // checked here as well as at mount: on a refresh defaultViewport restores
    // it and then this effect ran anyway, fitting straight over the top, which
    // is why the frame appeared not to survive a reload at all.
    if (remembered) {
      void flow.setViewport(remembered, { duration: 0 });
      return;
    }
    void flow.fitView({
      padding: 0.18,
      minZoom: 0.1,
      maxZoom: 0.85,
      duration: 0,
    });
    // Recorded straight away, so a board framed once has a viewport to come
    // back to even if it is never moved by hand.
    requestAnimationFrame(() => rememberViewport(key, flow.getViewport()));
  }, [view, nodes, flow]);
  const flowReady = useMemo(() => {
    const byId = new Map(state.tasks.map((task) => [task.id, task]));
    const waiting = new Set<string>();
    for (const link of state.links)
      if (byId.get(link.source)?.status !== "done") waiting.add(link.target);
    const ready = new Set<string>();
    for (const task of state.tasks) {
      const sentBack = task.status === "done" && !!openReview(task);
      if ((task.status !== "todo" && !sentBack) || waiting.has(task.id))
        continue;
      if (task.parentId && byId.get(task.parentId)?.status !== "done") continue;
      ready.add(task.id);
    }
    return ready;
  }, [state.tasks, state.links]);
  const lock = useCallback(
    async (taskId: string, agent = "", line = false) => {
      try {
        await lockTask(repository.getActiveWorkspaceId(), taskId, agent, line);
        toast.success(t("locks.locked"));
      } catch (cause) {
        toast.danger(cause instanceof Error ? cause.message : String(cause));
      }
      void reloadLocks();
      void reloadRunners();
    },
    [reloadLocks, reloadRunners, t],
  );
  const workflows = workflowsOf(state);
  useEffect(() => {
    if (
      workflowFilter &&
      !(state.workflows ?? []).some((item) => item.id === workflowFilter)
    )
      setWorkflowFilter(null);
  }, [workflowFilter, state.workflows]);
  /** Workflow edits validate as they apply, so a refused one is said rather
   *  than thrown out of an event handler. */
  const changeWorkflows = useCallback(
    (change: Parameters<typeof repository.commit>[0]) => {
      try {
        repository.commit(change);
        return true;
      } catch (cause) {
        toast.danger(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    },
    [],
  );
  /** Hand a workflow's open tasks to one agent. A runner works only the tasks
   *  locked to its agents, so assigning is locking each open task in turn;
   *  tasks someone else holds are left with them. */
  const lockToAgent = useCallback(
    async (taskIds: readonly string[], agentId: string, name: string) => {
      if (!taskIds.length) return;
      if (!canLock) {
        toast.danger(lockHint ?? t("locks.needRunner"));
        return;
      }
      const workspaceId = repository.getActiveWorkspaceId();
      let locked = 0;
      let failure = "";
      for (const taskId of taskIds) {
        const held = taskLock(taskLocks, taskId);
        if (held && user.id && held.owner_id !== user.id) continue;
        try {
          await lockTask(workspaceId, taskId, agentId, false);
          locked += 1;
        } catch (cause) {
          failure ||= cause instanceof Error ? cause.message : String(cause);
        }
      }
      if (locked)
        toast.success(t("workflows.assigned", { count: locked, name }));
      if (failure) toast.danger(t("workflows.lockFailed", { reason: failure }));
      void reloadLocks();
      void reloadRunners();
    },
    [canLock, lockHint, taskLocks, user.id, reloadLocks, reloadRunners, t],
  );
  const openTasksOf = (workflowId: string, only?: readonly string[]) =>
    workflowTasks(repository.get(), workflowId)
      .filter((task) => task.status !== "done")
      .filter((task) => !only || only.includes(task.id))
      .map((task) => task.id);
  const agentName = (agentId: string) => {
    const spec = agentRoster(agentSettings(state)).find(
      (item) => item.id === agentId,
    );
    return spec ? agentLabel(spec) : agentId;
  };
  function newWorkflow(name: string, taskIds: readonly string[]) {
    let made = "";
    const done = changeWorkflows((current) => {
      const result = createWorkflow(current, { name, taskIds });
      made = result.workflow.name;
      return result.state;
    });
    if (done) toast.success(t("workflows.created", { name: made }));
  }
  function addToWorkflow(workflowId: string, taskIds: readonly string[]) {
    changeWorkflows((current) =>
      setWorkflowMembers(current, workflowId, taskIds, true),
    );
  }
  /** An agent dropped on a workflow takes all of it: every open task in the
   *  workflow is locked to that agent, the way a card drop locks its line. */
  function dropAgentOnWorkflow(workflowId: string, agentId: string) {
    void lockToAgent(openTasksOf(workflowId), agentId, agentName(agentId));
  }
  const [stopping, setStopping] = useState<{
    taskId: string;
    line: boolean;
  } | null>(null);
  const unlock = useCallback(
    async (taskId: string, line = false) => {
      try {
        await unlockTask(repository.getActiveWorkspaceId(), taskId, line);
        toast.success(t("locks.unlocked"));
      } catch (cause) {
        toast.danger(cause instanceof Error ? cause.message : String(cause));
      }
      void reloadLocks();
      void reloadRunners();
    },
    [reloadLocks, reloadRunners, t],
  );
  const stoppingTargets = useMemo(() => {
    if (!stopping) return [];
    const reach = stopping.line
      ? lineTasks(state, stopping.taskId).map((task) => task.id)
      : [stopping.taskId];
    return taskLocks.filter((held) => reach.includes(held.task_id));
  }, [stopping, state, taskLocks]);
  const stoppingOthers = useMemo(
    () =>
      [
        ...new Set(
          stoppingTargets
            .filter((held) => !!user.id && held.owner_id !== user.id)
            .map((held) => held.owner_name || t("locks.someone")),
        ),
      ].join(", "),
    [stoppingTargets, user.id, t],
  );
  const flowDrop = useMemo(
    () => ({
      enabled: agentSettings(state).mode === "directed",
      ready: flowReady,
      // Directed means only what a person hands over: dropping an agent on a
      // card locks that one task to it, and nothing below it.
      onDrop: (taskId: string, agent: string) => void lock(taskId, agent),
    }),
    [state, flowReady, lock],
  );
  // An agent carried from the crew pill lands here; only targets that would
  // take it are marked as targets, so whatever arrives is acted on.
  const dropOnWorkflow = useRef(dropAgentOnWorkflow);
  dropOnWorkflow.current = dropAgentOnWorkflow;
  useEffect(() => {
    const landed = (event: Event) => {
      const drop = (event as CustomEvent<AgentDrop>).detail;
      const target = dropTarget(drop.target);
      if (target?.kind === "task") flowDrop.onDrop(target.id, drop.agent);
      if (target?.kind === "workflow")
        dropOnWorkflow.current(target.id, drop.agent);
    };
    window.addEventListener(agentDropEvent, landed);
    return () => window.removeEventListener(agentDropEvent, landed);
  }, [flowDrop]);
  useEffect(
    () =>
      // Rebuilt from the workspace on every change, so the selection has to be
      // carried across or it is destroyed by the next commit. React Flow owns
      // multi-selection; this keeps whatever it holds and adds the single task
      // the inspector is showing.
      setNodes((current) => {
        const chosen = new Set(
          current.filter((node) => node.selected).map((node) => node.id),
        );
        // Carried across for the same reason as the selection: React Flow
        // measures a card after it mounts, and a rebuilt node that arrives
        // without its size is treated as the shortest card there is until the
        // next measure lands.
        const sized = new Map(current.map((node) => [node.id, node.measured]));
        return visible.map((t) => {
          const related =
            projectId !== "all" && !t.projectIds.includes(projectId);
          return {
            id: t.id,
            type: "task",
            position: t.position,
            measured: sized.get(t.id),
            selected: chosen.has(t.id) || t.id === selected,
            className: linkMode
              ? t.id === linkSource
                ? "link-pick link-pick--source"
                : "link-pick"
              : undefined,
            draggable: !related && !linkMode,
            selectable: !related && !linkMode,
            connectable: !related,
            deletable: !related,
            focusable: !related,
            data: {
              task: t,
              projects: state.projects.filter((p) =>
                t.projectIds.includes(p.id),
              ),
              related,
              children: state.tasks.filter((c) => c.parentId === t.id),
              coding: workspaceKind(state) === "coding",
              droppable:
                !related && flowDrop.enabled && flowDrop.ready.has(t.id),
              lock: taskLock(taskLocks, t.id),
              onFlowDrop: flowDrop.onDrop,
              glow: workflowGlow(
                taskWorkflows(state, t).map((workflow) => workflow.color),
              ),
            },
          };
        });
      }),
    [
      state,
      projectId,
      filter,
      workflowFilter,
      search,
      selected,
      showRelations,
      linkMode,
      linkSource,
      flowDrop,
      taskLocks,
    ],
  );
  useEffect(() => {
    if (projectId !== "all" && !state.projects.some((p) => p.id === projectId))
      setProjectId("all");
  }, [state.projects, projectId]);
  useEffect(() => {
    const preventNativeContextMenu = (event: MouseEvent) =>
      event.preventDefault();
    document.addEventListener("contextmenu", preventNativeContextMenu);
    return () =>
      document.removeEventListener("contextmenu", preventNativeContextMenu);
  }, []);
  useEffect(() => {
    if (!isMobile) setMobileNav(false);
  }, [isMobile]);
  function fitBoard() {
    void flow.fitView({
      padding: 0.15,
      minZoom: 0.02,
      maxZoom: 1,
    });
  }
  function arrangeBoard() {
    // Read off the board itself. React Flow measures a card once, when it
    // mounts, and the node rebuild above drops what it measured; nothing
    // resizes afterwards, so it never measures again and every card would be
    // stacked as if it were the shortest one there is.
    for (const node of nodes) {
      const drawn = document.querySelector<HTMLElement>(
        `.workspace-board .react-flow__node[data-id="${CSS.escape(node.id)}"]`,
      );
      const height = drawn?.offsetHeight || node.measured?.height;
      if (height) cardHeights.current.set(node.id, height);
    }
    const chosen = nodes.filter((node) => node.selected).map((node) => node.id);
    const scope = new Set(
      chosen.length > 1 ? chosen : visible.map((task) => task.id),
    );
    repository.commit((current) =>
      arrangeWorkspace(current, cardHeights.current, scope),
    );
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === "k" &&
        (e.metaKey || e.getModifierState("AltGraph") || (e.ctrlKey && e.altKey))
      ) {
        e.preventDefault();
        setMobileNav(false);
        setGlobalSearchOpen(true);
        return;
      }
      if (
        e.key.toLowerCase() === "b" &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        !e.repeat
      ) {
        e.preventDefault();
        setSidebarOpen((open) => !open);
        return;
      }
      if (
        e.key === "," &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        !e.repeat
      ) {
        e.preventDefault();
        setMobileNav(false);
        setPreferencesOpen(true);
        return;
      }
      if (isCanvasShortcutTarget(e.target)) return;
      const plain =
        !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat;
      if (plain && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setModal({ type: state.projects.length ? "task" : "project" });
        return;
      }
      if (plain && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setMobileNav(false);
        setRunnersOpen("runners");
        return;
      }
      if (plain && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setMobileNav(false);
        setRunnersOpen("settings");
        return;
      }
      const canvasAction = view === "board" ? canvasShortcut(e, "board") : null;
      if (canvasAction === "fit-view") {
        e.preventDefault();
        fitBoard();
        return;
      }
      if (canvasAction === "arrange") {
        e.preventDefault();
        arrangeBoard();
        return;
      }
      if (canvasAction === "select") {
        e.preventDefault();
        setSelectMode((current) => !current);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? repository.redo() : repository.undo();
      }
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        switchProject("all");
      }
      if (e.key === "Escape") {
        setSelected(null);
        setSelectedEdge(null);
        setLinkMode(null);
        setLinkSource(null);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [state.projects.length, view]);
  // Read from the nodes rather than kept as its own state: React Flow is the
  // one that knows what is selected, and a second copy would drift from it.
  // A sync failure used to share the corner card with transient notices. It is
  // raised once per distinct message rather than on every render, or a store
  // that keeps failing would stack an identical toast per re-render.
  const syncError = useSyncError();
  const shownError = useRef<string | null>(null);
  useEffect(() => {
    if (!syncError) {
      shownError.current = null;
      return;
    }
    if (shownError.current === syncError) return;
    shownError.current = syncError;
    toast.danger(syncError);
  }, [syncError]);
  const chosenTasks = nodes.filter((node) => node.selected);
  const ids = new Set(visible.map((t) => t.id));
  // Recomputed from the workspace rather than stored, so converting a
  // connection leaves the panel showing what it has become.
  const selectedKind = selectedEdge
    ? connectionKind(state, selectedEdge)
    : null;
  const edges: Edge[] = [
    ...state.links.map((e) => ({
      ...e,
      sourceHandle: "right",
      targetHandle: "left",
      className: `canvas-wire dependency-edge ${e.id === selectedEdge ? "canvas-wire--selected" : ""}`,
      type: "labelled",
      selected: e.id === selectedEdge,
      label: state.tasks
        .find((t) => t.id === e.source)
        ?.projectIds.some((id) =>
          state.tasks.find((t) => t.id === e.target)?.projectIds.includes(id),
        )
        ? undefined
        : t("canvas.crossProject"),
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent)" },
    })),
    ...state.tasks
      .filter((taskItem) => taskItem.parentId)
      .map((taskItem) => ({
        id: `parent-${taskItem.id}`,
        source: taskItem.parentId!,
        target: taskItem.id,
        sourceHandle: "right",
        targetHandle: "left",
        selected: `parent-${taskItem.id}` === selectedEdge,
        label: t("canvas.subtask"),
        type: "labelled",
        deletable: false,
        className: `canvas-wire subtask-edge ${`parent-${taskItem.id}` === selectedEdge ? "canvas-wire--selected" : ""}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--success)" },
      })),
  ].filter((e) => ids.has(e.source) && ids.has(e.target));
  const wiresRef = useRef(edges);
  wiresRef.current = edges;
  function paintHover(hovered: string | null) {
    const host = boardRef.current;
    if (!host) return;
    host.dataset.hover = hovered ? "on" : "off";
    const wires = wiresRef.current;
    for (const node of host.querySelectorAll<HTMLElement>(
      ".react-flow__node",
    )) {
      const id = node.dataset.id;
      if (!id) continue;
      let relation = "rest";
      if (hovered) {
        relation = id === hovered ? "self" : "far";
        if (
          relation === "far" &&
          wires.some(
            (wire) =>
              (wire.source === hovered && wire.target === id) ||
              (wire.target === hovered && wire.source === id),
          )
        ) {
          relation = "near";
        }
      }
      node.dataset.relation = relation;
    }
    for (const wire of host.querySelectorAll<SVGGElement>(
      ".react-flow__edge",
    )) {
      const id = wire.dataset.id;
      if (!id) continue;
      const match = wires.find((item) => item.id === id);
      wire.dataset.lit =
        hovered &&
        match &&
        (match.source === hovered || match.target === hovered)
          ? "true"
          : "false";
    }
  }
  function holdDrift(still: boolean) {
    const host = boardRef.current;
    if (!host) return;
    host.dataset.drift = still ? "off" : "on";
    if (still) {
      host.style.setProperty("--board-drift-x", "0px");
      host.style.setProperty("--board-drift-y", "0px");
    }
  }
  /** The signed-in person, as the activity a task keeps writes them down. */
  const actor = useMemo(
    () => ({
      author: user.name,
      authorType: "user" as const,
      authorId: user.id,
    }),
    [user.name, user.id],
  );
  function changeStatus(id: string, status: Status) {
    const held = taskLock(taskLocks, id);
    if (held && held.owner_id !== user.id) {
      toast.danger(
        t("locks.statusLocked", {
          name: held.owner_name || t("locks.someone"),
        }),
      );
      return;
    }
    repository.commit((s) =>
      updateTask(
        s,
        id,
        { status },
        `Status changed to ${statuses[status]}`,
        actor,
      ),
    );
  }
  function switchProject(id: string) {
    setProjectId(id);
    setSelected(null);
    setSelectedEdge(null);
    setSearch("");
    setFilter("all");
    setMobileNav(false);
    setLinkMode(null);
    setLinkSource(null);
  }
  function restartFirstRun() {
    setAccountOpen(false);
    setPreferencesOpen(false);
    setMapEditorOpen(false);
    setModal(null);
    setSidebarOpen(true);
    switchProject("all");
    setView("board");
    setFirstRunStep("workspace");
  }
  useEffect(() => {
    setMobileToolsOpen(false);
  }, [view]);
  useEffect(() => {
    localStorage.setItem(sidebarWidthKey, String(sidebarWidth));
  }, [sidebarWidth]);
  function toggleLinkMode(mode: "dependency" | "subtask") {
    setSelected(null);
    setSelectedEdge(null);
    setBoardMenu(null);
    setLinkSource(null);
    setLinkMode((current) => (current === mode ? null : mode));
  }
  function pickLinkNode(nodeId: string) {
    if (!linkMode) return;
    if (!linkSource || linkSource === nodeId) {
      setLinkSource(linkSource === nodeId ? null : nodeId);
      return;
    }
    if (!canConnect(state, linkSource, nodeId)) {
      toast.warning(
        linkMode === "dependency"
          ? t("workspace.linkDuplicateOrCycle")
          : t("workspace.linkSubtaskCycle"),
      );
    } else if (linkMode === "dependency") {
      const source = linkSource;
      repository.commit((s) => ({
        ...s,
        links: [...s.links, { id: uid(), source, target: nodeId }],
      }));
    } else {
      const parentId = linkSource;
      repository.commit((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === nodeId ? { ...t, parentId } : t)),
      }));
    }
    setLinkMode(null);
    setLinkSource(null);
  }
  /* Two instances share one definition: the rail that is always mounted (the
     collapsed strip on phones, the resizable column on desktop) and the mobile
     drawer, which is always the full-width menu. */
  const renderNavigation = (variant: "rail" | "drawer") => (
    <WorkspaceSidebar
      collapsed={variant === "rail" && (isMobile || !sidebarOpen)}
      onExpand={
        variant === "rail" && isMobile ? () => setMobileNav(true) : undefined
      }
      projects={state.projects}
      workspaces={workspaces}
      activeWorkspaceId={repository.getActiveWorkspaceId()}
      projectId={projectId}
      mapName={state.map.name}
      mapOrb={state.map.orb}
      user={user}
      theme={resolvedTheme}
      invitationCount={invitationCount}
      onSignOut={onSignOut}
      onInvitations={() => {
        setMobileNav(false);
        navigate("/invitations");
      }}
      onAccountSettings={() => {
        setMobileNav(false);
        setAccountOpen(true);
      }}
      onProject={(id) => {
        setMobileNav(false);
        switchProject(id);
      }}
      onReorderProjects={(orderedIds) =>
        repository.commit((current) => reorderProjects(current, orderedIds))
      }
      onCreate={() => {
        setMobileNav(false);
        setModal({ type: "project" });
      }}
      onCreateWorkspace={() => {
        setMobileNav(false);
        setNewWorkspaceOpen(true);
      }}
      onWorkspace={(id) => {
        setMobileNav(false);
        void repository
          .switchWorkspace(id)
          .then(() => {
            // Keys are scoped by workspace, so the other workspace's frames are
            // already its own and are kept for when it is opened again. Only
            // the guard resets, so the new board frames itself.
            framedProject.current = null;
            switchProject("all");
          })
          .catch((cause) =>
            toast.danger(
              cause instanceof Error ? cause.message : String(cause),
            ),
          );
      }}
      onPreferences={() => {
        setMobileNav(false);
        setPreferencesOpen(true);
      }}
      onMapSettings={() => {
        setMobileNav(false);
        setMapEditorOpen(true);
      }}
      onToggle={() =>
        isMobile
          ? setMobileNav((open) => !open)
          : setSidebarOpen((open) => !open)
      }
      onResize={setSidebarWidth}
      onResizeStart={() => setSidebarResizing(true)}
      onResizeEnd={() => setSidebarResizing(false)}
      onThemeChange={onThemeChange}
    />
  );
  // Faces for everyone on this workspace's tasks: the signed-in account, and
  // the team the workspace was opened with. This used to be the account alone,
  // which meant every other editor on a card wore initials forever — the app
  // had met them, in the team list the settings panel reads, but had never
  // carried that anywhere the faces could see it.
  const photos = useWorkspacePhotos(activeWorkspaceId, user);
  return (
    <TaskActions.Provider value={changeStatus}>
      <PersonPhotos.Provider value={photos}>
        <div className="workspace-shell flex h-dvh overflow-hidden bg-background text-foreground">
          <div
            className={`workspace-sidebar-shell shrink-0 ${sidebarResizing ? "workspace-sidebar-shell--resizing" : ""}`}
            style={{ width: isMobile || !sidebarOpen ? 48 : sidebarWidth }}
          >
            {renderNavigation("rail")}
          </div>
          <Drawer isOpen={mobileNav} onOpenChange={setMobileNav}>
            <Drawer.Backdrop className="mobile-nav__backdrop">
              <Drawer.Content placement="left" className="mobile-nav__content">
                <Drawer.Dialog
                  aria-label="Workspace navigation"
                  className="mobile-nav__dialog"
                >
                  {renderNavigation("drawer")}
                </Drawer.Dialog>
              </Drawer.Content>
            </Drawer.Backdrop>
          </Drawer>

          {/* min-h-0 as well as min-w-0: a flex item defaults to min-height auto,
            which refuses to shrink below its content. Without it this column
            can grow past the shell's h-dvh, and because the shell clips rather
            than scrolls, whatever sits at the bottom of the canvas — the dock —
            is simply cut off instead of being reachable. */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            <header className="workspace-header flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="workspace-header__context flex min-w-0 items-center gap-3">
                <span className="hidden md:inline">
                  <Tooltip delay={350}>
                    <Tooltip.Trigger className="inline-flex">
                      <Button
                        isIconOnly
                        size="sm"
                        variant="tertiary"
                        aria-label={
                          sidebarOpen
                            ? t("workspace.closeSidebar")
                            : t("workspace.openSidebar")
                        }
                        aria-keyshortcuts={
                          usesCommandKey ? "Meta+B" : "Control+B"
                        }
                        onPress={() => setSidebarOpen((open) => !open)}
                      >
                        {sidebarOpen ? (
                          <PanelLeftClose size={18} />
                        ) : (
                          <PanelLeftOpen size={18} />
                        )}
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content placement="bottom">
                      <span className="flex items-center gap-2">
                        {sidebarOpen
                          ? t("workspace.closeSidebar")
                          : t("workspace.openSidebar")}
                        <Kbd variant="light">
                          {usesCommandKey ? (
                            <Kbd.Abbr keyValue="command" />
                          ) : (
                            <Kbd.Content>Ctrl</Kbd.Content>
                          )}
                          <Kbd.Content>B</Kbd.Content>
                        </Kbd>
                      </span>
                    </Tooltip.Content>
                  </Tooltip>
                </span>
                <FluidOrb
                  settings={project?.orb ?? state.map.orb}
                  size={32}
                  label={t("navigation.color", {
                    name: project?.name ?? state.map.name,
                  })}
                />
                <Typography.Heading
                  level={4}
                  className="workspace-header__title break-words"
                >
                  {project?.name ?? state.map.name}
                </Typography.Heading>
                {coding &&
                  (project?.repositoryUrl || state.map.repositoryUrl) && (
                    <IconButton
                      label={t("workspace.openRepository")}
                      href={project?.repositoryUrl || state.map.repositoryUrl}
                    >
                      <GitFork size={16} />
                    </IconButton>
                  )}
                {project && (
                  <IconButton
                    label={t("workspace.editProject")}
                    onPress={() =>
                      setModal({ type: "project", editId: project.id })
                    }
                  >
                    <Settings2 size={16} />
                  </IconButton>
                )}
                {!project && (
                  <IconButton
                    label={t("navigation.workspaceSettings")}
                    tour="workspace"
                    onPress={() => setMapEditorOpen(true)}
                  >
                    <Settings2 size={16} />
                  </IconButton>
                )}
              </div>
              <div className="workspace-header__actions flex items-center gap-2">
                <Tooltip delay={350}>
                  <Tooltip.Trigger className="inline-flex">
                    <Button
                      isIconOnly
                      size="sm"
                      variant="tertiary"
                      aria-label={t("workspace.openSearch")}
                      aria-keyshortcuts={
                        usesCommandKey ? "Meta+K" : "Control+Alt+K"
                      }
                      onPress={() => setGlobalSearchOpen(true)}
                    >
                      <Search size={17} />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content placement="bottom">
                    <span className="flex items-center gap-2">
                      {t("workspace.search")}
                      <Kbd variant="light">
                        {usesCommandKey ? (
                          <Kbd.Abbr keyValue="command" />
                        ) : (
                          <Kbd.Content>AltGr</Kbd.Content>
                        )}
                        <Kbd.Content>K</Kbd.Content>
                      </Kbd>
                    </span>
                  </Tooltip.Content>
                </Tooltip>
                <Tooltip delay={350}>
                  <Tooltip.Trigger className="inline-flex">
                    <Button
                      isIconOnly={isMobile}
                      size="sm"
                      variant="primary"
                      aria-label={
                        state.projects.length
                          ? t("workspace.newTask")
                          : t("navigation.newProject")
                      }
                      aria-keyshortcuts="N"
                      // The tour's task step points here only once the button
                      // actually reads "New task".
                      data-tour={state.projects.length ? "task" : undefined}
                      onPress={() =>
                        setModal({
                          type: state.projects.length ? "task" : "project",
                        })
                      }
                    >
                      <Plus size={16} />
                      {!isMobile &&
                        (state.projects.length
                          ? t("workspace.newTask")
                          : t("navigation.newProject"))}
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content placement="bottom">
                    <span className="flex items-center gap-2">
                      {state.projects.length
                        ? t("workspace.newTask")
                        : t("navigation.newProject")}
                      <Kbd variant="light">
                        <Kbd.Content>N</Kbd.Content>
                      </Kbd>
                    </span>
                  </Tooltip.Content>
                </Tooltip>
              </div>
            </header>
            <div
              className={`workspace-viewbar flex items-center gap-3 px-4 pb-3 ${discloseViewTools || isMobile ? "workspace-viewbar--disclosure" : ""}`}
            >
              <div className="workspace-viewbar__tabs" data-tour="views">
                <Tabs
                  selectedKey={view}
                  onSelectionChange={(key) => setView(String(key))}
                  variant="secondary"
                >
                  <Tabs.List aria-label={t("workspace.projectView")}>
                    <Tabs.Tab id="board" className="whitespace-nowrap">
                      {t("workspace.whiteboard")}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id="list" className="whitespace-nowrap">
                      {t("workspace.list")}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    {coding && (
                      <Tabs.Tab id="commits" className="whitespace-nowrap">
                        {t("workspace.commits")}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    )}
                  </Tabs.List>
                </Tabs>
              </div>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                className="workspace-viewbar__more"
                aria-label={
                  mobileToolsOpen
                    ? t("workspace.closeViewControls")
                    : t("workspace.openViewControls")
                }
                aria-expanded={mobileToolsOpen}
                aria-controls="workspace-view-tools"
                onPress={() => setMobileToolsOpen((open) => !open)}
              >
                <span
                  className="workspace-viewbar__more-icons"
                  aria-hidden="true"
                >
                  <MoreHorizontal
                    className="workspace-viewbar__more-icon workspace-viewbar__more-icon--open"
                    size={18}
                  />
                  <X
                    className="workspace-viewbar__more-icon workspace-viewbar__more-icon--close"
                    size={17}
                  />
                </span>
              </Button>
              <Card
                id="workspace-view-tools"
                variant="transparent"
                className={`workspace-view-tools ${mobileToolsOpen ? "workspace-view-tools--open" : ""}`}
              >
                <Card.Content
                  className={`workspace-view-tools__content workspace-view-tools__content--${view} ${projectId !== "all" ? "workspace-view-tools__content--project" : ""} ${compactViewTools ? "workspace-view-tools__content--compact" : ""}`}
                >
                  {view === "commits" && (
                    <div
                      id="workspace-commits-tools"
                      className="workspace-viewbar__commits"
                    />
                  )}
                  <>
                    <SearchField
                      aria-label={t("workspace.searchTasks")}
                      value={search}
                      onChange={setSearch}
                      className="workspace-task-search workspace-task-search--wide"
                    >
                      <SearchField.Group>
                        <SearchField.SearchIcon />
                        <SearchField.Input
                          aria-label={t("workspace.searchTasks")}
                          placeholder={t("workspace.searchTasksPlaceholder")}
                        />
                        <SearchField.ClearButton />
                      </SearchField.Group>
                    </SearchField>
                    <div
                      className="workspace-filter-status--wide"
                      data-status={filter}
                    >
                      <Choice
                        label={t("workspace.filterStatus")}
                        showLabel={false}
                        value={filter}
                        options={[
                          { id: "all", name: t("workspace.allStatuses") },
                          ...statusOptions,
                        ]}
                        renderOption={(option) =>
                          option.id === "all" ? (
                            <span className="flex min-w-0 items-center gap-2 whitespace-nowrap text-muted">
                              <Funnel size={14} />
                              {option.name}
                            </span>
                          ) : (
                            <StatusChip
                              status={option.id as Status}
                              size="sm"
                            />
                          )
                        }
                        onChange={setFilter}
                      />
                    </div>
                    <Dropdown>
                      <Dropdown.Trigger
                        className={`button button--icon-only button--sm button--tertiary workspace-filter-status__trigger ${
                          filter === "todo"
                            ? "text-accent"
                            : filter === "doing"
                              ? "text-warning"
                              : filter === "done"
                                ? "text-success"
                                : "text-muted"
                        }`}
                        aria-label={t("workspace.filterStatus")}
                      >
                        <Funnel size={16} />
                      </Dropdown.Trigger>
                      <Dropdown.Popover placement="bottom end">
                        <Dropdown.Menu
                          aria-label={t("workspace.filterStatus")}
                          selectionMode="single"
                          selectedKeys={new Set([filter])}
                          onAction={(key) => setFilter(String(key))}
                        >
                          {[
                            { id: "all", name: t("workspace.allStatuses") },
                            ...statusOptions,
                          ].map((option) => (
                            <Dropdown.Item
                              id={option.id}
                              key={option.id}
                              textValue={option.name}
                            >
                              {option.id === "all" ? (
                                option.name
                              ) : (
                                <StatusChip
                                  status={option.id as Status}
                                  size="sm"
                                />
                              )}
                              <Dropdown.ItemIndicator />
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown>
                    {view === "list" && (
                      <>
                        <div className="workspace-list-group--wide">
                          <Choice
                            label={t("workspace.groupTasks")}
                            showLabel={false}
                            value={listGroupBy}
                            onChange={setListGroupBy}
                            options={[
                              {
                                id: "status",
                                name: t("workspace.groupByStatus"),
                              },
                              {
                                id: "project",
                                name: t("workspace.groupBySolution"),
                              },
                              {
                                id: "label",
                                name: t("workspace.groupByLabel"),
                              },
                            ]}
                          />
                        </div>
                        <Dropdown>
                          <Dropdown.Trigger
                            className="button button--icon-only button--sm button--tertiary workspace-list-group__trigger"
                            aria-label={t("workspace.groupTasks")}
                          >
                            <Layers2 size={16} />
                          </Dropdown.Trigger>
                          <Dropdown.Popover placement="bottom end">
                            <Dropdown.Menu
                              aria-label={t("workspace.groupTasks")}
                              selectionMode="single"
                              selectedKeys={new Set([listGroupBy])}
                              onAction={(key) => setListGroupBy(String(key))}
                            >
                              {[
                                {
                                  id: "status",
                                  name: t("workspace.groupByStatus"),
                                },
                                {
                                  id: "project",
                                  name: t("workspace.groupBySolution"),
                                },
                                {
                                  id: "label",
                                  name: t("workspace.groupByLabel"),
                                },
                              ].map((option) => (
                                <Dropdown.Item
                                  id={option.id}
                                  key={option.id}
                                  textValue={option.name}
                                >
                                  {option.name}
                                  <Dropdown.ItemIndicator />
                                </Dropdown.Item>
                              ))}
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      </>
                    )}
                  </>
                  <div className="workspace-view-tools__actions">
                    {view === "board" && (
                      <Button
                        size="sm"
                        variant="tertiary"
                        className="workspace-compact-action workspace-view-tools__primary-action"
                        aria-label={
                          chosenTasks.length > 1
                            ? t("workspace.arrangeSelection")
                            : t("workspace.arrangeTasks")
                        }
                        aria-keyshortcuts="A"
                        onPress={arrangeBoard}
                      >
                        <LayoutTemplate size={16} />
                        <span className="workspace-compact-action__label">
                          {chosenTasks.length > 1
                            ? t("workspace.arrangeSelection")
                            : t("workspace.arrangeTasks")}
                        </span>
                        <Kbd
                          variant="light"
                          className="canvas-shortcut-key workspace-compact-action__shortcut"
                        >
                          <Kbd.Content>A</Kbd.Content>
                        </Kbd>
                      </Button>
                    )}
                    {projectId !== "all" && (
                      <Button
                        size="sm"
                        variant="tertiary"
                        className={`workspace-compact-action workspace-view-tools__secondary-action ${showRelations ? "text-accent" : "text-muted"}`}
                        aria-label={t("workspace.relatedTasks")}
                        onPress={() => setShowRelations((current) => !current)}
                      >
                        {showRelations ? (
                          <Eye size={16} />
                        ) : (
                          <EyeOff size={16} />
                        )}
                        <span className="workspace-compact-action__label">
                          {t("workspace.relatedTasks")}
                        </span>
                      </Button>
                    )}
                    <>
                      <Button
                        size="sm"
                        variant="tertiary"
                        className="workspace-compact-action workspace-view-tools__secondary-action"
                        aria-label={t("workspace.undo")}
                        onPress={repository.undo}
                        isDisabled={!repository.canUndo()}
                      >
                        <Undo2 size={16} />
                        <span className="workspace-compact-action__label">
                          {t("workspace.undo")}
                        </span>
                      </Button>
                      <Button
                        size="sm"
                        variant="tertiary"
                        className="workspace-compact-action workspace-view-tools__secondary-action"
                        aria-label={t("workspace.redo")}
                        onPress={repository.redo}
                        isDisabled={!repository.canRedo()}
                      >
                        <Redo2 size={16} />
                        <span className="workspace-compact-action__label">
                          {t("workspace.redo")}
                        </span>
                      </Button>
                    </>
                  </div>
                </Card.Content>
              </Card>
            </div>
            <div className="relative flex min-h-0 flex-1">
              <Card
                variant="secondary"
                className={`m-3 flex min-h-0 flex-1 overflow-hidden p-0 ${view === "list" ? "workspace-list-frame" : ""}`}
              >
                <Card.Content className="relative flex min-h-0 flex-1 p-0">
                  <div
                    data-testid="board-area"
                    ref={boardRef}
                    className={`workspace-board relative flex min-h-0 flex-1 ${view === "list" ? "workspace-list-canvas" : ""}`}
                    data-hover="off"
                    data-drift="on"
                  >
                    {view === "board" ? (
                      <>
                        {traceChange("board", {
                          nodes: nodes.length,
                          edges: edges.length,
                        })}
                        {boardBackground.background === "fluid" && (
                          <AsciiFluid
                            className="workspace-board__field"
                            theme={resolvedTheme}
                            cellSize={12}
                            force={0.9}
                            dissipation={0.042}
                            brush={0.6}
                          />
                        )}
                        <ReactFlow<TaskNode>
                          className="workspace-board__flow"
                          colorMode={resolvedTheme}
                          onlyRenderVisibleElements
                          proOptions={{ hideAttribution: true }}
                          nodes={nodes}
                          edges={edges}
                          nodeTypes={nodeTypes}
                          edgeTypes={edgeTypes}
                          onNodesChange={(changes) =>
                            setNodes((ns) => applyNodeChanges(changes, ns))
                          }
                          onNodeMouseEnter={(_, node) => paintHover(node.id)}
                          onNodeMouseLeave={() => paintHover(null)}
                          onNodeDragStart={() => {
                            paintHover(null);
                            holdDrift(true);
                          }}
                          onConnectStart={() => holdDrift(true)}
                          onConnectEnd={() => holdDrift(false)}
                          onMoveStart={() => holdDrift(true)}
                          onNodeDragStop={(_, __, dragged) => {
                            holdDrift(false);
                            return repository.commit((s) => ({
                              ...s,
                              tasks: s.tasks.map((t) => {
                                const n = dragged.find((n) => n.id === t.id);
                                return n
                                  ? {
                                      ...t,
                                      position: {
                                        x: n.position.x,
                                        y: n.position.y,
                                      },
                                    }
                                  : t;
                              }),
                            }));
                          }}
                          onNodesDelete={(deleted) => {
                            repository.commit((s) =>
                              deleted.reduce(
                                (current, n) => removeTask(current, n.id),
                                s,
                              ),
                            );
                            setSelected(null);
                          }}
                          onEdgesDelete={(deleted) =>
                            repository.commit((s) => ({
                              ...s,
                              links: s.links.filter(
                                (e) => !deleted.some((d) => d.id === e.id),
                              ),
                            }))
                          }
                          onNodeClick={(_, node) => {
                            if (node.data.related) return;
                            if (linkMode) {
                              pickLinkNode(node.id);
                              return;
                            }
                            setSelected(node.id);
                            setSelectedEdge(null);
                            setBoardMenu(null);
                          }}
                          onPaneClick={() => {
                            setSelected(null);
                            setSelectedEdge(null);
                            setBoardMenu(null);
                            setLinkMode(null);
                            setLinkSource(null);
                          }}
                          onNodeContextMenu={(event, node) => {
                            event.preventDefault();
                            if (!node.data.related)
                              setBoardMenu({
                                x: event.clientX,
                                y: event.clientY,
                                taskId: node.id,
                              });
                          }}
                          onPaneContextMenu={(event) => {
                            event.preventDefault();
                            setBoardMenu({
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          onEdgeClick={(_, edge) => {
                            // Subtask edges are selectable now: they were not, so
                            // there was no way to reach one and change what it is.
                            setSelectedEdge(edge.id);
                            setSelected(null);
                          }}
                          onConnect={(c) => {
                            if (canConnect(state, c.source, c.target))
                              repository.commit((s) => ({
                                ...s,
                                links: [
                                  ...s.links,
                                  {
                                    id: uid(),
                                    source: c.source,
                                    target: c.target,
                                  },
                                ],
                              }));
                          }}
                          isValidConnection={(c) =>
                            canConnect(state, c.source, c.target)
                          }
                          // Applied once, when React Flow mounts. Switching tabs
                          // unmounts it while this component stays, so the effect
                          // above never sees the remount — its guard still holds
                          // the project it framed and returns early. Restoring
                          // through the mount itself is what the guard cannot do.
                          defaultViewport={recallViewport(
                            boardViewportKey(repository.getActiveWorkspaceId()),
                          )}
                          onMoveEnd={(_, viewport) => {
                            holdDrift(false);
                            rememberViewport(
                              boardViewportKey(
                                repository.getActiveWorkspaceId(),
                              ),
                              viewport,
                            );
                          }}
                          minZoom={0.05}
                          maxZoom={1.8}
                          deleteKeyCode={["Backspace", "Delete"]}
                          selectionOnDrag={selectMode}
                          panOnDrag={selectMode ? [1, 2] : true}
                          snapToGrid
                          snapGrid={[20, 20]}
                        >
                          <CalmFaces tasks={nodes.length} />
                          <AgentBloubs
                            runners={runners}
                            locks={taskLocks}
                            roster={agentRoster(agentSettings(state))}
                            now={runnersAt}
                            onCancel={(taskId) =>
                              setStopping({ taskId, line: false })
                            }
                          />
                          {boardBackground.background === "dots" && (
                            <Background
                              size={1.75}
                              gap={20}
                              color={
                                resolvedTheme === "light"
                                  ? "#a1a1aa"
                                  : "#52525b"
                              }
                            />
                          )}
                          {workflows.length > 0 && (
                            <Panel position="top-center">
                              <WorkflowStrip
                                workflows={workflows}
                                progress={(workflowId) =>
                                  workflowProgress(state, workflowId)
                                }
                                active={workflowFilter}
                                droppable={workspaceKind(state) === "coding"}
                                onToggle={(workflowId) => {
                                  setWorkflowFilter(workflowId);
                                  setSelected(null);
                                  setSelectedEdge(null);
                                }}
                                onRename={(workflowId, name) =>
                                  changeWorkflows((current) =>
                                    saveWorkflow(current, workflowId, { name }),
                                  )
                                }
                                onRecolor={(workflowId, color) =>
                                  changeWorkflows((current) =>
                                    saveWorkflow(current, workflowId, {
                                      color,
                                    }),
                                  )
                                }
                                onAgentDrop={dropAgentOnWorkflow}
                                onDelete={(workflowId) =>
                                  changeWorkflows((current) =>
                                    deleteWorkflow(current, workflowId),
                                  )
                                }
                              />
                            </Panel>
                          )}
                          <Panel position="bottom-center">
                            <div className="canvas-bottom-dock">
                              {/* What is selected, and what can be done to
                              it. The Delete key already works and always did;
                              nothing on screen said so, and nothing said how
                              many cards it would take. It rides above the
                              canvas tools rather than over the top-left
                              corner, where it covered a card's own detail. */}
                              {chosenTasks.length > 1 && (
                                <div className="canvas-dock selection-bar">
                                  <span className="selection-bar__count">
                                    {t("workspace.selectionCount", {
                                      count: chosenTasks.length,
                                    })}
                                  </span>
                                  <span className="canvas-dock__divider" />
                                  <button onClick={arrangeBoard}>
                                    <LayoutTemplate size={14} />
                                    {t("workspace.arrangeSelection")}
                                  </button>
                                  <span className="canvas-dock__divider" />
                                  <WorkflowSelectionMenu
                                    workflows={workflows}
                                    selectedIn={(workflowId) =>
                                      chosenTasks.filter((node) =>
                                        node.data.task.workflowIds?.includes(
                                          workflowId,
                                        ),
                                      ).length
                                    }
                                    onCreate={(name) =>
                                      newWorkflow(
                                        name,
                                        chosenTasks.map((node) => node.id),
                                      )
                                    }
                                    onAdd={(workflowId) =>
                                      addToWorkflow(
                                        workflowId,
                                        chosenTasks.map((node) => node.id),
                                      )
                                    }
                                    onRemove={(workflowId) =>
                                      changeWorkflows((current) =>
                                        setWorkflowMembers(
                                          current,
                                          workflowId,
                                          chosenTasks.map((node) => node.id),
                                          false,
                                        ),
                                      )
                                    }
                                  />
                                  <span className="canvas-dock__divider" />
                                  <button
                                    onClick={() => {
                                      const ids = chosenTasks.map((n) => n.id);
                                      repository.commit((current) =>
                                        ids.reduce(
                                          (next, id) => removeTask(next, id),
                                          current,
                                        ),
                                      );
                                      setSelected(null);
                                    }}
                                    className="selection-bar__delete"
                                  >
                                    <Trash2 size={14} />
                                    {t("canvas.delete")}
                                  </button>
                                  <span className="canvas-dock__divider" />
                                  <button
                                    onClick={() =>
                                      setNodes((ns) =>
                                        ns.map((node) => ({
                                          ...node,
                                          selected: false,
                                        })),
                                      )
                                    }
                                  >
                                    {t("workspace.clearSelection")}
                                  </button>
                                </div>
                              )}
                              <div
                                className="canvas-dock workspace-canvas-tools"
                                data-tour="wire"
                              >
                                <div className="canvas-dock__icons">
                                  <button
                                    aria-label={t("canvas.zoomIn")}
                                    onClick={() => flow.zoomIn()}
                                  >
                                    <Plus size={16} />
                                  </button>
                                  <button
                                    aria-label={t("canvas.zoomOut")}
                                    onClick={() => flow.zoomOut()}
                                  >
                                    <Minus size={16} />
                                  </button>
                                  <Tooltip delay={350}>
                                    <Tooltip.Trigger className="inline-flex">
                                      <button
                                        aria-label={t("canvas.fitView")}
                                        aria-keyshortcuts="F"
                                        onClick={fitBoard}
                                      >
                                        <Maximize size={16} />
                                      </button>
                                    </Tooltip.Trigger>
                                    <Tooltip.Content placement="top">
                                      <span className="flex items-center gap-2">
                                        {t("canvas.fitView")}
                                        <Kbd variant="light">
                                          <Kbd.Content>F</Kbd.Content>
                                        </Kbd>
                                      </span>
                                    </Tooltip.Content>
                                  </Tooltip>
                                  {/* Dragging the empty board pans it; with this
                                  on, the same drag draws a selection box, so
                                  several cards can be taken without a key held. */}
                                  <Tooltip delay={350}>
                                    <Tooltip.Trigger className="inline-flex">
                                      <button
                                        aria-label={t("canvas.selectMode")}
                                        aria-pressed={selectMode}
                                        onClick={() =>
                                          setSelectMode((current) => !current)
                                        }
                                      >
                                        <SelectArea size={16} />
                                      </button>
                                    </Tooltip.Trigger>
                                    <Tooltip.Content placement="top">
                                      <span className="flex items-center gap-2">
                                        {selectMode
                                          ? t("canvas.selectModeOn")
                                          : t("canvas.selectMode")}
                                        <Kbd variant="light">
                                          <Kbd.Content>V</Kbd.Content>
                                        </Kbd>
                                      </span>
                                    </Tooltip.Content>
                                  </Tooltip>
                                  <span
                                    className="canvas-dock__divider"
                                    aria-hidden="true"
                                  />
                                  {/* The two arrow tools keep their colour, because
                                it is what tells them apart while armed. */}
                                  <button
                                    aria-label={
                                      linkMode === "dependency"
                                        ? t("canvas.cancelDependency")
                                        : t("canvas.drawDependency")
                                    }
                                    aria-pressed={linkMode === "dependency"}
                                    className="text-accent"
                                    onClick={() => toggleLinkMode("dependency")}
                                  >
                                    <ArrowRight size={16} />
                                  </button>
                                  <button
                                    aria-label={
                                      linkMode === "subtask"
                                        ? t("canvas.cancelSubtask")
                                        : t("canvas.drawSubtask")
                                    }
                                    aria-pressed={linkMode === "subtask"}
                                    className="text-success"
                                    onClick={() => toggleLinkMode("subtask")}
                                  >
                                    <GitBranch size={16} />
                                  </button>
                                  <span
                                    className="canvas-dock__divider"
                                    aria-hidden="true"
                                  />
                                  <button
                                    aria-label={t("compass.toggle")}
                                    aria-pressed={compass.open}
                                    onClick={compass.toggle}
                                  >
                                    <Info size={16} />
                                  </button>
                                  <FlowCompass open={compass.open} />
                                </div>
                                {linkMode && (
                                  <div className="link-mode-hint mt-2 whitespace-nowrap">
                                    <span
                                      className={
                                        linkMode === "dependency"
                                          ? "text-accent"
                                          : "text-success"
                                      }
                                    >
                                      {linkMode === "dependency" ? (
                                        <ArrowRight size={13} />
                                      ) : (
                                        <GitBranch size={13} />
                                      )}
                                    </span>
                                    {linkSource
                                      ? linkMode === "dependency"
                                        ? t("canvas.clickBlockedTask")
                                        : t("canvas.clickSubtask")
                                      : linkMode === "dependency"
                                        ? t("canvas.clickFirstTask")
                                        : t("canvas.clickParentTask")}
                                    <span className="link-mode-hint__esc">
                                      Esc
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </Panel>
                          {selectedEdge && selectedKind && (
                            <Panel position="top-right">
                              <div className="flex items-center gap-1.5">
                                {/* What this connection is, changeable in place:
                                the pair and the direction stay, only the kind
                                moves, so nothing has to be redrawn by hand. */}
                                {(
                                  [
                                    ["dependency", t("canvas.dependency")],
                                    ["subtask", t("canvas.subtask")],
                                  ] as const
                                ).map(([kind, label]) => (
                                  <Button
                                    key={kind}
                                    size="sm"
                                    variant={
                                      selectedKind === kind
                                        ? "primary"
                                        : "secondary"
                                    }
                                    aria-pressed={selectedKind === kind}
                                    isDisabled={selectedKind === kind}
                                    onPress={() =>
                                      repository.commit((s) =>
                                        setConnectionKind(
                                          s,
                                          selectedEdge,
                                          kind,
                                          actor,
                                        ),
                                      )
                                    }
                                  >
                                    {kind === "subtask" ? (
                                      <GitBranch size={14} />
                                    ) : (
                                      <ArrowRight size={14} />
                                    )}
                                    {label}
                                  </Button>
                                ))}
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onPress={() => {
                                    repository.commit((s) =>
                                      selectedKind === "subtask"
                                        ? {
                                            ...s,
                                            tasks: s.tasks.map((t) =>
                                              `parent-${t.id}` === selectedEdge
                                                ? { ...t, parentId: null }
                                                : t,
                                            ),
                                          }
                                        : {
                                            ...s,
                                            links: s.links.filter(
                                              (e) => e.id !== selectedEdge,
                                            ),
                                          },
                                    );
                                    setSelectedEdge(null);
                                  }}
                                >
                                  <Trash2 size={14} />
                                  {t("canvas.delete")}
                                </Button>
                              </div>
                            </Panel>
                          )}
                        </ReactFlow>
                      </>
                    ) : coding && view === "commits" ? (
                      <WorkspaceCommits
                        state={state}
                        tasks={state.tasks}
                        projectId={projectId}
                        headerSlot="workspace-commits-tools"
                        onOpenTask={setSelected}
                        onOpenWorkspaceSettings={() => setMapEditorOpen(true)}
                        onCreate={() =>
                          setModal({
                            type: state.projects.length ? "task" : "project",
                          })
                        }
                      />
                    ) : (
                      <TaskList
                        tasks={visible}
                        state={state}
                        projectId={projectId}
                        groupBy={listGroupBy}
                        onSelect={setSelected}
                        onStatus={changeStatus}
                      />
                    )}
                    {view === "board" && boardMenu && (
                      <div
                        className="workspace-context-menu"
                        role="menu"
                        style={{
                          left: Math.min(boardMenu.x, window.innerWidth - 190),
                          top: Math.min(
                            boardMenu.y,
                            window.innerHeight - (boardMenu.taskId ? 226 : 110),
                          ),
                        }}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setModal({
                              type: "task",
                              ...(boardMenu.taskId
                                ? { parentId: boardMenu.taskId }
                                : {}),
                            });
                            setBoardMenu(null);
                          }}
                        >
                          <Plus size={14} />
                          {boardMenu.taskId
                            ? t("workspace.addSubtask")
                            : t("workspace.newTask")}
                        </button>
                        {boardMenu.taskId ? (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setSelected(boardMenu.taskId!);
                                setBoardMenu(null);
                              }}
                            >
                              <Settings2 size={14} />
                              {t("workspace.openTaskDetails")}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                const origin = state.tasks.find(
                                  (item) => item.id === boardMenu.taskId,
                                );
                                if (origin)
                                  newWorkflow(
                                    freeWorkflowName(state, origin.name),
                                    connectedTasks(state, origin.id),
                                  );
                                setBoardMenu(null);
                              }}
                            >
                              <GitBranch size={14} />
                              {t("workflows.newFromConnected")}
                            </button>
                            {taskLock(taskLocks, boardMenu.taskId) ? (
                              canUnlockTask(
                                taskLock(taskLocks, boardMenu.taskId),
                                user.id ?? "",
                                workspaceOwner,
                              ) && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setStopping({
                                      taskId: boardMenu.taskId!,
                                      line: false,
                                    });
                                    setBoardMenu(null);
                                  }}
                                >
                                  <Unlock size={14} />
                                  {t("locks.unlock")}
                                </button>
                              )
                            ) : (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={!canLock}
                                onClick={() => {
                                  void lock(boardMenu.taskId!);
                                  setBoardMenu(null);
                                }}
                              >
                                <Lock size={14} />
                                <span className="workspace-context-menu__stack">
                                  {t("locks.lock")}
                                  {lockHint && (
                                    <span className="workspace-context-menu__hint">
                                      {lockHint}
                                    </span>
                                  )}
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              role="menuitem"
                              className="workspace-context-menu__danger"
                              disabled={!!taskLock(taskLocks, boardMenu.taskId)}
                              onClick={() => {
                                repository.commit((current) =>
                                  removeTask(current, boardMenu.taskId!),
                                );
                                setSelected(null);
                                setBoardMenu(null);
                              }}
                            >
                              <Trash2 size={14} />
                              {t("workspace.deleteTask")}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              arrangeBoard();
                              setBoardMenu(null);
                            }}
                          >
                            <LayoutTemplate size={14} />
                            {t("workspace.arrangeTasks")}
                          </button>
                        )}
                      </div>
                    )}
                    {!visible.length && view !== "commits" && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="pointer-events-auto flex flex-col items-center gap-4">
                          <Typography color="muted">
                            {search || filter !== "all" || workflowFilter
                              ? t("workspace.noMatchingTasks")
                              : state.projects.length
                                ? t("workspace.noTasks")
                                : t("workspace.firstProject")}
                          </Typography>
                          <Button
                            variant={
                              search || filter !== "all" || workflowFilter
                                ? "secondary"
                                : "primary"
                            }
                            onPress={() => {
                              if (
                                search ||
                                filter !== "all" ||
                                workflowFilter
                              ) {
                                setSearch("");
                                setFilter("all");
                                setWorkflowFilter(null);
                              } else
                                setModal({
                                  type: state.projects.length
                                    ? "task"
                                    : "project",
                                });
                            }}
                          >
                            {search || filter !== "all" || workflowFilter
                              ? t("workspace.clearFilters")
                              : state.projects.length
                                ? t("workspace.newTask")
                                : t("workspace.createProject")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </Card.Content>
              </Card>
              {task && (
                <TaskInspector
                  key={task.id}
                  task={task}
                  onClose={() => setSelected(null)}
                  onAddSubtask={() =>
                    setModal({ type: "task", parentId: task.id })
                  }
                  onSelect={setSelected}
                  onStatus={changeStatus}
                  activityAuthor={actor}
                  lock={taskLock(taskLocks, task.id)}
                  canLock={canLock}
                  lockHint={lockHint}
                  canUnlock={canUnlockTask(
                    taskLock(taskLocks, task.id),
                    user.id ?? "",
                    workspaceOwner,
                  )}
                  line={lineTasks(state, task.id)}
                  onLock={(line) => void lock(task.id, "", line)}
                  onUnlock={(line) => setStopping({ taskId: task.id, line })}
                  onSendBack={(taskId, agent) => void lock(taskId, agent)}
                  onOpenCommits={() => {
                    if (!coding) return;
                    setSelected(null);
                    setView("commits");
                  }}
                  onOpenWorkspaceSettings={() => {
                    setSelected(null);
                    setMapEditorOpen(true);
                  }}
                />
              )}
            </div>
          </main>
          {modal && (
            <EditorModal
              mode={modal}
              projectId={projectId}
              author={actor}
              onClose={() => setModal(null)}
              onCreated={(id, type) => {
                setModal(null);
                setMobileNav(false);
                if (type === "project") {
                  switchProject(id);
                  completeFirstRunStep("project", {
                    ...firstRunContext,
                    hasProject: true,
                  });
                } else {
                  setSelected(id);
                  setSearch("");
                  setFilter("all");
                  setWorkflowFilter(null);
                  completeFirstRunStep("task");
                  const t = repository.get().tasks.find((t) => t.id === id);
                  if (
                    t &&
                    projectId !== "all" &&
                    !t.projectIds.includes(projectId)
                  )
                    setProjectId(t.projectIds[0]);
                }
              }}
            />
          )}
          {labelsOpen && <LabelManager onClose={() => setLabelsOpen(false)} />}
          {mapEditorOpen && (
            <MapEditor
              githubNotice={githubNotice}
              onClose={() => setMapEditorOpen(false)}
              onCreateProject={() => {
                setMapEditorOpen(false);
                completeFirstRunStep("workspace");
                setModal({ type: "project" });
              }}
              onEditProject={(id) => {
                setMapEditorOpen(false);
                setModal({ type: "project", editId: id });
              }}
              onEditLabels={() => setLabelsOpen(true)}
              onSaved={() => {
                completeFirstRunStep("workspace");
              }}
            />
          )}
          {newWorkspaceOpen && (
            <NewWorkspaceDialog
              onClose={() => {
                setNewWorkspaceOpen(false);
                switchProject("all");
              }}
            />
          )}
          {globalSearchOpen && (
            <GlobalSearch
              state={state}
              projects={effectiveProjects}
              onClose={() => setGlobalSearchOpen(false)}
              onTask={(found) => {
                setView("board");
                switchProject("all");
                setSelected(found.id);
              }}
            />
          )}
          {accountOpen && (
            <AccountSettings
              onClose={() => setAccountOpen(false)}
              onSignOut={onSignOut}
            />
          )}
          {preferencesOpen && (
            <PreferencesDialog
              onClose={() => setPreferencesOpen(false)}
              theme={resolvedTheme}
              onThemeChange={onThemeChange}
              boardBackground={boardBackground.background}
              onBoardBackgroundChange={boardBackground.setBackground}
              cardDrift={cardDrift.drift}
              onCardDriftChange={cardDrift.setDrift}
              onRestartTour={restartFirstRun}
            />
          )}
          {!!stopping && (
            <Dialog
              title={t("locks.stopTitle")}
              onClose={() => setStopping(null)}
            >
              <Modal.Body className="flex flex-col gap-2">
                <Typography type="body-sm" className="text-pretty">
                  {stopping.line && stoppingTargets.length > 1
                    ? t("locks.stopLineBody", {
                        count: stoppingTargets.length,
                      })
                    : t("locks.stopBody")}
                </Typography>
                {!!stoppingOthers && (
                  <Typography
                    type="body-sm"
                    className="text-pretty text-warning"
                  >
                    {t("locks.stopSomeoneElse", { name: stoppingOthers })}
                  </Typography>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={() => setStopping(null)}>
                  {t("locks.stopKeep")}
                </Button>
                <Button
                  variant="danger"
                  onPress={() => {
                    void unlock(stopping.taskId, stopping.line);
                    setStopping(null);
                  }}
                >
                  {t("locks.stopConfirm")}
                </Button>
              </Modal.Footer>
            </Dialog>
          )}
          <CrewPill
            runners={runners}
            locks={taskLocks}
            now={runnersAt}
            userId={user.id ?? ""}
            onOpenCrew={setRunnersOpen}
            onOpenTask={(taskId) => {
              setWorkflowFilter(null);
              setSelected(taskId);
            }}
          />
          {!!runnersOpen && (
            <CrewWindow
              runners={runners}
              now={runnersAt}
              workspaceId={repository.getActiveWorkspaceId()}
              userId={user.id ?? ""}
              workspaceOwner={workspaceOwner}
              section={runnersOpen}
              error={runnersError}
              onClose={() => setRunnersOpen(null)}
              onRefresh={reloadRunners}
              onOpenTask={(taskId) => {
                setRunnersOpen(null);
                setWorkflowFilter(null);
                setSelected(taskId);
              }}
            />
          )}
          {invitationsOpen && (
            <WorkspaceInvitations
              onClose={() => navigate("/app", { replace: true })}
            />
          )}
          {firstRunStep && (
            <FirstRunCoachMark
              step={firstRunStep}
              context={firstRunContext}
              placement={firstRunPlacements[firstRunStep]}
              onNext={advanceFirstRun}
              onEnd={finishFirstRun}
            />
          )}
        </div>
      </PersonPhotos.Provider>
    </TaskActions.Provider>
  );
}
