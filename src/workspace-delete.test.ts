import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceInfo } from "./store";
import { workspaceDeletion } from "./workspace-delete";

function board(id: string, role?: WorkspaceInfo["role"]): WorkspaceInfo {
  return {
    role,
    id,
    name: id,
    repositoryUrl: "",
    workspace: null as unknown as WorkspaceInfo["workspace"],
  };
}

test("an account can delete its last workspace and land on the start screen", () => {
  const deletion = workspaceDeletion([board("only", "owner")], "only", true);
  assert.equal(deletion.allowed, true);
  assert.equal(deletion.opens, null);
});

test("without an account there is nowhere to land, so one workspace stays", () => {
  assert.equal(
    workspaceDeletion([board("only")], "only", false).allowed,
    false,
  );
  assert.equal(
    workspaceDeletion([board("only"), board("other")], "only", false).allowed,
    true,
  );
});

test("somebody else's workspace is left for its owner to delete", () => {
  const workspaces = [board("shared", "collaborator"), board("mine", "owner")];
  assert.equal(workspaceDeletion(workspaces, "shared", true).allowed, false);
  assert.equal(workspaceDeletion(workspaces, "mine", true).allowed, true);
});

test("the dialog names the workspace that opens next", () => {
  const deletion = workspaceDeletion(
    [board("mine", "owner"), board("shared", "collaborator")],
    "mine",
    true,
  );
  assert.equal(deletion.opens?.id, "shared");
});
