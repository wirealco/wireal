import { useEffect, useRef, useState } from "react";

import {
  createAsciiFluid,
  DEFAULT_CHARSET,
  type AsciiFluidInstance,
  type AsciiFluidOptions,
} from "./ascii-fluid-vanilla";

export { DEFAULT_CHARSET } from "./ascii-fluid-vanilla";
export type {
  AsciiFluidInstance,
  AsciiFluidOptions,
  AsciiFluidTheme,
} from "./ascii-fluid-vanilla";

export type AsciiFluidProps = AsciiFluidOptions & {
  className?: string;
};

/**
 * ASCII fluid background — pointer trails leave ink that swirls and
 * quantizes to a clean brightness-mapped glyph field. Zero deps.
 */
export function AsciiFluid({
  className,
  charset = DEFAULT_CHARSET,
  cellSize = 12,
  color,
  backgroundColor,
  force = 1,
  dissipation = 0.05,
  brush = 0.55,
  animate = true,
  interactive = true,
  theme = "auto",
}: AsciiFluidProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<AsciiFluidInstance | null>(null);
  // A WebGL context can be taken back at any time — a driver reset, memory
  // pressure, a machine waking up — and it never returns on its own, so the
  // field would simply be gone until the board was mounted again. Counting the
  // losses re-keys the canvas, which hands the engine a fresh element to take a
  // context on.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onLost = (event: Event) => {
      event.preventDefault();
      setGeneration((count) => count + 1);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    instanceRef.current = createAsciiFluid(canvas, {
      charset,
      cellSize,
      color,
      backgroundColor,
      force,
      dissipation,
      brush,
      animate,
      interactive,
      theme,
    });
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
    // Engine reads live options via setOptions; mount once per context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  useEffect(() => {
    instanceRef.current?.setOptions({
      charset,
      cellSize,
      color,
      backgroundColor,
      force,
      dissipation,
      brush,
      animate,
      interactive,
      theme,
    });
  }, [
    charset,
    cellSize,
    color,
    backgroundColor,
    force,
    dissipation,
    brush,
    animate,
    interactive,
    theme,
  ]);

  return (
    <div
      data-slot="ascii-fluid"
      aria-hidden
      className={["ascii-fluid", className].filter(Boolean).join(" ")}
    >
      <canvas
        key={generation}
        ref={canvasRef}
        className="absolute inset-0 size-full"
      />
    </div>
  );
}
