import assert from "node:assert/strict";
import test from "node:test";
import {
  changelogDays,
  changelogEntries,
  type ChangelogEntry,
} from "./changelog-entries";

const entry = (id: string, date: string): ChangelogEntry => ({
  id,
  date,
  title: id,
  text: id,
});

test("the entries run newest first", () => {
  const dates = changelogEntries.map((item) => item.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("every entry is dated and identified once", () => {
  const ids = new Set<string>();
  for (const item of changelogEntries) {
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(item.title.length > 0 && item.text.length > 0);
    assert.equal(ids.has(item.id), false);
    ids.add(item.id);
  }
});

test("a day holds the entries that share its date", () => {
  const days = changelogDays([
    entry("a", "2026-09-20"),
    entry("b", "2026-09-20"),
    entry("c", "2026-09-19"),
  ]);
  assert.deepEqual(
    days.map((day) => [day.date, day.entries.map((item) => item.id)]),
    [
      ["2026-09-20", ["a", "b"]],
      ["2026-09-19", ["c"]],
    ],
  );
});

test("the days of the shipped changelog are each named once", () => {
  const dates = changelogDays().map((day) => day.date);
  assert.equal(new Set(dates).size, dates.length);
});
