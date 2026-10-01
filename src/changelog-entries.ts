export type ChangelogEntry = {
  id: string;
  date: string;
  title: string;
  text: string;
};

export type ChangelogDay = {
  date: string;
  entries: ChangelogEntry[];
};

export const changelogEntries: ChangelogEntry[] = [
  {
    id: "crew",
    date: "2026-09-30",
    title: "Crew",
    text: "Runners are cards now, with their agents inside and each CLI's usage on the card. The pill on the board shows who is working and how much of the week is left, one tap away on a phone.",
  },
  {
    id: "runner-screen",
    date: "2026-09-30",
    title: "A live runner screen",
    text: "wireal-run draws a live dashboard: usage bars, every agent's task and timer, and a feed of what just happened.",
  },
  {
    id: "self-host",
    date: "2026-09-30",
    title: "Open source, self-hostable",
    text: "Wireal runs on PostgreSQL and starts with one Docker Compose file. The code is AGPL-3.0.",
  },
  {
    id: "start",
    date: "2026-09-07",
    title: "Wireal launched",
    text: "Where everything started.",
  },
];

export function changelogDays(
  entries: ChangelogEntry[] = changelogEntries,
): ChangelogDay[] {
  const days: ChangelogDay[] = [];
  for (const entry of entries) {
    const last = days[days.length - 1];
    if (last && last.date === entry.date) last.entries.push(entry);
    else days.push({ date: entry.date, entries: [entry] });
  }
  return days;
}
