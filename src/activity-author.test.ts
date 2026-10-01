import assert from "node:assert/strict";
import test from "node:test";
import { activityAgentBrand, activityAuthorName } from "./activity-author.ts";
import type { Activity } from "./domain.ts";

const activity = (
  author: string,
  authorType: Activity["authorType"],
): Activity => ({
  id: "activity",
  text: "Update",
  at: new Date().toISOString(),
  author,
  authorType,
});

test("selects logos only for recognized AI callers", () => {
  assert.equal(activityAgentBrand(activity("Claude", "ai")), "claude");
  assert.equal(activityAgentBrand(activity("Codex", "ai")), "codex");
  assert.equal(activityAgentBrand(activity("ChatGPT.com", "ai")), "chatgpt");
  assert.equal(activityAgentBrand(activity("Clode", "ai")), "claude");
  assert.equal(activityAgentBrand(activity("OpenAI", "ai")), null);
  assert.equal(activityAgentBrand(activity("Other Agent", "ai")), null);
  assert.equal(activityAgentBrand(activity("Claude", "user")), null);
});

test("normalizes AI labels without renaming people or guessing old Codex records", () => {
  assert.equal(activityAuthorName(activity("Clode", "ai")), "Claude");
  assert.equal(
    activityAuthorName(activity("ChatGPT Desktop", "ai")),
    "ChatGPT",
  );
  assert.equal(activityAuthorName(activity("Codex", "ai")), "Codex");
  assert.equal(activityAuthorName(activity("Clode", "user")), "Clode");
});
