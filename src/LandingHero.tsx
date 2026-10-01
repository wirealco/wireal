import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Card, Typography } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Position, getSmoothStepPath } from "@xyflow/react";
import { ActivityBloub } from "./ActivityBloub";
import { FluidOrb } from "./FluidOrb";
import { GitBranch, GitCommitHorizontal } from "./icons";
import { LabelBadge, StatusChip, TaskId } from "./ui";
import { demoLabels, demoWorkspace, type ShowcaseCopy } from "./landing-demo";
import { lineBranch } from "./runners";
import type { Project, Status, Task } from "./domain";
import "./landing-hero.css";

type Side = "left" | "right";

type Placement = {
  id: string;
  side: Side;
  row: 0 | 1 | 2;
  shift: number;
  seed: Status;
  commit: string;
};

const placements: Placement[] = [
  {
    id: "task-tax",
    side: "left",
    row: 0,
    shift: 0,
    seed: "done",
    commit: "9f3c1ae",
  },
  {
    id: "task-images",
    side: "left",
    row: 1,
    shift: 30,
    seed: "done",
    commit: "41bd80c",
  },
  {
    id: "task-tokens",
    side: "left",
    row: 2,
    shift: 0,
    seed: "done",
    commit: "b72e4d1",
  },
  {
    id: "task-refund",
    side: "right",
    row: 0,
    shift: 34,
    seed: "todo",
    commit: "5c1af09",
  },
  {
    id: "task-guest",
    side: "right",
    row: 1,
    shift: 0,
    seed: "todo",
    commit: "e08b3d6",
  },
  {
    id: "task-chip",
    side: "right",
    row: 2,
    shift: 34,
    seed: "todo",
    commit: "7a4fd22",
  },
];

const rowY: Record<Side, [string, string, string]> = {
  left: ["3%", "38%", "3%"],
  right: ["10%", "45%", "7%"],
};

const PHONE_ROW = 364;
const TRAVEL_MS = 1200;
const STEP_MS = 3500;
const SETTLE_MS = 2000;
const IDLE_MS = 4000;
const PARALLAX = { left: 4, right: 6 } as const;

type Box = { x: number; y: number; w: number; h: number };

type Wire = {
  id: string;
  source: string;
  target: string;
  cross: boolean;
};

type Geometry = {
  d: string;
  labelX: number;
  labelY: number;
};

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

function useOnScreen(target: React.RefObject<HTMLElement | null>) {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const node = target.current;
    if (!node || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(!!entry?.isIntersecting),
      { rootMargin: "80px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [target]);
  return onScreen;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function HeroTaskCard({
  task,
  projects,
  status,
  commit,
}: {
  task: Task;
  projects: Project[];
  status: Status;
  commit: string | null;
}) {
  return (
    <Card
      data-status={status}
      variant="secondary"
      className="task-card w-72"
      inert
    >
      <Card.Header>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex shrink-0 items-center gap-1">
              {projects.map((project) => (
                <FluidOrb
                  key={project.id}
                  settings={project.orb}
                  size={30}
                  label={`${project.name} project`}
                />
              ))}
            </div>
            <div className="min-w-0">
              <Card.Title className="break-words">{task.name}</Card.Title>
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
      <Card.Footer className="flex-wrap gap-x-2 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusChip status={status} />
          {/* What the agent leaves behind, in the order it leaves it: a branch
              of its own while it is on the task, the commit it merged once it
              is off. */}
          {status === "doing" && (
            <span className="node-tag landing-hero__branch">
              <GitBranch size={12} />
              {lineBranch(task)}
            </span>
          )}
          {status === "done" && commit && (
            <a
              className="activity-commit activity-commit--node landing-hero__commit"
              href="#"
              tabIndex={-1}
              aria-hidden="true"
            >
              <GitCommitHorizontal size={12} />
              {commit}
            </a>
          )}
        </div>
      </Card.Footer>
    </Card>
  );
}

export function LandingHero({
  panel,
}: {
  panel: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const copy: ShowcaseCopy = useMemo(
    () => (key: string) => t(`landing.showcase.${key}`),
    [t],
  );
  const state = useMemo(() => demoWorkspace(copy), [copy]);

  const phone = useMediaQuery("(max-width: 719px)");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const visible = usePageVisible();
  const onScreen = useOnScreen(panel);

  const [narrow, setNarrow] = useState(false);
  const shown = useMemo(() => {
    if (!phone) return placements;
    const pair = [placements[0]!, placements[3]!];
    return narrow ? pair.slice(0, 1) : pair;
  }, [phone, narrow]);

  const cards = useMemo(
    () =>
      shown
        .map((place) => {
          const task = state.tasks.find((item) => item.id === place.id);
          if (!task) return null;
          return {
            place,
            task,
            projects: state.projects.filter((project) =>
              task.projectIds.includes(project.id),
            ),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => !!entry),
    [shown, state],
  );

  const wires: Wire[] = useMemo(() => {
    const ids = new Set(cards.map((card) => card.task.id));
    const projectOf = (id: string) =>
      state.tasks.find((task) => task.id === id)?.projectIds ?? [];
    return state.links
      .filter((link) => ids.has(link.source) && ids.has(link.target))
      .map((link) => ({
        id: link.id,
        source: link.source,
        target: link.target,
        cross: !projectOf(link.source).some((id) =>
          projectOf(link.target).includes(id),
        ),
      }));
  }, [cards, state]);

  const seed = useMemo(() => {
    const base: Record<string, Status> = {};
    for (const place of placements) base[place.id] = place.seed;
    return base;
  }, []);
  const [statuses, setStatuses] = useState(seed);

  const sceneRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const liftRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const wireRefs = useRef<Record<string, SVGGElement | null>>({});
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});
  const rects = useRef<Record<string, Box>>({});
  const drift = useRef<Record<Side, { x: number; y: number }>>({
    left: { x: 0, y: 0 },
    right: { x: 0, y: 0 },
  });

  const [geometry, setGeometry] = useState<Record<string, Geometry>>({});

  const measure = useCallback(() => {
    const host = panel.current;
    if (!host) return;
    const frame = host.getBoundingClientRect();
    if (!frame.width) return;
    setNarrow(frame.width < PHONE_ROW);
    const boxes: Record<string, Box> = {};
    for (const card of cards) {
      const node = liftRefs.current[card.task.id];
      if (!node) continue;
      const box = node.getBoundingClientRect();
      const shift = drift.current[card.place.side];
      boxes[card.task.id] = {
        x: box.left - frame.left - shift.x,
        y: box.top - frame.top - shift.y,
        w: box.width,
        h: box.height,
      };
    }
    rects.current = boxes;
    const next: Record<string, Geometry> = {};
    for (const wire of wires) {
      const from = boxes[wire.source];
      const to = boxes[wire.target];
      if (!from || !to) continue;
      const [d, labelX, labelY] = getSmoothStepPath({
        sourceX: from.x + from.w,
        sourceY: from.y + from.h / 2,
        targetX: to.x,
        targetY: to.y + to.h / 2,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        borderRadius: 16,
      });
      next[wire.id] = { d, labelX, labelY };
    }
    setGeometry(next);
  }, [cards, panel, wires]);

  useLayoutEffect(() => {
    measure();
  }, [measure, statuses, t]);

  useEffect(() => {
    const host = panel.current;
    if (!host) return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [measure, panel]);

  useEffect(() => {
    const nodes = Object.values(pathRefs.current).filter(Boolean);
    for (const node of nodes) {
      if (!node) continue;
      const length = node.getTotalLength();
      if (length) node.style.setProperty("--hero-wire-length", `${length}`);
    }
  }, [geometry, reduced]);

  const [idle, setIdle] = useState(true);
  const running = onScreen && visible && idle && !reduced;

  useEffect(() => {
    const host = panel.current;
    if (!host || phone || reduced) return;
    let raf = 0;
    let idleTimer = 0;
    let pointer: { x: number; y: number } | null = null;
    let hovered: string | null = null;

    const apply = (next: string | null) => {
      if (next === hovered) return;
      hovered = next;
      const scene = sceneRef.current;
      if (scene) scene.dataset.hover = next ? "on" : "off";
      for (const [id, node] of Object.entries(cardRefs.current)) {
        if (!node) continue;
        let relation = "rest";
        if (next) {
          relation = id === next ? "self" : "far";
          if (
            relation === "far" &&
            wires.some(
              (wire) =>
                (wire.source === next && wire.target === id) ||
                (wire.target === next && wire.source === id),
            )
          ) {
            relation = "near";
          }
        }
        node.dataset.relation = relation;
      }
      for (const wire of wires) {
        const node = wireRefs.current[wire.id];
        if (!node) continue;
        node.dataset.lit =
          next && (wire.source === next || wire.target === next)
            ? "true"
            : "false";
      }
    };

    const heroParallax = () => {
      raf = 0;
      const frame = host.getBoundingClientRect();
      if (!pointer) {
        drift.current = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
        for (const card of cards) {
          const node = cardRefs.current[card.task.id];
          if (node) node.style.transform = "translate3d(0px, 0px, 0)";
        }
        apply(null);
        return;
      }
      const localX = pointer.x - frame.left;
      const localY = pointer.y - frame.top;
      const offX = (localX - frame.width / 2) / (frame.width / 2);
      const offY = (localY - frame.height / 2) / (frame.height / 2);
      drift.current = {
        left: { x: -offX * PARALLAX.left, y: -offY * PARALLAX.left },
        right: { x: -offX * PARALLAX.right, y: -offY * PARALLAX.right },
      };
      for (const card of cards) {
        const node = cardRefs.current[card.task.id];
        if (!node) continue;
        const shift = drift.current[card.place.side];
        node.style.transform = `translate3d(${shift.x.toFixed(2)}px, ${shift.y.toFixed(2)}px, 0)`;
      }
      let found: string | null = null;
      for (const [id, box] of Object.entries(rects.current)) {
        if (
          localX >= box.x &&
          localX <= box.x + box.w &&
          localY >= box.y &&
          localY <= box.y + box.h
        ) {
          found = id;
          break;
        }
      }
      apply(found);
      if (found) {
        setIdle(false);
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => setIdle(true), IDLE_MS);
      }
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
      if (!raf) raf = requestAnimationFrame(heroParallax);
    };
    const onLeave = () => {
      pointer = null;
      if (!raf) raf = requestAnimationFrame(heroParallax);
    };

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
      drift.current = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
      apply(null);
      for (const card of cards) {
        const node = cardRefs.current[card.task.id];
        if (node) node.style.transform = "";
      }
    };
  }, [cards, panel, phone, reduced, wires]);

  const order = useMemo(() => {
    const rank = (id: string) =>
      placements.findIndex((place) => place.id === id);
    const byTarget = new Map<string, Wire>();
    for (const wire of wires) {
      const current = byTarget.get(wire.target);
      if (!current || rank(wire.source) > rank(current.source)) {
        byTarget.set(wire.target, wire);
      }
    }
    return [...byTarget.values()].sort(
      (a, b) => rank(a.target) - rank(b.target),
    );
  }, [wires]);

  const step = useRef(0);

  useEffect(() => {
    if (!running || !order.length) return;
    const timers: number[] = [];
    let raf = 0;
    let stopped = false;
    const at = (ms: number, run: () => void) => {
      timers.push(window.setTimeout(run, ms));
    };

    const advance = () => {
      if (stopped) return;
      if (step.current >= order.length) {
        step.current = 0;
        setStatuses(seed);
        const scene = sceneRef.current;
        if (scene) {
          scene.dataset.reset = "true";
          at(320, () => {
            if (scene) scene.dataset.reset = "false";
          });
        }
        at(900, advance);
        return;
      }
      const wire = order[step.current];
      step.current += 1;
      const path = wire ? pathRefs.current[wire.id] : null;
      const orb = orbRef.current;
      if (!wire || !path || !orb) {
        at(STEP_MS, advance);
        return;
      }
      const total = path.getTotalLength();
      const began = performance.now();
      orb.dataset.on = "true";
      const heroStep = (now: number) => {
        const ratio = Math.min(1, (now - began) / TRAVEL_MS);
        const point = path.getPointAtLength(total * easeInOut(ratio));
        orb.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
        if (ratio < 1) {
          raf = requestAnimationFrame(heroStep);
          return;
        }
        raf = 0;
        orb.dataset.on = "false";
        setStatuses((current) => ({ ...current, [wire.target]: "doing" }));
        at(SETTLE_MS, () =>
          setStatuses((current) => ({ ...current, [wire.target]: "done" })),
        );
      };
      raf = requestAnimationFrame(heroStep);
      at(STEP_MS, advance);
    };

    at(1200, advance);
    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      for (const timer of timers) window.clearTimeout(timer);
      const orb = orbRef.current;
      if (orb) orb.dataset.on = "false";
    };
  }, [order, running, seed]);

  return (
    <div
      className="landing-hero__scene"
      ref={sceneRef}
      data-phone={phone ? "true" : "false"}
      data-hover="off"
      data-reset="false"
      aria-hidden="true"
    >
      <style>
        {demoLabels
          .map(
            (label) =>
              `.landing-hero__scene .label-badge[title="${label.name}"]{--label-color:${label.color} !important}`,
          )
          .join("")}
      </style>
      <svg className="landing-hero__wires" data-motion={reduced ? "off" : "on"}>
        <defs>
          <marker
            id="landing-hero-arrow"
            markerWidth="9"
            markerHeight="9"
            refX="7.4"
            refY="4.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M1 1 L8 4.5 L1 8 Z" fill="var(--accent)" />
          </marker>
        </defs>
        {wires.map((wire, index) => (
          <g
            className="landing-hero__wire"
            key={wire.id}
            ref={(node) => {
              wireRefs.current[wire.id] = node;
            }}
            data-lit="false"
            style={{ "--hero-wire-i": index } as CSSProperties}
          >
            <path
              ref={(node) => {
                pathRefs.current[wire.id] = node;
              }}
              d={geometry[wire.id]?.d ?? ""}
              markerEnd="url(#landing-hero-arrow)"
            />
          </g>
        ))}
      </svg>
      <div className="landing-hero__labels">
        {wires
          .filter((wire) => wire.cross && geometry[wire.id])
          .map((wire) => (
            <span
              className="canvas-edge-label landing-hero__wire-label"
              key={wire.id}
              style={{
                transform: `translate(-50%, -50%) translate(${geometry[wire.id]!.labelX}px, ${geometry[wire.id]!.labelY}px)`,
              }}
            >
              {t("canvas.crossProject")}
            </span>
          ))}
      </div>
      <div className="landing-hero__cards">
        {cards.map(({ place, task, projects }) => (
          <div
            className="landing-hero__card"
            key={task.id}
            data-side={place.side}
            data-row={place.row}
            data-relation="rest"
            ref={(node) => {
              cardRefs.current[task.id] = node;
            }}
            style={
              {
                "--hero-card-shift": `${place.shift}px`,
                "--hero-card-y": rowY[place.side][place.row],
              } as CSSProperties
            }
          >
            <div
              className="landing-hero__card-lift"
              ref={(node) => {
                liftRefs.current[task.id] = node;
              }}
            >
              <HeroTaskCard
                task={task}
                projects={projects}
                status={statuses[task.id] ?? place.seed}
                commit={place.commit}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="landing-hero__orb" ref={orbRef} data-on="false">
        <ActivityBloub brand="claude" label="Claude" />
      </div>
    </div>
  );
}
