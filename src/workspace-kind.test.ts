import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkspace, projectRepository, workspaceKind } from "./domain";
import { testWorkspace } from "./test-workspace";
import {
  configureProjectRepository,
  createProject,
  linkCommit,
} from "../mcp/workspace";

test("everyday workspaces persist their kind and reject GitHub setup", () => {
  const state = structuredClone(testWorkspace);
  assert.equal(workspaceKind(state), "coding");
  state.map.kind = "everyday";
  assert.equal(
    workspaceKind(parseWorkspace(JSON.stringify(state))),
    "everyday",
  );
  assert.equal(projectRepository(state, state.projects[0]), "");
  assert.equal(
    createProject(state, { name: "Holiday plans" }).project.repositoryUrl,
    "",
  );
  assert.throws(
    () =>
      configureProjectRepository(state, state.projects[0].id, {
        repositoryUrl: "https://github.com/example/app",
      }),
    /coding/,
  );
  assert.throws(
    () =>
      linkCommit(
        state,
        state.tasks[0].id,
        state.projects[0].id,
        "a".repeat(40),
        "Agent",
      ),
    /coding/,
  );
});
