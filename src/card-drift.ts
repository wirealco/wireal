import { useLayoutEffect, useState } from "react";

export type CardDrift = "on" | "off";

const CARD_DRIFT_KEY = "wireal.card-drift";
const DEFAULT_DRIFT: CardDrift = "on";

function savedDrift(): CardDrift {
  try {
    const value = localStorage.getItem(CARD_DRIFT_KEY);
    return value === "on" || value === "off" ? value : DEFAULT_DRIFT;
  } catch {
    return DEFAULT_DRIFT;
  }
}

export function useCardDrift() {
  const [drift, setDrift] = useState<CardDrift>(savedDrift);

  useLayoutEffect(() => {
    try {
      localStorage.setItem(CARD_DRIFT_KEY, drift);
    } catch {
      return;
    }
  }, [drift]);

  return { drift, setDrift };
}
