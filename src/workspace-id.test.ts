import assert from "node:assert/strict";
import test from "node:test";
import { localWorkspaceId, remoteWorkspace } from "./workspace-id";

test("the board an account holds before it has one is never asked about", () => {
  assert.equal(remoteWorkspace(localWorkspaceId), false);
  assert.equal(remoteWorkspace(""), false);
  assert.equal(remoteWorkspace(null), false);
  assert.equal(remoteWorkspace(undefined), false);
});

test("a workspace with a row behind it is", () => {
  assert.equal(remoteWorkspace("9203c14d-9355-4fcc-9e01-bde0fa21ac1d"), true);
});
