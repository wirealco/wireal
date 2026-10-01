import { useLayoutEffect, useState } from "react";

export type BoardBackground = "fluid" | "dots";

const BOARD_BACKGROUND_KEY = "wireal.board-background";

export function chooseBackground(
  stored: string | null,
  coarse: boolean,
): BoardBackground {
  if (stored === "fluid" || stored === "dots") return stored;
  return coarse ? "dots" : "fluid";
}

function savedBackground(): BoardBackground {
  try {
    return chooseBackground(
      localStorage.getItem(BOARD_BACKGROUND_KEY),
      matchMedia("(pointer: coarse)").matches,
    );
  } catch {
    return chooseBackground(null, false);
  }
}

export function useBoardBackground() {
  const [background, setBackground] =
    useState<BoardBackground>(savedBackground);

  useLayoutEffect(() => {
    try {
      localStorage.setItem(BOARD_BACKGROUND_KEY, background);
    } catch {
      return;
    }
  }, [background]);

  return { background, setBackground };
}
