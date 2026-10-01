import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { Status } from "./domain";

export function StatusBadge({
  status,
  color,
  size = "sm",
}: {
  status: Status;
  color: string;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  return (
    <span
      className="status-badge"
      data-size={size}
      data-status={status}
      style={{ "--status-source": color } as CSSProperties}
    >
      <svg
        className="status-badge__mark"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <circle className="status-badge__ring" cx="8" cy="8" r="5.75" />
        {status === "doing" && (
          <circle className="status-badge__center" cx="8" cy="8" r="2" />
        )}
        {status === "done" && (
          <path className="status-badge__check" d="m5.25 8 1.8 1.8 3.7-3.75" />
        )}
      </svg>
      <span className="status-badge__label">{t(`status.${status}`)}</span>
    </span>
  );
}
