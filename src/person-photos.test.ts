import { test } from "node:test";
import assert from "node:assert/strict";
import { personPhotos, photoFor } from "./person-photos";
import { personOf } from "./task-people";
import type { Activity } from "./domain";

const team = [
  { id: "u-ines", name: "Ines R.", avatarUrl: "https://pics/ines.png" },
  { id: "u-grace", name: "Grace H.", avatarUrl: "https://pics/grace.png" },
  { id: "u-noface", name: "Noface N.", avatarUrl: null },
];

const entry = (
  author: string,
  authorType: Activity["authorType"],
  authorId?: string,
): Activity => ({
  id: `${author}-1`,
  text: "Did a thing",
  at: "2026-09-14T09:00:00Z",
  author,
  authorType,
  authorId,
});

const faceOf = (
  photos: ReturnType<typeof personPhotos>,
  activity: Activity,
) => {
  const person = personOf(activity);
  assert.ok(person);
  return photoFor(photos, person);
};

test("an editor the team knows wears their photo, not their initials", () => {
  const photos = personPhotos(team, null);
  assert.equal(
    faceOf(photos, entry("Ines R.", "user", "u-ines")),
    "https://pics/ines.png",
  );
  assert.equal(
    faceOf(photos, entry("Noface N.", "user", "u-noface")),
    undefined,
  );
  assert.equal(faceOf(photos, entry("Stranger", "user", "u-who")), undefined);
});

test("an entry written without an author id is nobody and wears no face", () => {
  assert.equal(personOf(entry("ines r.", "user")), null);
});

test("the id is the only evidence, so a shared name lends no face", () => {
  const photos = personPhotos(
    [
      { id: "u-ines", avatarUrl: "https://pics/ines.png" },
      { id: "u-grace", avatarUrl: null },
    ],
    null,
  );
  // Both entries below are signed "Ines R.", but they are different accounts.
  // The one with a picture keeps it, and the one without wears its initials
  // rather than borrowing the other's face off a matching name.
  assert.equal(
    faceOf(photos, entry("Ines R.", "user", "u-ines")),
    "https://pics/ines.png",
  );
  assert.equal(faceOf(photos, entry("Ines R.", "user", "u-grace")), undefined);
});

test("the signed-in account outranks its own stale team row", () => {
  const stale = [
    { id: "u-ines", name: "Ines R.", avatarUrl: "https://pics/old.png" },
  ];
  const fresh = personPhotos(stale, {
    id: "u-ines",
    avatarUrl: "https://pics/new.png",
  });
  assert.equal(
    faceOf(fresh, entry("Ines R.", "user", "u-ines")),
    "https://pics/new.png",
  );
  // Removing your picture removes it here too, rather than losing to the row
  // the server sent before you removed it.
  const removed = personPhotos(stale, { id: "u-ines" });
  assert.equal(faceOf(removed, entry("Ines R.", "user", "u-ines")), undefined);
});

test("an account with no team to read still knows its own face", () => {
  const photos = personPhotos([], {
    id: "u-ines",
    avatarUrl: "https://pics/ines.png",
  });
  assert.deepEqual(photos, { "user:u-ines": "https://pics/ines.png" });
});

test("agents have no account and find nothing", () => {
  const photos = personPhotos(team, null);
  const person = personOf(entry("Codex CLI", "ai"));
  assert.ok(person);
  assert.equal(photoFor(photos, person), undefined);
});
