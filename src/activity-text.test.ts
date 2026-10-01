import assert from "node:assert/strict";
import test from "node:test";
import { activityCommitUrl } from "./ActivityText";

const sha = "32966757f85dd1c1106d1d239244872096b11dca";
const url = `https://github.com/example/repo/commit/${sha}`;

test("a commit activity finds the link the task still carries", () => {
  assert.equal(activityCommitUrl(`Linked GitHub commit ${sha}`, [url]), url);
  // Short SHAs are what the workspace actually writes for some entries.
  assert.equal(
    activityCommitUrl("Linked GitHub commit 3296675", [url]),
    undefined,
  );
  // Unlinked since: no link to offer, so the chip is drawn without one.
  assert.equal(
    activityCommitUrl(`Unlinked GitHub commit ${sha}`, []),
    undefined,
  );
  // Anything else is left alone entirely.
  assert.equal(
    activityCommitUrl("Status changed from todo to done", [url]),
    undefined,
  );
  assert.equal(activityCommitUrl("Reviewed the auth path", [url]), undefined);
});
