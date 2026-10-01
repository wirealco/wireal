import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import type { WorkspaceInfo } from "../mcp/client.ts";
import type { Workspace } from "../src/domain.ts";
import { testWorkspace } from "../src/test-workspace.ts";
import {
  bindingChecks,
  renameBinding,
  resolveBinding,
  setBindingChecks,
  setBindingCrew,
  type BindingClient,
} from "./binding.ts";
import { bindingHash, bindingPath, readBinding } from "./session.ts";

const repository = "https://github.com/wireal/wireal";

function workspace(
  id: string,
  name: string,
  repositories: string[] = [],
  mapRepository = "",
): { info: WorkspaceInfo; document: Workspace } {
  const document = structuredClone(testWorkspace);
  document.map.name = name;
  document.map.repositoryUrl = mapRepository;
  for (const [index, project] of document.projects.entries())
    project.repositoryUrl = repositories[index] ?? "";
  return {
    info: {
      id,
      name,
      repositoryUrl: mapRepository,
      revision: 1,
      isActive: false,
    },
    document,
  };
}

function client(entries: ReturnType<typeof workspace>[]): BindingClient {
  return {
    workspaces: async () => entries.map((entry) => entry.info),
    workspace: async (workspaceId) =>
      entries.find((entry) => entry.info.id === workspaceId)!.document,
  };
}

test("names each binding file with the repository folder hash", () => {
  const first = resolve("/projects/one");
  const second = resolve("/projects/two");
  assert.equal(
    bindingHash(first),
    createHash("sha256").update(first).digest("hex").slice(0, 8),
  );
  assert.notEqual(bindingHash(first), bindingHash(second));
  assert.equal(
    bindingPath(first, "/config"),
    join("/config", "bindings", `${bindingHash(first)}.json`),
  );
});

test("automatically binds the only workspace with the repository", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wireal-bindings-"));
  const repoPath = join(directory, "wireal");
  const messages: string[] = [];
  const entry = workspace("workspace-one", "Wireal", [repository]);
  const binding = await resolveBinding({
    repoPath,
    directory,
    tty: false,
    terminal: () => "",
    client: client([entry]),
    repository: async () => `${repository}.git`,
    makeId: () => "runner-one",
    print: (message) => messages.push(message),
  });
  assert.deepEqual(binding, {
    id: "runner-one",
    name: "wireal",
    workspaceId: "workspace-one",
    repoPath: resolve(repoPath),
  });
  assert.deepEqual(messages, ["Bound to workspace Wireal"]);
  assert.deepEqual(
    JSON.parse(readFileSync(bindingPath(repoPath, directory), "utf8")),
    binding,
  );
});

test("asks which matching workspace to bind when a terminal is present", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wireal-bindings-"));
  const entries = [
    workspace("workspace-one", "First", [], repository),
    workspace("workspace-two", "Second", [repository]),
  ];
  const questions: string[] = [];
  const binding = await resolveBinding({
    repoPath: join(directory, "wireal"),
    directory,
    tty: true,
    terminal: () => "",
    client: client(entries),
    repository: async () => repository,
    prompt: async (question) => {
      questions.push(question);
      return question.startsWith("Choose") ? "2" : "Studio";
    },
    print: () => {},
    makeId: () => "runner-two",
  });
  assert.equal(binding.workspaceId, "workspace-two");
  assert.equal(binding.name, "Studio");
  assert.deepEqual(questions, [
    "Choose a workspace [1-2]: ",
    "Name this runner [wireal]: ",
  ]);
});

test("requires an explicit workspace for several matches without a terminal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wireal-bindings-"));
  const entries = [
    workspace("workspace-one", "First", [], repository),
    workspace("workspace-two", "Second", [repository]),
  ];
  await assert.rejects(
    resolveBinding({
      repoPath: join(directory, "wireal"),
      directory,
      tty: false,
      client: client(entries),
      repository: async () => repository,
    }),
    new Error(
      "Several workspaces have this repository. Pass --workspace <name>.",
    ),
  );
});

test("fails with guidance when no workspace matches without a terminal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wireal-bindings-"));
  await assert.rejects(
    resolveBinding({
      repoPath: join(directory, "wireal"),
      directory,
      tty: false,
      client: client([workspace("workspace-one", "Other")]),
      repository: async () => repository,
    }),
    new Error("No workspace has this repository. Pass --workspace <name>."),
  );
});

test("offers every workspace when none matches and a terminal is present", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wireal-bindings-"));
  const entries = [
    workspace("workspace-one", "First"),
    workspace("workspace-two", "Second"),
  ];
  const messages: string[] = [];
  const binding = await resolveBinding({
    repoPath: join(directory, "wireal"),
    directory,
    tty: true,
    terminal: () => "",
    client: client(entries),
    repository: async () => repository,
    prompt: async (question) => (question.startsWith("Choose") ? "2" : ""),
    print: (message) => messages.push(message),
    makeId: () => "runner-one",
  });
  assert.equal(binding.workspaceId, "workspace-two");
  assert.deepEqual(messages, [
    "1. First",
    "2. Second",
    "Bound to workspace Second",
  ]);
});

test("an explicit workspace rebinds the folder and preserves its runner id", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wireal-bindings-"));
  const repoPath = join(directory, "wireal");
  const entries = [
    workspace("workspace-one", "First", [repository]),
    workspace("workspace-two", "Second"),
  ];
  const first = await resolveBinding({
    repoPath,
    directory,
    tty: false,
    client: client(entries),
    repository: async () => repository,
    makeId: () => "runner-one",
    print: () => {},
  });
  const rebound = await resolveBinding({
    repoPath,
    directory,
    workspace: "Second",
    tty: false,
    client: client(entries),
    makeId: () => "runner-two",
    print: () => {},
  });
  assert.equal(first.workspaceId, "workspace-one");
  assert.equal(rebound.workspaceId, "workspace-two");
  assert.equal(rebound.id, first.id);
});

test("a named terminal names the runner, and a rename sticks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wireal-bindings-"));
  const repoPath = join(directory, "wireal");
  const entry = workspace("workspace-one", "Portal", [repository]);
  const bound = await resolveBinding({
    repoPath,
    directory,
    tty: false,
    terminal: () => "Usage limits",
    client: client([entry]),
    repository: async () => repository,
    makeId: () => "runner-one",
    print: () => {},
  });
  assert.equal(bound.name, "Usage limits");

  assert.deepEqual(renameBinding(repoPath, "  Limits work  ", directory), {
    from: "Usage limits",
    to: "Limits work",
  });
  assert.equal(
    readBinding(repoPath, bindingPath(repoPath, directory))?.name,
    "Limits work",
  );
  assert.equal(
    renameBinding(join(directory, "elsewhere"), "Other", directory),
    undefined,
  );
  assert.throws(
    () => renameBinding(repoPath, "   ", directory),
    /needs a name/,
  );

  const again = await resolveBinding({
    repoPath,
    directory,
    tty: false,
    terminal: () => "Usage limits",
    client: client([entry]),
    repository: async () => repository,
    print: () => {},
  });
  assert.equal(again.name, "Limits work");
});

test("defaults the name to the folder and reuses an existing binding", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wireal-bindings-"));
  const repoPath = join(directory, "customer-portal");
  const entry = workspace("workspace-one", "Portal", [repository]);
  const first = await resolveBinding({
    repoPath,
    directory,
    tty: false,
    terminal: () => "",
    client: client([entry]),
    repository: async () => repository,
    makeId: () => "runner-one",
    print: () => {},
  });
  const second = await resolveBinding({
    repoPath,
    directory,
    tty: true,
    client: {
      workspaces: async () => {
        throw new Error("an existing binding must not resolve again");
      },
      workspace: async () => {
        throw new Error("an existing binding must not resolve again");
      },
    },
    prompt: async () => {
      throw new Error("an existing binding must not prompt again");
    },
  });
  assert.equal(first.name, basename(repoPath));
  assert.deepEqual(second, first);
});

test("checks belong to the folder on this machine, and survive a rebind", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wireal-bindings-"));
  const repoPath = join(directory, "wireal");
  const entries = [
    workspace("workspace-one", "First", [repository]),
    workspace("workspace-two", "Second"),
  ];
  await resolveBinding({
    repoPath,
    directory,
    tty: false,
    client: client(entries),
    repository: async () => repository,
    makeId: () => "runner-one",
    print: () => {},
  });
  assert.deepEqual(bindingChecks(repoPath, directory), []);
  assert.deepEqual(
    setBindingChecks(
      repoPath,
      ["  npm test  ", "", "npm run build"],
      directory,
    ),
    ["npm test", "npm run build"],
  );
  assert.deepEqual(bindingChecks(repoPath, directory), [
    "npm test",
    "npm run build",
  ]);
  const rebound = await resolveBinding({
    repoPath,
    directory,
    workspace: "Second",
    tty: false,
    client: client(entries),
    print: () => {},
  });
  assert.deepEqual(rebound.checks, ["npm test", "npm run build"]);
  assert.deepEqual(setBindingChecks(repoPath, [], directory), []);
  assert.deepEqual(bindingChecks(repoPath, directory), []);
  assert.equal(
    "checks" in
      JSON.parse(readFileSync(bindingPath(repoPath, directory), "utf8")),
    false,
  );
});

test("the crew the keys make is saved with the folder and survives a rebind", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wireal-bindings-"));
  const repoPath = join(directory, "wireal");
  const entries = [
    workspace("workspace-one", "First", [repository]),
    workspace("workspace-two", "Second"),
  ];
  assert.equal(setBindingCrew(repoPath, [], directory), false);
  await resolveBinding({
    repoPath,
    directory,
    tty: false,
    client: client(entries),
    repository: async () => repository,
    makeId: () => "runner-one",
    print: () => {},
  });
  const path = bindingPath(repoPath, directory);
  assert.equal(readBinding(repoPath, path)?.crew, undefined);
  const crew = [
    { n: 2, kind: "codex" as const, id: "r-2" },
    { n: 1, kind: "claude" as const, id: "r-1" },
  ];
  assert.equal(setBindingCrew(repoPath, crew, directory), true);
  assert.deepEqual(readBinding(repoPath, path)?.crew, [crew[1], crew[0]]);
  const rebound = await resolveBinding({
    repoPath,
    directory,
    workspace: "Second",
    tty: false,
    client: client(entries),
    print: () => {},
  });
  assert.deepEqual(rebound.crew, [crew[1], crew[0]]);
  assert.equal(setBindingCrew(repoPath, [], directory), true);
  assert.deepEqual(readBinding(repoPath, path)?.crew, []);
});

test("a folder with no binding has no checks to show or set", () => {
  const directory = mkdtempSync(join(tmpdir(), "wireal-bindings-"));
  const repoPath = join(directory, "wireal");
  assert.equal(bindingChecks(repoPath, directory), undefined);
  assert.equal(setBindingChecks(repoPath, ["npm test"], directory), undefined);
});
