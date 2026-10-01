import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { timeZone } from "./time-zone";
import { Button, Kbd, Tooltip } from "@heroui/react";
import { FluidOrb } from "./FluidOrb";
import { Code2, GitHubMark, Maximize, Minus, Plus, X } from "./icons";
import { canvasShortcut, isCanvasShortcutTarget } from "./canvas-shortcuts";
import { Field } from "./ui";
import {
  editorFileUrl,
  readEditorRoots,
  repoKey,
  writeEditorRoot,
} from "./local-editor";
import {
  blobUrl,
  cellLabel,
  commitErrorKeys,
  fileCommitRefAt,
  type CommitRef,
  type TaskFilesModel,
  type TaskFolder,
} from "./task-files";

const cellCharWidth = 6.3;
const cellRoom = 24;
const cellHeight = 22;
const gap = 6;
const pad = 10;
const headHeight = 20;
const edge = 18;
const rowGap = 14;
const minStage = 420;
const stageStep = 60;
const legendRoom = 26;
const zoomStep = 1.25;
const zoomMin = 0.25;
const zoomMax = 6;

/** The rail keeps one width whatever the zoom does, so a commit reads the same
 *  from the first glance to the last. */
const railWide = 344;
const railNarrow = 252;
const railWidthFloor = 820;
const railRow = 54;
const railRowGap = 8;
const railDay = 22;
const railPadY = 12;
/** The line sits just inside the rail, so a dot on it is never half cut off
 *  by the edge the rail scrolls behind. */
const spineInset = 12;

type Cell = { path: string; x: number; y: number; w: number };
type Box = {
  id: string;
  label: string;
  tint: string;
  paths: string[];
  x: number;
  y: number;
  w: number;
  h: number;
};

export type LandsLayout = {
  width: number;
  height: number;
  boxes: Box[];
  cells: Map<string, Cell>;
};

const glyphs: Partial<Record<string, string>> = {
  added: "+",
  removed: "−",
  renamed: "→",
  copied: "→",
};

export function cellChars(model: TaskFilesModel, path: string): number {
  const file = model.filesByPath.get(path);
  if (!file) return 1;
  return cellLabel(model, file).length + (glyphs[file.status] ? 2 : 0);
}

/** The land packs folders into a stage the pane hands it; zoom moves the whole
 *  packing afterwards, so the packing itself never depends on the zoom. */
export function landsLayout(
  model: TaskFilesModel,
  stage: number = minStage,
  labelOf: (folder: TaskFolder) => string = (folder) => folder.label,
): LandsLayout {
  const left = edge;
  const right = Math.max(stage - edge, left + 120);
  const cells = new Map<string, Cell>();
  const boxes: Box[] = [];
  let x = left;
  let y = edge;
  let rowHeight = 0;
  for (const folder of model.folders) {
    const count = folder.paths.length;
    const columns = count >= 9 ? 3 : count >= 4 ? 2 : 1;
    const rows = Math.ceil(count / columns);
    const chars = folder.paths.reduce(
      (widest, path) => Math.max(widest, cellChars(model, path)),
      1,
    );
    const cell = Math.round(chars * cellCharWidth + cellRoom);
    const label = labelOf(folder);
    const w = Math.max(
      columns * (cell + gap) - gap + pad * 2,
      Math.ceil(label.length * cellCharWidth) + pad * 2,
    );
    const h = headHeight + rows * (cellHeight + gap) - gap + pad * 2;
    if (x + w > right && x > left) {
      x = left;
      y += rowHeight + rowGap;
      rowHeight = 0;
    }
    boxes.push({
      id: folder.id,
      label,
      tint: folder.tint,
      paths: folder.paths,
      x,
      y,
      w,
      h,
    });
    folder.paths.forEach((path, index) => {
      cells.set(path, {
        path,
        x: x + pad + (index % columns) * (cell + gap),
        y:
          y +
          headHeight +
          pad +
          Math.floor(index / columns) * (cellHeight + gap),
        w: cell,
      });
    });
    rowHeight = Math.max(rowHeight, h);
    x += w + rowGap;
  }
  const bottom = boxes.length ? y + rowHeight : edge + 120;
  return {
    width: boxes.length
      ? Math.max(...boxes.map((box) => box.x + box.w + edge))
      : stage,
    height: bottom + edge + legendRoom,
    boxes,
    cells,
  };
}

/** The land is packed into whichever stage leaves it shaped like the pane, so
 *  fitting it afterwards costs the least zoom. */
export function fittedLands(
  model: TaskFilesModel,
  paneWidth: number,
  paneHeight: number,
  labelOf?: (folder: TaskFolder) => string,
): LandsLayout {
  const target = paneWidth > 0 && paneHeight > 0 ? paneWidth / paneHeight : 1.6;
  const ceiling = Math.max(paneWidth * 2, minStage + stageStep);
  let best = landsLayout(model, minStage, labelOf);
  let score = Infinity;
  for (let stage = minStage; stage <= ceiling; stage += stageStep) {
    const candidate = landsLayout(model, stage, labelOf);
    const fit = Math.abs(Math.log(candidate.width / candidate.height / target));
    if (fit < score) {
      score = fit;
      best = candidate;
    }
  }
  return best;
}

const dayKey = (at?: string | null) => {
  if (!at) return "";
  const when = new Date(at);
  return Number.isNaN(when.getTime())
    ? ""
    : `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
};

/** Where each commit sits in the rail, before the rail is scrolled. */
export function railOffsets(days: readonly string[]): number[] {
  const offsets: number[] = [];
  let cursor = railPadY;
  for (const [index, day] of days.entries()) {
    if (day && day !== days[index - 1]) cursor += railDay;
    offsets.push(cursor);
    cursor += railRow + railRowGap;
  }
  return offsets;
}

type View = { k: number; x: number; y: number };

export function TaskFilesMap({
  model,
  focus = null,
  onFocus,
  zoom = "none",
}: {
  model: TaskFilesModel;
  focus?: string | null;
  onFocus?: (sha: string | null) => void;
  zoom?: "none" | "dock" | "corner";
}) {
  const zoomable = zoom !== "none";
  const { t, i18n } = useTranslation();
  const stage = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [size, setSize] = useState({ width: 960, height: 520 });
  const [scroll, setScroll] = useState(0);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [picked, setPicked] = useState<string | null>(null);
  const [roots, setRoots] = useState(() => readEditorRoots(localStorage));
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState("");
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = {
        width: Math.round(entry.contentRect.width) || 960,
        height: Math.round(entry.contentRect.height) || 520,
      };
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rail = size.width >= railWidthFloor ? railWide : railNarrow;
  const pane = {
    width: Math.max(size.width - rail, 160),
    height: Math.max(size.height, 160),
  };

  const boxLabel = useCallback(
    (folder: TaskFolder) =>
      folder.labelKey ? t(folder.labelKey) : folder.label,
    [t],
  );
  const layout = useMemo(
    () => fittedLands(model, pane.width, pane.height, boxLabel),
    [model, pane.width, pane.height, boxLabel],
  );
  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        timeZone: timeZone(),
        day: "numeric",
        month: "short",
      }),
    [i18n.language],
  );

  const chosen = useMemo(
    () =>
      model.timeline.find((commit) => commit.ref.sha === focus && focus) ??
      model.latest,
    [model, focus],
  );
  const chosenSha = chosen?.ref.sha ?? null;
  const lit = useMemo(() => new Set(chosen?.paths ?? []), [chosen]);
  const days = useMemo(
    () => model.timeline.map((commit) => dayKey(commit.committedAt)),
    [model],
  );
  const offsets = useMemo(() => railOffsets(days), [days]);

  const fitView = useCallback(() => {
    const k = Math.min(
      pane.width / layout.width,
      pane.height / layout.height,
      1,
    );
    setView({
      k,
      x: (pane.width - layout.width * k) / 2,
      y: Math.max((pane.height - layout.height * k) / 2, 0),
    });
  }, [layout.width, layout.height, pane.width, pane.height]);

  useEffect(() => {
    fitView();
  }, [fitView]);

  /** A commit chosen from elsewhere — the header, a task — is brought into the
   *  rail rather than left somewhere above or below it. */
  useEffect(() => {
    const element = list.current;
    const index = model.timeline.findIndex(
      (commit) => commit.ref.sha === chosenSha,
    );
    if (!element || index < 0) return;
    const top = offsets[index];
    const seen = element.scrollTop;
    if (top >= seen && top + railRow <= seen + element.clientHeight) return;
    element.scrollTo({
      top: Math.max(top - element.clientHeight / 2 + railRow / 2, 0),
      behavior: "smooth",
    });
  }, [chosenSha, model, offsets]);

  useEffect(() => {
    setPicked(null);
  }, [model]);

  useEffect(() => {
    const element = stage.current;
    if (!element || !zoomable) return;
    const onWheel = (event: WheelEvent) => {
      const bounds = element.getBoundingClientRect();
      if (event.clientX - bounds.left < rail) return;
      event.preventDefault();
      setView((current) => {
        const k = Math.min(
          Math.max(current.k * Math.exp(-event.deltaY / 320), zoomMin),
          zoomMax,
        );
        if (k === current.k) return current;
        const point = {
          x: (event.clientX - bounds.left - rail - current.x) / current.k,
          y: (event.clientY - bounds.top - current.y) / current.k,
        };
        return {
          k,
          x: current.x + (current.k - k) * point.x,
          y: current.y + (current.k - k) * point.y,
        };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomable, rail]);

  useEffect(() => {
    if (zoom !== "dock") return;
    const onKey = (event: KeyboardEvent) => {
      if (isCanvasShortcutTarget(event.target)) return;
      if (canvasShortcut(event, "commits") !== "fit-view") return;
      event.preventDefault();
      fitView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, fitView]);

  const zoomBy = useCallback(
    (factor: number) =>
      setView((current) => {
        const k = Math.min(Math.max(current.k * factor, zoomMin), zoomMax);
        if (k === current.k) return current;
        const point = {
          x: (pane.width / 2 - current.x) / current.k,
          y: (pane.height / 2 - current.y) / current.k,
        };
        return {
          k,
          x: current.x + (current.k - k) * point.x,
          y: current.y + (current.k - k) * point.y,
        };
      }),
    [pane.width, pane.height],
  );

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest(".task-files-map__cell")) return;
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    if (zoomable) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const from = drag.current;
    if (!from || !zoomable) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (!from.moved && Math.hypot(dx, dy) < 3) return;
    from.moved = true;
    from.x = event.clientX;
    from.y = event.clientY;
    setView((current) => ({
      ...current,
      x: current.x + dx,
      y: current.y + dy,
    }));
  };
  const onPointerUp = () => {
    const from = drag.current;
    drag.current = null;
    if (from && !from.moved) setPicked(null);
  };

  /* Cells and lands answer only to the chosen commit and the picked file, so
     panning, zooming and scrolling the rail leave the whole land untouched. */
  const lands = useMemo(
    () => (
      <g>
        {layout.boxes.map((box) => (
          <g
            key={box.id || "root"}
            className={`task-files-map__land-group ${
              box.paths.every((path) => !lit.has(path)) ? "is-dim" : ""
            }`}
            style={{ "--land-tint": box.tint } as CSSProperties}
          >
            <title>{box.label}</title>
            <rect
              className="task-files-map__land"
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={8}
            />
            <text
              className="task-files-map__land-label"
              x={box.x + pad}
              y={box.y + 14}
            >
              {box.label}
            </text>
          </g>
        ))}
        {[...layout.cells.values()].map((cell) => {
          const file = model.filesByPath.get(cell.path)!;
          const glyph = glyphs[file.status];
          return (
            <g
              key={cell.path}
              className={`task-files-map__cell task-files-map__cell--${file.status} ${
                lit.has(cell.path) ? "is-lit" : "is-dim"
              } ${picked === cell.path ? "is-picked" : ""}`}
              transform={`translate(${cell.x},${cell.y})`}
              style={{ "--file-tint": file.tint } as CSSProperties}
              tabIndex={0}
              role="button"
              aria-pressed={picked === cell.path}
              aria-label={cell.path}
              onClick={() => setPicked(cell.path)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setPicked(cell.path);
              }}
              onFocus={() => setPicked(cell.path)}
            >
              <rect
                className="task-files-map__face"
                width={cell.w}
                height={cellHeight}
                rx={5}
              />
              <rect
                className="task-files-map__bar"
                width={2.5}
                height={cellHeight - 8}
                x={0.5}
                y={4}
                rx={1.5}
              />
              <text x={9} y={15}>
                {glyph && (
                  <tspan className="task-files-map__glyph">{glyph} </tspan>
                )}
                {cellLabel(model, file)}
              </text>
            </g>
          );
        })}
      </g>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, model, lit, picked],
  );

  /* One commit's files are drawn, never every commit's: the wires cost what a
     single commit changed rather than the square of the whole history. */
  const wires = chosen
    ? chosen.paths.map((path) => {
        const cell = layout.cells.get(path);
        if (!cell) return null;
        const file = model.filesByPath.get(path)!;
        const index = model.timeline.indexOf(chosen);
        const y1 = Math.min(
          Math.max(offsets[index] + railRow / 2 - scroll, 6),
          size.height - 6,
        );
        const x1 = rail - spineInset;
        const x2 = rail + view.x + cell.x * view.k;
        const y2 = view.y + (cell.y + cellHeight / 2) * view.k;
        return (
          <path
            key={`wire ${path}`}
            className={`task-files-map__wire ${picked === path ? "is-lit" : ""}`}
            style={{ "--wire-tint": file.tint } as CSSProperties}
            d={`M${x1},${y1} C${x1 + 70},${y1} ${x2 - 70},${y2} ${x2},${y2}`}
          />
        );
      })
    : null;

  const pickedFile = picked ? model.filesByPath.get(picked) : undefined;
  const pickedRef: CommitRef | null = pickedFile
    ? fileCommitRefAt(model, pickedFile, chosenSha)
    : null;
  const pickedProject = pickedFile?.projectId
    ? model.projects.get(pickedFile.projectId)
    : undefined;
  const root = pickedRef ? roots[repoKey(pickedRef)] : undefined;
  const saveRoot = () => {
    if (!pickedRef || !pickedFile) return;
    setRoots(writeEditorRoot(localStorage, repoKey(pickedRef), draft));
    setAsking(false);
    if (draft) window.location.href = editorFileUrl(draft, pickedFile.path);
  };
  const openInEditor = () => {
    if (!pickedRef || !pickedFile) return;
    if (!root) {
      setDraft("");
      setAsking(true);
      return;
    }
    window.location.href = editorFileUrl(root, pickedFile.path);
  };

  const railList = useMemo(
    () => (
      <ol
        className="task-files-map__rail-list"
        ref={list}
        onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
        style={{ paddingTop: railPadY, paddingBottom: railPadY }}
      >
        {model.timeline.map((commit, index) => {
          const sha = commit.ref.sha;
          const short = sha.slice(0, 7) || "—";
          const opens = !!days[index] && days[index] !== days[index - 1];
          const isChosen = sha === chosenSha;
          return (
            <li key={sha || commit.ref.url}>
              {opens && (
                <p
                  className="task-files-map__rail-day"
                  style={{ height: railDay }}
                >
                  {dayFormat.format(new Date(commit.committedAt!))}
                </p>
              )}
              <div
                className="task-files-map__rail-row"
                style={{ height: railRow, marginBottom: railRowGap }}
              >
                <button
                  type="button"
                  className={`task-files-map__rail-card ${isChosen ? "is-chosen" : ""} ${
                    commit.error ? "is-lost" : ""
                  } ${
                    pickedFile && !pickedFile.shas.includes(sha) ? "is-dim" : ""
                  }`}
                  aria-pressed={isChosen}
                  onClick={() =>
                    onFocus?.(isChosen && focus ? null : sha || null)
                  }
                >
                  <span className="task-files-map__rail-title">
                    {commit.title || short}
                  </span>
                  <span className="task-files-map__rail-meta">
                    {commit.error ? (
                      t(commitErrorKeys[commit.error.kind])
                    ) : (
                      <>
                        <span className="task-files-map__rail-sha">
                          {short}
                        </span>
                        {" · "}
                        {t("taskFiles.files", { count: commit.paths.length })}
                        {" · "}
                        <span className="task-files-map__plus">
                          +{commit.additions}
                        </span>{" "}
                        <span className="task-files-map__minus">
                          −{commit.deletions}
                        </span>
                      </>
                    )}
                  </span>
                </button>
                <span className="task-files-map__rail-dot" aria-hidden="true" />
              </div>
            </li>
          );
        })}
      </ol>
    ),
    [model, days, chosenSha, focus, onFocus, pickedFile, dayFormat, t],
  );

  return (
    <div
      className={`task-files-map ${zoomable ? "task-files-map--zoomable" : ""}`}
      ref={stage}
      style={
        {
          "--rail-width": `${rail}px`,
          "--spine-x": `${rail - spineInset}px`,
        } as CSSProperties
      }
    >
      <div className="task-files-map__rail">{railList}</div>
      <div className="task-files-map__spine" aria-hidden="true" />
      <svg
        className="task-files-map__world"
        width={pane.width}
        height={pane.height}
        viewBox={`0 0 ${pane.width} ${pane.height}`}
        preserveAspectRatio="none"
        aria-label={t("taskFiles.mapLabel")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {lands}
        </g>
      </svg>
      <svg className="task-files-map__wires" aria-hidden="true">
        {wires}
      </svg>
      <div className="task-files-map__legend" aria-hidden="true">
        <span>
          <i className="task-files-map__key task-files-map__key--added" />
          {t("taskFiles.legendAdded")}
        </span>
        <span>
          <i className="task-files-map__key task-files-map__key--modified" />
          {t("taskFiles.legendModified")}
        </span>
        <span>
          <i className="task-files-map__key task-files-map__key--removed" />
          {t("taskFiles.legendRemoved")}
        </span>
        <span>
          <i className="task-files-map__key task-files-map__key--renamed" />
          {t("taskFiles.legendRenamed")}
        </span>
        <span>
          <i className="task-files-map__key task-files-map__key--wire" />
          {t("taskFiles.legendWire")}
        </span>
      </div>
      {zoomable && (
        <div className={`task-files-map__zoom task-files-map__zoom--${zoom}`}>
          <div className="canvas-dock">
            <div className="canvas-dock__icons">
              <button
                aria-label={t("canvas.zoomIn")}
                onClick={() => zoomBy(zoomStep)}
              >
                <Plus size={16} />
              </button>
              <button
                aria-label={t("canvas.zoomOut")}
                onClick={() => zoomBy(1 / zoomStep)}
              >
                <Minus size={16} />
              </button>
              <Tooltip delay={350}>
                <Tooltip.Trigger className="inline-flex">
                  <button
                    aria-label={t("canvas.fitView")}
                    aria-keyshortcuts={zoom === "dock" ? "F" : undefined}
                    onClick={fitView}
                  >
                    <Maximize size={16} />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content placement={zoom === "dock" ? "top" : "bottom"}>
                  <span className="flex items-center gap-2">
                    {t("canvas.fitView")}
                    {zoom === "dock" && (
                      <Kbd variant="light">
                        <Kbd.Content>F</Kbd.Content>
                      </Kbd>
                    )}
                  </span>
                </Tooltip.Content>
              </Tooltip>
            </div>
          </div>
        </div>
      )}
      {pickedFile && (
        <aside className={`task-files-map__card task-files-map__card--${zoom}`}>
          {pickedProject && (
            <div className="task-files-map__card-project">
              <FluidOrb
                settings={pickedProject.orb}
                size={34}
                label={pickedProject.name}
              />
              <span className="task-files-map__card-project-name">
                {pickedProject.name}
              </span>
              <Button
                size="sm"
                variant="tertiary"
                isIconOnly
                aria-label={t("taskFiles.closeFile")}
                className="task-files-map__card-close"
                onPress={() => {
                  setPicked(null);
                  setAsking(false);
                }}
              >
                <X size={14} />
              </Button>
            </div>
          )}
          <p className="task-files-map__card-path">
            <span
              className={`task-files-map__card-glyph task-files-map__card-glyph--${pickedFile.status}`}
            >
              {glyphs[pickedFile.status] ?? "•"}
            </span>
            <bdi>{pickedFile.path}</bdi>
          </p>
          <p className="task-files-map__card-meta">
            <span className="task-files-map__plus">
              +{pickedFile.additions}
            </span>{" "}
            <span className="task-files-map__minus">
              −{pickedFile.deletions}
            </span>{" "}
            · {t("taskFiles.inCommits", { count: pickedFile.commits })}
          </p>
          <div className="task-files-map__card-actions">
            {pickedRef && (
              <Button
                size="sm"
                variant="secondary"
                onPress={() =>
                  window.open(
                    blobUrl(pickedRef, pickedFile.path),
                    "_blank",
                    "noreferrer",
                  )
                }
              >
                <GitHubMark size={14} />
                {t("taskFiles.openOnGitHub")}
              </Button>
            )}
            <Button size="sm" variant="primary" onPress={openInEditor}>
              <Code2 size={14} />
              {t("taskFiles.openInEditor")}
            </Button>
            {!pickedProject && (
              <Button
                size="sm"
                variant="tertiary"
                isIconOnly
                aria-label={t("taskFiles.closeFile")}
                className="ml-auto"
                onPress={() => {
                  setPicked(null);
                  setAsking(false);
                }}
              >
                <X size={14} />
              </Button>
            )}
          </div>
          {asking && pickedRef && (
            <form
              className="task-files-map__card-root"
              onSubmit={(event) => {
                event.preventDefault();
                saveRoot();
              }}
            >
              <Field
                label={t("taskFiles.editorRoot", {
                  repo: `${pickedRef.owner}/${pickedRef.repo}`,
                })}
                value={draft}
                onChange={setDraft}
                placeholder="/Users/you/code/repo"
                autoFocus
              />
              <Button size="sm" variant="primary" onPress={saveRoot}>
                {t("taskFiles.editorRootSave")}
              </Button>
            </form>
          )}
        </aside>
      )}
    </div>
  );
}

export default TaskFilesMap;
