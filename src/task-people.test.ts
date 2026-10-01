import { test } from "node:test";
import assert from "node:assert/strict";
import { editAge, initials, personHue, taskPeople } from "./task-people";
import type { Activity } from "./domain";

const entry = (
  author: string,
  authorType: Activity["authorType"],
  at: string,
  authorId?: string,
): Activity => ({
  id: `${author}-${at}`,
  text: "Did a thing",
  at,
  author,
  authorType,
  authorId,
});

test("people are read from the activity, most recent first", () => {
  const people = taskPeople({
    activity: [
      entry("Codex CLI", "ai", "2026-09-14T10:00:00Z"),
      entry("Ines R.", "user", "2026-09-14T09:00:00Z", "u-ines"),
      entry("Ines R.", "user", "2026-09-14T11:00:00Z", "u-ines"),
      entry("Grace H.", "user", "2026-09-13T09:00:00Z", "u-grace"),
    ],
  });
  assert.deepEqual(
    people.map((person) => [person.name, person.kind, person.entries]),
    [
      ["Ines R.", "user", 2],
      ["Codex", "agent", 1],
      ["Grace H.", "user", 1],
    ],
  );
  assert.equal(people[1].brand, "codex");
});

test("the same person is one person however the entry names them", () => {
  const people = taskPeople({
    activity: [
      entry("Ines R.", "user", "2026-09-14T09:00:00Z", "u-ines"),
      entry("Ines Rojas", "user", "2026-09-14T10:00:00Z", "u-ines"),
      entry("codex", "ai", "2026-09-14T08:00:00Z"),
      entry("Codex", "ai", "2026-09-14T08:30:00Z"),
    ],
  });
  assert.deepEqual(
    people.map((person) => person.key),
    ["user:u-ines", "agent:codex"],
  );
});

test("the workspace's own voice is nobody", () => {
  const people = taskPeople({
    activity: [
      entry("Wireal AI", "ai", "2026-09-14T09:00:00Z"),
      entry("   ", "user", "2026-09-14T09:00:00Z"),
    ],
  });
  assert.deepEqual(people, []);
});

test("an entry that names a person without an id is not that person", () => {
  const people = taskPeople({
    activity: [
      entry("Ines R.", "user", "2026-09-14T09:00:00Z", "u-ines"),
      entry("Ines R.", "user", "2026-09-14T10:00:00Z"),
    ],
  });
  assert.deepEqual(
    people.map((person) => [person.key, person.entries]),
    [["user:u-ines", 1]],
  );
});

test("a bare name cannot borrow an account by answering to it", () => {
  const people = taskPeople({
    activity: [
      entry("Ines R.", "user", "2026-09-14T09:00:00Z"),
      entry("ines r.", "user", "2026-09-14T10:00:00Z"),
      entry("INES R.", "user", "2026-09-14T11:00:00Z"),
    ],
  });
  assert.deepEqual(people, []);
});

test("initials take the first and last word", () => {
  assert.equal(initials("Grace Hopper"), "GH");
  assert.equal(initials("ines"), "I");
  assert.equal(initials("Ana Maria de Souza"), "AS");
  assert.equal(initials(""), "?");
});

test("person hues are stable and spread names around the colour wheel", () => {
  const hue = personHue("Grace Hopper");
  assert.equal(hue, personHue("Grace Hopper"));
  assert.equal(hue, personHue("  GRACE HOPPER  "));
  assert.equal(Number.isInteger(hue), true);
  assert.equal(hue >= 0 && hue <= 359, true);
  assert.notEqual(hue, personHue("Local preview"));
});

test("edit ages use compact units for the first week", () => {
  const now = Date.parse("2026-09-16T12:00:00Z");
  assert.deepEqual(editAge("2026-09-16T11:59:40Z", now), {
    unit: "now",
    count: 0,
  });
  assert.deepEqual(editAge("2026-09-16T11:33:00Z", now), {
    unit: "minute",
    count: 27,
  });
  assert.deepEqual(editAge("2026-09-16T09:00:00Z", now), {
    unit: "hour",
    count: 3,
  });
  assert.deepEqual(editAge("2026-09-12T12:00:00Z", now), {
    unit: "day",
    count: 4,
  });
  assert.deepEqual(editAge("2026-09-09T12:00:00Z", now), {
    unit: "date",
    count: 0,
  });
});
