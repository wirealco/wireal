import {
  latestReport,
  parseReport,
  type Activity,
  type Report,
  type Task,
  type Workspace,
} from "./domain";

export function isBlocked(task: Task, report: Report): boolean {
  if (report.blocked && !/^(none|no|nothing|-)\.?$/i.test(report.blocked))
    return true;
  const newestBlocker = task.activity.find((entry) => entry.kind === "blocker");
  const newestReport = latestReport(task);
  return (
    !!newestBlocker &&
    (!newestReport ||
      (Date.parse(newestBlocker.at) || 0) > (Date.parse(newestReport.at) || 0))
  );
}

export type AwayItem = {
  task: Task;
  entry: Activity;
  kind: "done" | "blocked" | "reported";
};

/** What changed since `since`: tasks finished, blocked, or reported on by an
 *  agent, newest first. A person's own notes are not news to them. */
export function awayItems(state: Workspace, since: number): AwayItem[] {
  const items: AwayItem[] = [];
  for (const task of state.tasks) {
    const fresh = task.activity.filter(
      (entry) =>
        entry.authorType === "ai" && (Date.parse(entry.at) || 0) > since,
    );
    if (!fresh.length) continue;
    const entry = latestReport(task) ?? fresh[0];
    const report = parseReport(entry.text);
    const kind = isBlocked(task, report)
      ? "blocked"
      : task.status === "done"
        ? "done"
        : "reported";
    items.push({
      task,
      entry: (Date.parse(entry.at) || 0) > since ? entry : fresh[0],
      kind,
    });
  }
  return items.sort(
    (a, b) => (Date.parse(b.entry.at) || 0) - (Date.parse(a.entry.at) || 0),
  );
}
