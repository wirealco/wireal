import type { Activity, Task } from "./domain";
import {
  agentBrand,
  agentDisplayName,
  type AgentBrand,
} from "./agent-identity";

/**
 * Who has worked on a task, read from what the task remembers.
 *
 * Nobody is assigned here. A task carries an activity entry for everything
 * done to it — created, renamed, moved, a note left, a claim recorded through
 * MCP — and each entry names who did it. The people on a task are the people
 * in that list, which is a fact the task already holds rather than a field
 * someone has to keep up to date, and it counts agents the same as people.
 *
 * A person is only counted when the entry recorded their account id. An entry
 * that carries a bare name is shown in the activity as it was written, but it
 * never becomes an editor: an id is evidence of who acted, a name is not.
 */
export type TaskPerson = {
  /** The account the entry named, or the agent handle that signed it. A name
   *  is never a key: display names are chosen, so keying by one would let an
   *  entry claim an account that only happens to answer to the same name. */
  key: string;
  name: string;
  kind: "user" | "agent";
  brand: AgentBrand | null;
  /** When they last touched the task. */
  at: string;
  /** How many entries of theirs the task carries. */
  entries: number;
};

export type EditAge =
  | { unit: "now"; count: 0 }
  | { unit: "minute" | "hour" | "day"; count: number }
  | { unit: "date"; count: 0 };

/** The workspace's own voice: an entry nobody in particular made. */
const systemAuthor = "wireal ai";

export function personOf(entry: Activity): TaskPerson | null {
  const name = entry.author.trim();
  if (!name) return null;
  if (entry.authorType === "ai") {
    if (name.toLowerCase() === systemAuthor) return null;
    return {
      key: `agent:${name.toLowerCase()}`,
      name: agentDisplayName(name),
      kind: "agent",
      brand: agentBrand(name),
      at: entry.at,
      entries: 1,
    };
  }
  if (!entry.authorId) return null;
  return {
    key: `user:${entry.authorId}`,
    name,
    kind: "user",
    brand: null,
    at: entry.at,
    entries: 1,
  };
}

/** Everyone on the task, the most recently active first. */
export function taskPeople(task: Pick<Task, "activity">): TaskPerson[] {
  const people = new Map<string, TaskPerson>();
  for (const entry of task.activity) {
    const person = personOf(entry);
    if (!person) continue;
    const seen = people.get(person.key);
    if (!seen) {
      people.set(person.key, person);
      continue;
    }
    seen.entries += 1;
    if (entry.at > seen.at) seen.at = entry.at;
  }
  return [...people.values()].sort((a, b) => b.at.localeCompare(a.at));
}

export function editAge(
  value: string | number | Date,
  now: number = Date.now(),
): EditAge {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return { unit: "now", count: 0 };
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return { unit: "now", count: 0 };
  if (seconds < 3600)
    return { unit: "minute", count: Math.round(seconds / 60) };
  if (seconds < 86400)
    return { unit: "hour", count: Math.round(seconds / 3600) };
  if (seconds < 7 * 86400)
    return { unit: "day", count: Math.round(seconds / 86400) };
  return { unit: "date", count: 0 };
}

/** One or two letters that stand for a person on a small face. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters =
    words.length === 1
      ? words[0].slice(0, 1)
      : words[0].slice(0, 1) + words[words.length - 1].slice(0, 1);
  return letters.toUpperCase();
}

export function personHue(name: string): number {
  const normalized = name.trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}
