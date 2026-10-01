/** How an agent's work reads to a person: its report as four labelled lines,
 *  a task's "where are we" line at the top of the inspector, and the digest of
 *  what happened while the person was away. None of it is a badge to decode —
 *  each line says what it is. */
import { useEffect, useMemo, useState } from "react";
import { Chip, Typography } from "@heroui/react";
import { useTranslation } from "react-i18next";
import {
  latestReport,
  parseReport,
  reportFields,
  statuses,
  taskIdLabel,
  type Task,
  type Workspace,
} from "./domain";
import { formatRelativeTime } from "./i18n";
import { awayItems, isBlocked } from "./task-report";
import "./task-report.css";

export function ReportView({ text }: { text: string }) {
  const { t } = useTranslation();
  const report = parseReport(text);
  const fields = reportFields.filter((field) => report[field]);
  // A report that did not keep the shape still says something: show it as is.
  if (!fields.length)
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  return (
    <dl className="task-report">
      {fields.map((field) => (
        <div key={field} className="task-report__row" data-field={field}>
          <dt>{t(`report.${field}`)}</dt>
          <dd>{report[field]}</dd>
        </div>
      ))}
    </dl>
  );
}

function statusColor(status: Task["status"], blocked: boolean) {
  if (blocked) return "danger" as const;
  if (status === "done") return "success" as const;
  if (status === "doing") return "warning" as const;
  return "default" as const;
}

/** The line a person reads first on a task: its status, what was done last
 *  and what is next, taken from the newest report. */
export function TaskStatusLine({ task }: { task: Task }) {
  const { t } = useTranslation();
  const entry = latestReport(task);
  const report = entry ? parseReport(entry.text) : {};
  const blocked = isBlocked(task, report);
  const done = report.done ?? (entry && !report.next ? entry.text : undefined);
  return (
    <div className="task-status-line" data-blocked={blocked || undefined}>
      <Chip size="sm" variant="soft" color={statusColor(task.status, blocked)}>
        <Chip.Label>
          {blocked ? t("report.blockedStatus") : statuses[task.status]}
        </Chip.Label>
      </Chip>
      <div className="min-w-0 flex-1">
        {entry ? (
          <>
            {!!done && (
              <Typography type="body-sm" className="break-words">
                {done}
              </Typography>
            )}
            {!!report.next && (
              <Typography type="body-xs" color="muted" className="break-words">
                {t("report.nextLine", { next: report.next })}
              </Typography>
            )}
            {blocked && !!report.blocked && (
              <Typography type="body-xs" className="break-words text-danger">
                {report.blocked}
              </Typography>
            )}
            <Typography type="body-xs" color="muted">
              {t("report.by", {
                author: entry.author,
                when: formatRelativeTime(entry.at),
              })}
            </Typography>
          </>
        ) : (
          <Typography type="body-sm" color="muted">
            {t("report.none")}
          </Typography>
        )}
      </div>
    </div>
  );
}

const seenKey = (workspaceId: string) => `wireal.away.${workspaceId}`;

function readSeen(workspaceId: string): number {
  try {
    const value = Number(localStorage.getItem(seenKey(workspaceId)));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** When this person last looked at the workspace, moved on whenever they
 *  leave the tab or dismiss the digest. The first visit counts as now, so a
 *  new browser does not open on the workspace's whole history. */
export function useLastSeen(workspaceId: string) {
  const [seen, setSeen] = useState(() => readSeen(workspaceId) || Date.now());
  useEffect(() => {
    setSeen(readSeen(workspaceId) || Date.now());
    const mark = () => {
      if (document.visibilityState !== "hidden") return;
      try {
        localStorage.setItem(seenKey(workspaceId), String(Date.now()));
      } catch {
        return;
      }
    };
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [workspaceId]);
  const markSeen = () => {
    const now = Date.now();
    setSeen(now);
    try {
      localStorage.setItem(seenKey(workspaceId), String(now));
    } catch {
      return;
    }
  };
  return { seen, markSeen };
}

export function AwayDigest({
  state,
  since,
  onOpenTask,
  onDismiss,
}: {
  state: Workspace;
  since: number;
  onOpenTask: (taskId: string) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const items = useMemo(() => awayItems(state, since), [state, since]);
  if (!items.length) return null;
  const counts = {
    done: items.filter((item) => item.kind === "done").length,
    blocked: items.filter((item) => item.kind === "blocked").length,
  };
  return (
    <section className="away-digest" aria-label={t("report.awayTitle")}>
      <header className="away-digest__head">
        <span className="away-digest__title">{t("report.awayTitle")}</span>
        <span className="away-digest__summary">
          {t("report.awaySummary", {
            done: counts.done,
            blocked: counts.blocked,
            count: items.length,
          })}
        </span>
        <button
          type="button"
          className="away-digest__dismiss"
          onClick={onDismiss}
        >
          {t("report.awayDismiss")}
        </button>
      </header>
      <ul className="away-digest__list">
        {items.slice(0, 6).map(({ task, entry, kind }) => {
          const report = parseReport(entry.text);
          return (
            <li key={task.id}>
              <button
                type="button"
                className="away-digest__item"
                data-kind={kind}
                onClick={() => onOpenTask(task.id)}
              >
                <span className="away-digest__ref">
                  {taskIdLabel(task.referenceId)}
                </span>
                <span className="away-digest__text">
                  <span className="away-digest__name">{task.name}</span>
                  <span className="away-digest__line">
                    {kind === "blocked" && report.blocked
                      ? report.blocked
                      : (report.done ?? entry.text)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
