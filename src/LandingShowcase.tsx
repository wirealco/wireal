import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  type ComponentType,
  type Key,
  type ReactNode,
} from "react";
import { Card, Switch, Tabs, Tooltip, Typography } from "@heroui/react";
import { useTranslation } from "react-i18next";
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { AsciiFluid } from "./AsciiFluid";
import type { BoardBackground } from "./board-background";
import {
  Circle,
  CircleCheck,
  Display,
  GitBranch,
  GitCommitHorizontal,
  LayoutTemplate,
  List,
  Lock,
  Person,
  Undo2,
} from "./icons";
import { FluidOrb } from "./FluidOrb";
import { LabelBadge, ProjectBadge, StatusChip, TaskId } from "./ui";
import { TaskList } from "./TaskList";
import { TaskPeople } from "./TaskPeople";
import { taskPeople } from "./task-people";
import { WorkspaceTeamSettings } from "./WorkspaceTeamDialog";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { RunnerCard } from "./CrewWindow";
import { runnerMembers } from "./CrewParts";
import { openReview, type Project, type Task, type Workspace } from "./domain";
import { taskLock, type Runner, type TaskLock } from "./runners";
import {
  demoLabels,
  demoLocks,
  demoRoster,
  demoRunners,
  demoTeam,
  demoUser,
  demoWorkspace,
  demoWorkspaceId,
  demoWorkspaces,
  type ShowcaseCopy,
} from "./landing-demo";
import type { ResolvedTheme } from "./theme";
import "./landing-showcase.css";

type TabId = "board" | "agents" | "list" | "team";

const tabs: {
  id: TabId;
  labelKey: string;
  Icon: ComponentType<{ size?: number }>;
}[] = [
  { id: "board", labelKey: "workspace.whiteboard", Icon: LayoutTemplate },
  { id: "agents", labelKey: "agents.title", Icon: Display },
  { id: "list", labelKey: "workspace.list", Icon: List },
  { id: "team", labelKey: "team.members", Icon: Person },
];

const ADVANCE_MS = 7000;
const FLIP_MS = 3500;
const HOLD_MS = 20000;

type Mark = { left: number; width: number; markLeft: number };

function PauseGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4" y="3" width="2.75" height="10" rx="1" fill="currentColor" />
      <rect
        x="9.25"
        y="3"
        width="2.75"
        height="10"
        rx="1"
        fill="currentColor"
      />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5.2 3.4a.9.9 0 0 1 1.37-.77l6.4 4.6a.9.9 0 0 1 0 1.54l-6.4 4.6A.9.9 0 0 1 5.2 12.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** The visitor's motion setting, watched rather than read once, so turning it
 *  on stops the carousel without a reload. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/** Whether the page is being looked at, so the carousel and the ring that
 *  counts it down can both stand still in a background tab. */
function usePageVisible() {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  useEffect(() => {
    const sync = () => setVisible(!document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return visible;
}

/* ---- Whiteboard ---------------------------------------------------------- */

type ShowcaseNode = Node<
  {
    task: Task;
    projects: Project[];
    children: Task[];
    lock: TaskLock | null;
  },
  "task"
>;

/** The board's card. Same markup and same class names as the whiteboard's own
 *  node — it is copied rather than imported because the app composes it inside
 *  App.tsx, against a repository this page has none of — minus the two controls
 *  a reader cannot use: the subtask toggle and the status menu stay as the
 *  marks they are. */
function ShowcaseTaskCard({ data }: NodeProps<ShowcaseNode>) {
  const { t } = useTranslation();
  const { task, projects, children, lock } = data;
  const review = openReview(task);
  const people = taskPeople(task);
  return (
    <Card
      data-testid="task-node"
      data-status={task.status}
      data-review={review ? "open" : undefined}
      variant="secondary"
      className="task-card w-72"
    >
      <Handle
        id="left"
        type="target"
        position={Position.Left}
        className="task-handle task-handle--target"
      />
      <Card.Header>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Tooltip delay={250}>
              <Tooltip.Trigger className="inline-flex shrink-0">
                <div className="flex items-center gap-1">
                  {projects.map((project) => (
                    <FluidOrb
                      key={project.id}
                      settings={project.orb}
                      size={30}
                      label={`${project.name} project`}
                    />
                  ))}
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
            {task.labels.map((label) => (
              <LabelBadge key={label} name={label} />
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
                {children.filter((child) => child.status === "done").length}/
                {children.length}
              </span>
            </div>
            {children.map((child) => (
              <span
                className="subtask-row"
                data-status={child.status}
                key={child.id}
              >
                <span className="subtask-row__icon">
                  {child.status === "done" ? (
                    <CircleCheck size={14} />
                  ) : (
                    <Circle size={14} />
                  )}
                </span>
                <span className="subtask-row__name">{child.name}</span>
              </span>
            ))}
          </div>
        </Card.Content>
      )}
      <Card.Footer className="flex-wrap gap-x-2 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusChip status={task.status} />
          {!!task.commitUrls.length && (
            <a
              className="activity-commit activity-commit--node"
              href={task.commitUrls[0]}
              target="_blank"
              rel="noreferrer"
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
            <span
              className="node-tag node-tag--lock"
              title={t("locks.lockedBy", { name: lock.owner_name })}
            >
              <Lock size={12} />
              <span className="node-tag__label">{lock.owner_name}</span>
            </span>
          )}
          {task.parentId && (
            <span className="node-tag">
              <GitBranch size={12} />
              {t("canvas.subtask")}
            </span>
          )}
        </div>
        <TaskPeople people={people} label align="end" />
      </Card.Footer>
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className="task-handle task-handle--source"
      />
    </Card>
  );
}

/** The board's connection: the same rounded path, the same arrow, and the same
 *  chip for a label as the whiteboard draws. */
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
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
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

const nodeTypes = { task: ShowcaseTaskCard };
const edgeTypes = { labelled: LabelledEdge };

function BoardPanel({
  background,
  state,
  locks,
  theme,
}: {
  background: BoardBackground;
  state: Workspace;
  locks: TaskLock[];
  theme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const nodes: ShowcaseNode[] = state.tasks.map((task) => ({
    id: task.id,
    type: "task",
    position: task.position,
    data: {
      task,
      projects: state.projects.filter((project) =>
        task.projectIds.includes(project.id),
      ),
      children: state.tasks.filter((child) => child.parentId === task.id),
      lock: taskLock(locks, task.id),
    },
  }));
  const shares = (a: string, b: string) => {
    const source = state.tasks.find((task) => task.id === a);
    const target = state.tasks.find((task) => task.id === b);
    return !!source?.projectIds.some((id) => target?.projectIds.includes(id));
  };
  const edges: Edge[] = [
    ...state.links.map((link) => ({
      ...link,
      sourceHandle: "right",
      targetHandle: "left",
      className: "canvas-wire dependency-edge",
      type: "labelled",
      label: shares(link.source, link.target)
        ? undefined
        : t("canvas.crossProject"),
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent)" },
    })),
    ...state.tasks
      .filter((task) => task.parentId)
      .map((task) => ({
        id: `parent-${task.id}`,
        source: task.parentId!,
        target: task.id,
        sourceHandle: "right",
        targetHandle: "left",
        label: t("canvas.subtask"),
        type: "labelled",
        className: "canvas-wire subtask-edge",
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--success)" },
      })),
  ];
  return (
    <div className="showcase-board workspace-board">
      {background === "fluid" && (
        <AsciiFluid
          className="workspace-board__field"
          theme={theme}
          cellSize={12}
          force={0.9}
          dissipation={0.028}
          brush={0.6}
        />
      )}
      <ReactFlowProvider>
        <ReactFlow<ShowcaseNode>
          className="workspace-board__flow"
          colorMode={theme}
          proOptions={{ hideAttribution: true }}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          fitView
          fitViewOptions={{ padding: 0.06 }}
          /* React Flow will not zoom below minZoom to fit, and its default
             stops at half size — which cropped the plan on a phone rather than
             showing all of it. */
          minZoom={0.12}
        >
          {background === "dots" && (
            <Background
              size={1.75}
              color={theme === "light" ? "#a1a1aa" : "#52525b"}
            />
          )}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

/* ---- The workspace chrome ------------------------------------------------ */

/** Nothing inside the frame goes anywhere, so every handler the sidebar asks
 *  for is the same handler. */
const noop = () => {};

/** The app's own sidebar, standing beside the panels so the frame reads as the
 *  whole product rather than as one view of it. It keeps its place across the
 *  tabs — choosing a tab changes what is next to it, not whether it is there —
 *  and the demo workspace is the same one the panels run on, so the projects
 *  listed here are the projects on the board. */
function ShowcaseSidebar({
  state,
  theme,
}: {
  state: Workspace;
  theme: ResolvedTheme;
}) {
  const workspaces = useMemo(() => demoWorkspaces(state), [state]);
  return (
    <div className="showcase__sidebar" inert>
      <WorkspaceSidebar
        collapsed={false}
        projects={state.projects}
        workspaces={workspaces}
        activeWorkspaceId={demoWorkspaceId}
        projectId="all"
        mapName={state.map.name}
        mapOrb={state.map.orb}
        user={demoUser}
        theme={theme}
        onProject={noop}
        onReorderProjects={noop}
        onCreate={noop}
        onCreateWorkspace={noop}
        onWorkspace={noop}
        onPreferences={noop}
        onMapSettings={noop}
        onToggle={noop}
        onResize={noop}
        onResizeStart={noop}
        onResizeEnd={noop}
        onThemeChange={noop}
      />
    </div>
  );
}

/* ---- Runners ------------------------------------------------------------- */

/** The crew window, at the width it opens on: a card per machine with its
 *  agents inside and each CLI's usage in the corner. The cards are the
 *  window's own; only the workspace they read is handed in. */
function RunnersPanel({
  state,
  runners,
  now,
}: {
  state: Workspace;
  runners: Runner[];
  now: number;
}) {
  // The demo roster is written by hand, so each agent is tied to the runner
  // that seats it here; otherwise the cards would read them as left over.
  const roster = demoRoster.map((spec) => ({
    ...spec,
    runner: runners.find((runner) =>
      runner.seats.some((seat) => seat.agent_id === spec.id),
    )?.runner_id,
  }));
  const context = {
    roster,
    runners,
    tasks: state.tasks,
    workspaceId: demoWorkspaceId,
    now,
  };
  return (
    <div className="showcase-runners">
      {runners.map((runner, index) => (
        <RunnerCard
          key={runner.runner_id}
          runner={runner}
          members={runnerMembers(runner, context)}
          now={now}
          mine={runner.owner_id === demoUser.id}
          workspaceOwner
          branch=""
          request={null}
          forgetting={false}
          index={index}
          onTest={noop}
          onForget={noop}
        />
      ))}
    </div>
  );
}

/* ---- The showcase -------------------------------------------------------- */

/** Which panel is on show, so a surface can tell whether it is being looked at.
 *  Only the chosen one is mounted, which also keeps every surface from running
 *  at once. */
const Showing = createContext<TabId>("board");

function Panel({ id, children }: { id: TabId; children: ReactNode }) {
  const showing = useContext(Showing);
  if (showing !== id) return null;
  return children;
}

export function LandingShowcase(props: { theme: ResolvedTheme }) {
  const { t } = useTranslation();
  const copy: ShowcaseCopy = useMemo(
    () => (key: string) => t(`landing.showcase.${key}`),
    [t],
  );
  const [selected, setSelected] = useState<TabId>("board");
  const [auto, setAuto] = useState(true);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const state = useMemo(() => demoWorkspace(copy), [copy]);
  /* One clock for the whole frame, taken when it mounts. A runner is connected
     while its heartbeat is recent, and the demo's heartbeats are stamped with
     this same moment, so the fleet never falls offline under a page left
     open — and nothing here re-renders on a timer. */
  const now = useMemo(() => Date.now(), []);
  const runners = useMemo(() => demoRunners(now), [now]);
  const locks = useMemo(() => demoLocks(now), [now]);
  const [background, setBackground] = useState<BoardBackground>("fluid");
  const backgroundHoldUntil = useRef(0);

  const running = auto && !reduced && visible;

  const [turn, setTurn] = useState(0);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setSelected((current) => {
        const next = tabs.findIndex((tab) => tab.id === current) + 1;
        return tabs[next % tabs.length].id;
      });
      setTurn((count) => count + 1);
    }, ADVANCE_MS);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running || selected !== "board") return;
    const timer = setInterval(() => {
      if (Date.now() < backgroundHoldUntil.current) return;
      setBackground((current) => (current === "fluid" ? "dots" : "fluid"));
    }, FLIP_MS);
    return () => clearInterval(timer);
  }, [running, selected]);

  const changeBackground = (selected: boolean) => {
    backgroundHoldUntil.current = Date.now() + HOLD_MS;
    setBackground(selected ? "fluid" : "dots");
  };

  const headerRef = useRef<HTMLDivElement>(null);
  const switchRef = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<Mark | null>(null);

  const measure = useCallback(() => {
    const strip = switchRef.current;
    const header = headerRef.current;
    if (!strip || !header) return;
    const tab = strip.querySelector<HTMLElement>('[role="tab"][data-selected]');
    if (!tab) return;
    const box = tab.getBoundingClientRect();
    if (!box.width) return;
    const stripBox = strip.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    setMark((current) => {
      const next: Mark = {
        left: box.left - stripBox.left - strip.clientLeft,
        width: box.width,
        markLeft: box.left - headerBox.left - header.clientLeft,
      };
      if (
        current &&
        current.left === next.left &&
        current.width === next.width &&
        current.markLeft === next.markLeft
      ) {
        return current;
      }
      return next;
    });
  }, []);

  useLayoutEffect(measure, [measure, selected, t]);

  useEffect(() => {
    const strip = switchRef.current;
    if (!strip) return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    for (const tab of strip.querySelectorAll('[role="tab"]')) {
      observer.observe(tab);
    }
    const scroller = strip.querySelector('[data-slot="scroll-shadow"]');
    scroller?.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      scroller?.removeEventListener("scroll", measure);
    };
  }, [measure]);

  // Once the visitor has chosen, the carousel is over: moving the frame out
  // from under someone reading it is worse than never moving at all.
  const stop = () => setAuto(false);
  const choose = (key: Key) => {
    stop();
    setSelected(key as TabId);
  };

  const board = (
    <BoardPanel
      background={background}
      state={state}
      locks={locks}
      theme={props.theme}
    />
  );

  /* A window opens over the workspace rather than instead of it, so the two
     that are windows in the product are drawn that way here: the board behind
     the glass is the board, not a picture of one. */
  const sheet = (width: "runners" | "team", children: ReactNode) => (
    <div className="showcase-sheet">
      <div className="showcase-sheet__behind" aria-hidden="true">
        {board}
      </div>
      <div className="showcase-sheet__scrim" aria-hidden="true" />
      <div className="showcase-sheet__panel" data-width={width}>
        {children}
      </div>
    </div>
  );

  const panels: Record<TabId, ReactNode> = {
    board,
    agents: sheet(
      "runners",
      <RunnersPanel state={state} runners={runners} now={now} />,
    ),
    list: (
      <div className="showcase-list">
        <TaskList
          tasks={state.tasks}
          state={state}
          projectId="all"
          groupBy="status"
          onSelect={() => {}}
          onStatus={() => {}}
        />
      </div>
    ),
    team: sheet(
      "team",
      <WorkspaceTeamSettings
        workspaceId={demoWorkspaceId}
        onClose={() => {}}
        fixedTeam={demoTeam}
      />,
    ),
  };

  return (
    <section
      className="showcase"
      data-showcase-theme={props.theme}
      data-auto={auto ? "on" : "off"}
    >
      {/* A label badge reads its colour out of the signed-in workspace's
          labels, and there is no signed-in workspace here. The demo colours are
          restated from the one place they are written down, keyed by the name
          the badge already carries as its title, so the real badge wears the
          real colour on the board and in the list alike. */}
      <style>
        {demoLabels
          .map(
            (label) =>
              `.showcase__surface .label-badge[title="${label.name}"]{--label-color:${label.color} !important}`,
          )
          .join("")}
      </style>
      <Tabs
        className="showcase__tabs"
        selectedKey={selected}
        onSelectionChange={choose}
      >
        <div className="showcase__shell">
          <div className="showcase__header" ref={headerRef}>
            <span className="showcase__dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <div
              className="showcase__switch"
              ref={switchRef}
              onFocusCapture={stop}
              onPointerDown={stop}
            >
              <span
                aria-hidden="true"
                className="showcase__pill"
                data-ready={mark ? "true" : "false"}
                style={{ left: mark?.left ?? 0, width: mark?.width ?? 0 }}
              />
              <Tabs.ListContainer>
                <Tabs.List
                  aria-label={copy("tablistLabel")}
                  className="showcase__list"
                >
                  {tabs.map((tab) => (
                    <Tabs.Tab
                      className="showcase__tab"
                      id={tab.id}
                      key={tab.id}
                    >
                      <tab.Icon size={18} />
                      <span className="showcase__tab-label">
                        {t(tab.labelKey)}
                      </span>
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>
            </div>
            {running && mark && (
              <span
                aria-hidden="true"
                className="showcase__timer"
                key={turn}
                style={{ left: mark.markLeft, width: mark.width }}
              >
                <span
                  className="showcase__timer-fill"
                  style={{ animationDuration: `${ADVANCE_MS}ms` }}
                />
              </span>
            )}
            <button
              type="button"
              className="showcase__toggle"
              aria-label={copy(auto ? "pause" : "resume")}
              onClick={() => setAuto((on) => !on)}
            >
              {auto ? <PauseGlyph /> : <PlayGlyph />}
            </button>
          </div>
          <div className="showcase__frame">
            <ShowcaseSidebar state={state} theme={props.theme} />
            <div className="showcase__stage">
              <Showing value={selected}>
                {tabs.map((tab) => (
                  <Tabs.Panel
                    className="showcase__panel"
                    id={tab.id}
                    key={tab.id}
                  >
                    {/* The product, not a picture of it — and out of reach.
                        `inert` takes the whole subtree out of the tab order and
                        off the accessibility tree; pointer-events finishes the
                        job for a mouse. */}
                    <div className="showcase__surface" inert>
                      <Panel id={tab.id}>{panels[tab.id]}</Panel>
                    </div>
                  </Tabs.Panel>
                ))}
              </Showing>
              {selected === "board" && (
                <label className="showcase__background">
                  <Switch
                    size="sm"
                    isSelected={background === "fluid"}
                    onChange={changeBackground}
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch.Content>
                  </Switch>
                  {copy("fluidBackground")}
                </label>
              )}
            </div>
          </div>
        </div>
      </Tabs>
    </section>
  );
}
