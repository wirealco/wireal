import assert from "node:assert/strict";
import test from "node:test";
import { repositoryScopeChanged } from "./repository-scope.ts";
import { testWorkspace } from "./test-workspace.ts";
import type { Workspace } from "./domain.ts";

function scoped(): Workspace {
  const state = structuredClone(testWorkspace);
  state.map.repositoryLayout = "multirepo";
  state.projects[0].repositoryUrl = "https://github.com/octo-org/api";
  state.projects[0].paths = ["src"];
  return state;
}

test("repository scope ignores everything but repositories, layout and folders", () => {
  const previous = scoped();
  const next = structuredClone(previous);
  next.map.name = "Renamed";
  next.projects[0].name = "Renamed project";
  next.projects[0].repositoryUrl = "https://github.com/Octo-Org/api";
  next.projects[0].paths = ["./src/"];
  next.projects = next.projects.filter((_, index) => index !== 1);
  assert.equal(repositoryScopeChanged(previous, next), false);
});

test("repository scope notices a changed repository, layout or folder", () => {
  const edits: ((state: Workspace) => void)[] = [
    (state) => (state.map.repositoryUrl = "https://github.com/octo-org/web"),
    (state) => (state.map.repositoryLayout = "monorepo"),
    (state) =>
      (state.projects[0].repositoryUrl = "https://github.com/octo-org/secret"),
    (state) => (state.projects[0].paths = ["src", "docs"]),
    (state) => delete state.projects[0].paths,
  ];
  for (const edit of edits) {
    const next = scoped();
    edit(next);
    assert.equal(repositoryScopeChanged(scoped(), next), true);
  }
});

test("a new project may reuse a chosen repository but not add one or folders", () => {
  const base = scoped();
  const project = {
    ...structuredClone(base.projects[0]),
    id: "new-project",
    name: "New",
  };
  delete project.paths;
  const reuse = structuredClone(base);
  reuse.projects.push({ ...project });
  assert.equal(repositoryScopeChanged(base, reuse), false);

  const other = structuredClone(base);
  other.projects.push({
    ...project,
    repositoryUrl: "https://github.com/octo-org/secret",
  });
  assert.equal(repositoryScopeChanged(base, other), true);

  const folders = structuredClone(base);
  folders.projects.push({ ...project, repositoryUrl: "", paths: ["src"] });
  assert.equal(repositoryScopeChanged(base, folders), true);
});
