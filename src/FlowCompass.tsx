import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Kbd } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { ActivityBloub } from "./ActivityBloub";
import "./flow-compass.css";

const COMPASS_KEY = "wireal.flow-compass";

function savedOpen() {
  try {
    return localStorage.getItem(COMPASS_KEY) === "open";
  } catch {
    return false;
  }
}

export function useFlowCompass() {
  const [open, setOpen] = useState(savedOpen);

  useEffect(() => {
    try {
      localStorage.setItem(COMPASS_KEY, open ? "open" : "closed");
    } catch {
      return;
    }
  }, [open]);

  return {
    open,
    toggle: () => setOpen((current) => !current),
  };
}

/** Read once: the platform does not change while the board is open, and it is
 * only ever shown as a label. */
const modifierKey =
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? "⌘"
    : "Ctrl";

function CompassGuide() {
  const { t } = useTranslation();

  return (
    <section className="flow-compass" aria-label={t("compass.title")}>
      <div className="flow-compass__head">
        <span className="flow-compass__title">{t("compass.title")}</span>
      </div>

      <svg
        className="flow-compass__axes"
        viewBox="0 0 260 76"
        role="img"
        aria-label={`${t("compass.flow")}, ${t("compass.order")}`}
      >
        <g
          className="flow-compass__axis flow-compass__axis--flow"
          stroke="currentColor"
          fill="currentColor"
        >
          <path
            d="M26 14 H 228"
            fill="none"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path d="M228 9 L239 14 L228 19 Z" stroke="none" />
          <text
            className="flow-compass__label"
            x="132"
            y="8"
            textAnchor="middle"
            stroke="none"
          >
            {t("compass.flow")}
          </text>
        </g>
        <g
          className="flow-compass__axis flow-compass__axis--order"
          stroke="currentColor"
          fill="currentColor"
        >
          <path
            d="M26 14 V 56"
            fill="none"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path d="M21 56 L26 67 L31 56 Z" stroke="none" />
          <text
            className="flow-compass__label"
            x="12"
            y="40"
            textAnchor="middle"
            transform="rotate(-90 12 40)"
            stroke="none"
          >
            {t("compass.order")}
          </text>
        </g>
      </svg>

      <div className="flow-compass__captions">
        <p className="flow-compass__caption flow-compass__caption--flow">
          <svg
            className="flow-compass__caption-mark"
            width="9"
            height="7"
            viewBox="0 0 9 7"
            aria-hidden="true"
          >
            <path d="M0 3.5 H 5.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5 0.5 L8.5 3.5 L5 6.5 Z" fill="currentColor" />
          </svg>
          {t("compass.flowCaption")}
        </p>
        <p className="flow-compass__caption flow-compass__caption--order">
          <svg
            className="flow-compass__caption-mark"
            width="7"
            height="9"
            viewBox="0 0 7 9"
            aria-hidden="true"
          >
            <path d="M3.5 0 V 5.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M0.5 5 L3.5 8.5 L6.5 5 Z" fill="currentColor" />
          </svg>
          {t("compass.orderCaption")}
        </p>
      </div>

      <div className="flow-compass__legend">
        <p className="flow-compass__row">
          <span
            className="flow-compass__glyph flow-compass__glyph--card"
            aria-hidden="true"
          >
            <svg width="22" height="16" viewBox="0 0 22 16">
              <rect
                x="1"
                y="1.5"
                width="20"
                height="13"
                rx="4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeDasharray="3 3"
              />
            </svg>
          </span>
          {t("compass.proposed")}
        </p>
        <p className="flow-compass__row">
          <span className="flow-compass__glyph" aria-hidden="true">
            <ActivityBloub brand="claude" label={t("compass.working")} />
          </span>
          {t("compass.working")}
        </p>
        <p className="flow-compass__row">
          <span
            className="flow-compass__glyph flow-compass__glyph--wire"
            aria-hidden="true"
          >
            <svg width="22" height="16" viewBox="0 0 22 16">
              <path
                d="M1 8 H 21"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </span>
          {t("compass.dependency")}
        </p>
      </div>

      <div className="flow-compass__shortcuts">
        <span className="flow-compass__title">{t("workspace.shortcuts")}</span>
        <div className="board-shortcuts">
          <span>
            <Kbd variant="light">
              <Kbd.Content>Shift</Kbd.Content>
            </Kbd>
            {t("workspace.shortcutSelectBox")}
          </span>
          <span>
            <Kbd variant="light">
              <Kbd.Content>{modifierKey}</Kbd.Content>
            </Kbd>
            {t("workspace.shortcutSelectAdd")}
          </span>
          <span>{t("workspace.shortcutSelectMove")}</span>
          <span>
            <Kbd variant="light">
              <Kbd.Content>F</Kbd.Content>
            </Kbd>
            {t("workspace.shortcutFitView")}
          </span>
          <span>
            <Kbd variant="light">
              <Kbd.Content>A</Kbd.Content>
            </Kbd>
            {t("workspace.shortcutArrangeTasks")}
          </span>
          <span>
            <Kbd variant="light">
              <Kbd.Content>Del</Kbd.Content>
            </Kbd>
            {t("workspace.shortcutDelete")}
          </span>
        </div>
      </div>
    </section>
  );
}

export function FlowCompass({ open }: { open: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [board, setBoard] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setBoard(anchor.current?.closest<HTMLElement>(".workspace-board") ?? null);
  }, []);

  return (
    <span ref={anchor} className="flow-compass__anchor" aria-hidden="true">
      {open && board ? createPortal(<CompassGuide />, board) : null}
    </span>
  );
}
