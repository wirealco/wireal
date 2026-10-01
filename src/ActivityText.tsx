import { useTranslation } from "react-i18next";
import { ArrowRight, GitCommitHorizontal } from "./icons";
import { statuses, type ActivityKind, type Status } from "./domain";
import type { OrbSettings } from "./orb-settings";
import { StatusBadge } from "./StatusBadge";

/**
 * Automatic activity is written by the workspace as a sentence, because the
 * sentence is what an agent reading the task over MCP receives. In the app it
 * is worth more than a line of grey text: a status change is the one entry a
 * person scans an activity list for, and a commit is a place to go rather than
 * forty hex characters to read.
 *
 * The stored text is never rewritten — this only decides how it is drawn, and
 * anything unrecognised falls through unchanged.
 */

const statusChange = /^Status changed (?:from (\w+) )?to (\w+)$/;
const commitLink = /^(Linked|Unlinked) GitHub commit ([0-9a-f]{7,40})$/i;

const statusName = (value: string) =>
  statuses[value as Status] ?? value.charAt(0).toUpperCase() + value.slice(1);

function ActivityStatus({
  status,
  statusOrbs,
}: {
  status: string;
  statusOrbs: Record<Status, OrbSettings>;
}) {
  return Object.hasOwn(statuses, status) ? (
    <StatusBadge
      status={status as Status}
      color={statusOrbs[status as Status].colors[0]}
    />
  ) : (
    <span className="activity-status">{statusName(status)}</span>
  );
}

export function ActivityText({
  text,
  commitUrl,
  statusOrbs,
}: {
  text: string;
  statusOrbs: Record<Status, OrbSettings>;
  /** Where the short SHA should lead, when the task still carries that link. */
  commitUrl?: string;
}) {
  const status = statusChange.exec(text);
  if (status) {
    const [, from, to] = status;
    return (
      <span className="activity-line">
        {from && (
          <>
            <ActivityStatus status={from} statusOrbs={statusOrbs} />
            <ArrowRight size={12} className="text-muted" />
          </>
        )}
        <ActivityStatus status={to} statusOrbs={statusOrbs} />
      </span>
    );
  }

  const commit = commitLink.exec(text);
  if (commit) {
    const [, verb, sha] = commit;
    const short = sha.slice(0, 7);
    return (
      <span className="activity-line">
        <span className="text-muted">{verb}</span>
        {/* A link only when the commit is still attached; an unlinked one has
            nowhere to go, and a dead link is worse than plain text. */}
        {commitUrl ? (
          <a
            className="activity-commit"
            href={commitUrl}
            target="_blank"
            rel="noreferrer"
          >
            <GitCommitHorizontal size={12} />
            {short}
          </a>
        ) : (
          <span className="activity-commit activity-commit--gone">
            <GitCommitHorizontal size={12} />
            {short}
          </span>
        )}
      </span>
    );
  }

  return <>{text}</>;
}

export function ActivityKindLabel({
  kind,
  to,
}: {
  kind: ActivityKind;
  /** Who the entry was addressed to, which only a review carries. */
  to?: string;
}) {
  const { t } = useTranslation();
  // Only what a person must act on wears a label. The rest said what kind of
  // note it was, which read like a verdict ("Verification") and was not one.
  if (kind !== "blocker" && kind !== "review") return null;
  return (
    <span className="activity-kind" data-kind={kind}>
      {t(`activity.kinds.${kind}`)}
      {!!to && (
        <span className="activity-kind__to">
          {t("review.to", { name: to })}
        </span>
      )}
    </span>
  );
}

export function ActivityFacts({
  commit,
  commitUrl,
}: {
  commit?: string;
  commitUrl?: string;
}) {
  if (!commit) return null;
  return (
    <div className="activity-facts">
      {commit &&
        (commitUrl ? (
          <a
            className="activity-commit"
            href={commitUrl}
            target="_blank"
            rel="noreferrer"
          >
            <GitCommitHorizontal size={12} />
            {commit.slice(0, 7)}
          </a>
        ) : (
          <span className="activity-commit activity-commit--gone">
            <GitCommitHorizontal size={12} />
            {commit.slice(0, 7)}
          </span>
        ))}
    </div>
  );
}

export function commitShaUrl(
  repository: string,
  commit: string,
): string | undefined {
  const sha = commit.trim().toLowerCase();
  const base = repository.trim().replace(/\/+$/, "");
  if (
    !/^[0-9a-f]{7,40}$/.test(sha) ||
    !/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(base)
  )
    return undefined;
  return `${base}/commit/${sha}`;
}

/** The commit this activity is about, if the task still links it. */
export function activityCommitUrl(text: string, commitUrls: readonly string[]) {
  const commit = commitLink.exec(text);
  if (!commit) return undefined;
  return commitUrls.find((url) => url.endsWith(commit[2]));
}
