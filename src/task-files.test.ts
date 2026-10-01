import assert from "node:assert/strict";
import test from "node:test";
import type { Task, Workspace } from "./domain";
import type { ProxyCommitResult } from "./github-connection";
import {
  blobUrl,
  clearCommitFilesCache,
  commitRef,
  commitUrlFiles,
  commitUrlProxyChunkSize,
  fetchCommitFiles,
  fileCommitRef,
  fileCommitRefAt,
  fileProject,
  filesModel,
  folderPalette,
  rootTint,
  storedGroupBy,
  taskCommitFiles,
  taskFilesModel,
  topFolder,
  type CommitFilesResult,
} from "./task-files";

const shaA = "A".repeat(40);
const shaB = "b".repeat(40);
const commitUrl = (sha = shaA) =>
  `https://github.com/acme/widgets/commit/${sha}`;

const response = (files: unknown[], status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify({ files }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const apiFile = (
  filename: string,
  status = "modified",
  additions = 1,
  deletions = 0,
  previous_filename?: string,
) => ({ filename, status, additions, deletions, previous_filename });

test("commitRef parses and normalizes exact GitHub commit URLs", () => {
  assert.deepEqual(commitRef(`${commitUrl()}/`), {
    url: commitUrl(shaA.toLowerCase()),
    owner: "acme",
    repo: "widgets",
    sha: shaA.toLowerCase(),
  });
  assert.throws(() => commitRef("https://github.com/acme/widgets/commit/abc"));
  assert.throws(() =>
    commitRef(`https://example.com/acme/widgets/commit/${shaA}`),
  );
});

test("fetchCommitFiles sends anonymous GitHub headers", async () => {
  clearCommitFilesCache();
  const requests: { url: string; headers: Headers }[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    return response([apiFile("src/main.ts")]);
  }) as typeof fetch;

  await fetchCommitFiles(commitUrl(shaA), { fetch: fakeFetch });

  assert.equal(
    requests[0].url,
    `https://api.github.com/repos/acme/widgets/commits/${shaA.toLowerCase()}?per_page=300&page=1`,
  );
  assert.equal(
    requests[0].headers.get("accept"),
    "application/vnd.github+json",
  );
  assert.equal(requests[0].headers.get("x-github-api-version"), "2022-11-28");
  assert.equal(requests[0].headers.get("authorization"), null);
});

test("fetchCommitFiles paginates full 300-file pages and maps file fields", async () => {
  clearCommitFilesCache();
  const urls: string[] = [];
  const firstPage = Array.from({ length: 300 }, (_, index) =>
    apiFile(`src/file-${index}.ts`),
  );
  const fakeFetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return urls.length === 1
      ? response(firstPage)
      : response([apiFile("src/new name.ts", "renamed", 4, 2, "src/old.ts")]);
  }) as typeof fetch;

  const result = await fetchCommitFiles(commitUrl(), { fetch: fakeFetch });
  assert.equal(result.error, undefined);
  assert.equal(result.files?.length, 301);
  assert.deepEqual(result.files?.at(-1), {
    path: "src/new name.ts",
    previousPath: "src/old.ts",
    status: "renamed",
    additions: 4,
    deletions: 2,
  });
  assert.match(urls[1], /page=2$/);
});

test("fetchCommitFiles stops after ten full pages", async () => {
  clearCommitFilesCache();
  let calls = 0;
  const files = Array.from({ length: 300 }, (_, index) =>
    apiFile(`src/file-${index}.ts`),
  );
  const fakeFetch = (async () => {
    calls += 1;
    return response(files);
  }) as typeof fetch;
  const result = await fetchCommitFiles(commitUrl(), { fetch: fakeFetch });
  assert.equal(result.files?.length, 3000);
  assert.equal(calls, 10);
});

test("fetchCommitFiles maps HTTP, thrown-fetch, and invalid URL errors", async () => {
  const cases: {
    status: number;
    headers?: HeadersInit;
    kind: string;
  }[] = [
    { status: 401, kind: "unauthorized" },
    { status: 403, kind: "unauthorized" },
    {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
      kind: "rate-limited",
    },
    { status: 429, kind: "rate-limited" },
    { status: 404, kind: "not-found" },
  ];
  for (const [index, item] of cases.entries()) {
    clearCommitFilesCache();
    const fakeFetch = (async () =>
      response([], item.status, item.headers)) as typeof fetch;
    const result = await fetchCommitFiles(commitUrl(index % 2 ? shaA : shaB), {
      fetch: fakeFetch,
    });
    assert.equal(result.error?.kind, item.kind);
    assert.equal(result.error?.status, item.status);
  }

  clearCommitFilesCache();
  const thrown = await fetchCommitFiles(commitUrl(), {
    fetch: (async () => {
      throw new TypeError("offline");
    }) as typeof fetch,
  });
  assert.deepEqual(thrown.error, { kind: "network" });
  const invalid = await fetchCommitFiles("not a URL");
  assert.deepEqual(invalid.error, { kind: "invalid" });
});

test("fetchCommitFiles caches successes and retries failures", async () => {
  clearCommitFilesCache();
  let successCalls = 0;
  const successFetch = (async () => {
    successCalls += 1;
    return response([apiFile("src/main.ts")]);
  }) as typeof fetch;
  const first = await fetchCommitFiles(commitUrl(), { fetch: successFetch });
  const second = await fetchCommitFiles(commitUrl(), { fetch: successFetch });
  assert.strictEqual(first, second);
  assert.equal(successCalls, 1);

  clearCommitFilesCache();
  let retryCalls = 0;
  const retryFetch = (async () => {
    retryCalls += 1;
    return retryCalls === 1
      ? response([], 404)
      : response([apiFile("src/recovered.ts")]);
  }) as typeof fetch;
  assert.equal(
    (await fetchCommitFiles(commitUrl(), { fetch: retryFetch })).error?.kind,
    "not-found",
  );
  assert.equal(
    (await fetchCommitFiles(commitUrl(), { fetch: retryFetch })).files?.[0]
      .path,
    "src/recovered.ts",
  );
  assert.equal(retryCalls, 2);
});

test("taskCommitFiles preserves URL order and never rejects", async () => {
  clearCommitFilesCache();
  const task = {
    commitUrls: [commitUrl(shaA), "bad commit"],
  } as Task;
  const fakeFetch = (async () => response([])) as typeof fetch;
  const results = await taskCommitFiles(task, { fetch: fakeFetch });
  assert.equal(results.length, 2);
  assert.equal(results[0].ref.sha, shaA.toLowerCase());
  assert.equal(results[1].error?.kind, "invalid");
});

test("commitUrlFiles uses one proxy request, caches successes, and falls back anonymously", async () => {
  clearCommitFilesCache();
  let proxyCalls = 0;
  let fetchCalls = 0;
  const urls = [commitUrl(shaA), commitUrl(shaB)];
  const proxied: ProxyCommitResult[] = [
    {
      url: commitUrl(shaA.toLowerCase()),
      owner: "acme",
      repo: "widgets",
      sha: shaA.toLowerCase(),
      committedAt: "2026-09-15T10:00:00Z",
      additions: 2,
      deletions: 1,
      files: [
        {
          path: "src/proxied.ts",
          status: "modified",
          additions: 2,
          deletions: 1,
        },
      ],
    },
    {
      url: commitUrl(shaB),
      error: { kind: "not-connected" },
    },
  ];
  const proxy = async (requested: string[]) => {
    proxyCalls += 1;
    assert.deepEqual(requested, urls);
    return proxied;
  };
  const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls += 1;
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return response([apiFile("src/public.ts")]);
  }) as typeof fetch;

  const first = await commitUrlFiles(urls, { proxy, fetch: fakeFetch });
  assert.equal(first[0].files?.[0].path, "src/proxied.ts");
  assert.equal(first[0].committedAt, "2026-09-15T10:00:00Z");
  assert.equal(first[1].files?.[0].path, "src/public.ts");
  assert.equal(proxyCalls, 1);
  assert.equal(fetchCalls, 1);

  const second = await commitUrlFiles(urls, { proxy, fetch: fakeFetch });
  assert.strictEqual(second[0], first[0]);
  assert.strictEqual(second[1], first[1]);
  assert.equal(proxyCalls, 1);
  assert.equal(fetchCalls, 1);
});

test("commitUrlFiles reports not-connected when a disconnected proxy falls back to a private repository", async () => {
  for (const status of [401, 404, 429]) {
    clearCommitFilesCache();
    const result = await commitUrlFiles([commitUrl()], {
      proxy: async (urls) => [
        { url: urls[0], error: { kind: "not-connected" } },
      ],
      fetch: (async () => response([], status)) as typeof fetch,
    });

    assert.deepEqual(result[0].error, { kind: "not-connected", status });
  }
});

test("commitUrlFiles chunks proxy requests and preserves result order", async () => {
  clearCommitFilesCache();
  const urls = Array.from({ length: 250 }, (_, index) =>
    commitUrl(index.toString(16).padStart(40, "0")),
  );
  const callSizes: number[] = [];
  const proxy = async (requested: string[]): Promise<ProxyCommitResult[]> => {
    callSizes.push(requested.length);
    return requested.map((url) => {
      const ref = commitRef(url);
      return {
        ...ref,
        committedAt: null,
        additions: 1,
        deletions: 0,
        files: [
          {
            path: `src/${ref.sha}.ts`,
            status: "added",
            additions: 1,
            deletions: 0,
          },
        ],
      };
    });
  };

  const results = await commitUrlFiles(urls, { proxy });

  assert.deepEqual(callSizes, [
    commitUrlProxyChunkSize,
    commitUrlProxyChunkSize,
    50,
  ]);
  assert.deepEqual(
    results.map((result) => result.ref.url),
    urls,
  );
  assert.deepEqual(
    results.map((result) => result.files?.[0].path),
    urls.map((url) => `src/${commitRef(url).sha}.ts`),
  );
});

test("commitUrlFiles falls back directly only for a rejected proxy chunk", async () => {
  clearCommitFilesCache();
  const urls = Array.from({ length: 250 }, (_, index) =>
    commitUrl(index.toString(16).padStart(40, "0")),
  );
  const calls: string[][] = [];
  const fetchedShas: string[] = [];
  const proxy = async (requested: string[]): Promise<ProxyCommitResult[]> => {
    calls.push(requested);
    if (calls.length === 2) throw new Error("proxy unavailable");
    return requested.map((url) => {
      const ref = commitRef(url);
      return {
        ...ref,
        committedAt: null,
        additions: 1,
        deletions: 0,
        files: [
          {
            path: `proxy/${ref.sha}.ts`,
            status: "added",
            additions: 1,
            deletions: 0,
          },
        ],
      };
    });
  };
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    const sha = new URL(String(input)).pathname.split("/").at(-1)!;
    fetchedShas.push(sha);
    return response([apiFile(`direct/${sha}.ts`)]);
  }) as typeof fetch;

  const results = await commitUrlFiles(urls, { proxy, fetch: fakeFetch });

  assert.deepEqual(
    calls.map((call) => call.length),
    [commitUrlProxyChunkSize, commitUrlProxyChunkSize, 50],
  );
  assert.deepEqual(
    fetchedShas,
    urls.slice(100, 200).map((url) => commitRef(url).sha),
  );
  assert.deepEqual(
    results.map((result) => result.files?.[0].path),
    urls.map((url, index) => {
      const sha = commitRef(url).sha;
      return index >= 100 && index < 200
        ? `direct/${sha}.ts`
        : `proxy/${sha}.ts`;
    }),
  );
});

test("fileProject prioritizes owned folders and restricts multirepo candidates", () => {
  const monorepo = {
    map: {
      repositoryLayout: "monorepo",
      repositoryUrl: "https://github.com/acme/widgets",
    },
    projects: [
      {
        id: "explicit",
        name: "Client",
        repositoryUrl: "",
        paths: ["services/api"],
      },
      {
        id: "heuristic",
        name: "Api",
        repositoryUrl: "",
      },
      {
        id: "broad",
        name: "Broad",
        repositoryUrl: "",
        paths: ["packages"],
      },
      {
        id: "specific",
        name: "Specific",
        repositoryUrl: "",
        paths: ["packages/web"],
      },
    ],
  } as Workspace;
  assert.equal(
    fileProject(
      "services/api/client.ts",
      "https://github.com/acme/widgets",
      monorepo,
    ),
    "explicit",
  );
  assert.equal(
    fileProject(
      "packages/web/page.tsx",
      "https://github.com/acme/widgets",
      monorepo,
    ),
    "specific",
  );

  const multirepo = {
    map: { repositoryLayout: "multirepo", repositoryUrl: "" },
    projects: [
      {
        id: "widgets",
        name: "Widgets",
        repositoryUrl: "https://github.com/acme/widgets",
        paths: ["src"],
      },
      {
        id: "service",
        name: "Service",
        repositoryUrl: "https://github.com/acme/service",
        paths: ["src"],
      },
      {
        id: "service-root",
        name: "Service root",
        repositoryUrl: "https://github.com/acme/service",
      },
    ],
  } as Workspace;
  assert.equal(
    fileProject("src/index.ts", "https://github.com/ACME/SERVICE", multirepo),
    "service",
  );
  assert.equal(
    fileProject("README.md", "https://github.com/acme/service", multirepo),
    "service-root",
  );
});

test("fileProject falls back to the candidate name heuristic", () => {
  const state = {
    map: {
      repositoryLayout: "monorepo",
      repositoryUrl: "https://github.com/acme/widgets",
    },
    projects: [
      { id: "app", name: "App", repositoryUrl: "" },
      { id: "api", name: "Api", repositoryUrl: "" },
    ],
  } as Workspace;
  assert.equal(
    fileProject(
      "packages/api/client.ts",
      "https://github.com/acme/widgets",
      state,
    ),
    "api",
  );
});

test("filesModel attributes a multirepo file using its newest commit", () => {
  const state = {
    map: { repositoryLayout: "multirepo", repositoryUrl: "" },
    projects: [
      {
        id: "older",
        name: "Older",
        repositoryUrl: "https://github.com/acme/widgets",
        paths: ["src"],
        color: "#123456",
      },
      {
        id: "newer",
        name: "Newer",
        repositoryUrl: "https://github.com/acme/service",
        paths: ["src"],
        color: "#abcdef",
      },
    ],
  } as Workspace;
  const commits: CommitFilesResult[] = [
    {
      ref: commitRef(commitUrl(shaA)),
      committedAt: "2026-01-01T00:00:00Z",
      files: [
        {
          path: "src/shared.ts",
          status: "added",
          additions: 1,
          deletions: 0,
        },
      ],
    },
    {
      ref: commitRef(`https://github.com/acme/service/commit/${shaB}`),
      committedAt: "2026-02-01T00:00:00Z",
      files: [
        {
          path: "src/shared.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
        },
      ],
    },
  ];
  assert.equal(
    taskFilesModel(state, { commitUrls: [] } as unknown as Task, commits)
      .files[0].projectId,
    "newer",
  );
});

test("taskFilesModel merges renames and removals and matches projects by path", () => {
  const task = {
    id: "task-1",
    referenceId: "1",
    name: "Build it",
    projectIds: ["other"],
    commitUrls: [commitUrl(shaA), commitUrl(shaB)],
  } as Task;
  const state = {
    map: {
      repositoryLayout: "monorepo",
      repositoryUrl: "https://github.com/acme/widgets",
    },
    projects: [
      {
        id: "app",
        name: "App",
        repositoryUrl: "https://github.com/acme/frontend",
        color: "#123456",
      },
      {
        id: "other",
        name: "Other",
        repositoryUrl: "https://github.com/acme/other",
        color: "#abcdef",
      },
    ],
  } as Workspace;
  const commits: CommitFilesResult[] = [
    {
      ref: commitRef(commitUrl(shaA)),
      files: [
        {
          path: "packages/app/old.ts",
          status: "modified",
          additions: 2,
          deletions: 1,
        },
        {
          path: "packages/app/removed.ts",
          status: "added",
          additions: 5,
          deletions: 0,
        },
        {
          path: "README.md",
          status: "modified",
          additions: 1,
          deletions: 0,
        },
      ],
    },
    {
      ref: commitRef(commitUrl(shaB)),
      files: [
        {
          path: "packages/app/new.ts",
          previousPath: "packages/app/old.ts",
          status: "renamed",
          additions: 3,
          deletions: 2,
        },
        {
          path: "packages/app/removed.ts",
          status: "removed",
          additions: 0,
          deletions: 5,
        },
      ],
    },
  ];

  const model = taskFilesModel(state, task, commits);
  assert.deepEqual(model.filesByPath.get("packages/app/new.ts"), {
    path: "packages/app/new.ts",
    folder: "packages/app",
    name: "new.ts",
    status: "renamed",
    additions: 5,
    deletions: 3,
    commits: 2,
    shas: [shaA.toLowerCase(), shaB],
    projectId: "app",
    tint: "#123456",
  });
  assert.equal(model.filesByPath.has("packages/app/old.ts"), false);
  assert.equal(
    model.filesByPath.get("packages/app/removed.ts")?.status,
    "removed",
  );
  assert.equal(model.filesByPath.get("packages/app/removed.ts")?.commits, 2);
  assert.equal(model.filesByPath.get("README.md")?.projectId, null);
  assert.deepEqual(model.folders, [
    {
      id: "packages/app",
      label: "packages/app/",
      paths: ["packages/app/new.ts", "packages/app/removed.ts"],
      tint: "#123456",
    },
    { id: "", label: "/", paths: ["README.md"], tint: rootTint },
  ]);
  assert.equal(model.filesByPath.get("README.md")?.tint, rootTint);
  assert.deepEqual(
    model.timeline.map((commit) => [
      commit.ref.sha,
      commit.paths,
      commit.additions,
      commit.deletions,
    ]),
    [
      [shaB, ["packages/app/new.ts", "packages/app/removed.ts"], 3, 7],
      [
        shaA.toLowerCase(),
        ["packages/app/new.ts", "packages/app/removed.ts", "README.md"],
        8,
        1,
      ],
    ],
  );
  assert.deepEqual(
    [...model.projectColors],
    [
      ["app", "#123456"],
      ["other", "#abcdef"],
    ],
  );
  assert.equal(model.additions, 11);
  assert.equal(model.deletions, 8);
});

test("blobUrl encodes each path segment", () => {
  assert.equal(
    blobUrl(commitRef(commitUrl()), "packages/my folder/a#b.ts"),
    `https://github.com/acme/widgets/blob/${shaA.toLowerCase()}/packages/my%20folder/a%23b.ts`,
  );
});

test("fileCommitRef points at the latest commit that touched a file", () => {
  const commits: CommitFilesResult[] = [
    { ref: commitRef(commitUrl(shaA)), files: [] },
    { ref: commitRef(commitUrl(shaB)), files: [] },
  ];
  assert.equal(
    fileCommitRef({ commits }, { shas: [shaA.toLowerCase(), shaB] })?.sha,
    shaB,
  );
  assert.equal(
    fileCommitRef({ commits }, { shas: ["d".repeat(40), shaA.toLowerCase()] })
      ?.sha,
    shaA.toLowerCase(),
  );
  assert.equal(fileCommitRef({ commits }, { shas: ["d".repeat(40)] }), null);
  assert.equal(fileCommitRef({ commits }, { shas: [] }), null);
});

test("fileCommitRefAt points at the focused commit that touched a file", () => {
  const commits: CommitFilesResult[] = [
    { ref: commitRef(commitUrl(shaA)), files: [] },
    { ref: commitRef(commitUrl(shaB)), files: [] },
  ];
  assert.equal(
    fileCommitRefAt(
      { commits },
      { shas: [shaA.toLowerCase(), shaB] },
      shaA.toLowerCase(),
    )?.sha,
    shaA.toLowerCase(),
  );
});

test("fileCommitRefAt falls back when the focused commit did not touch a file", () => {
  const commits: CommitFilesResult[] = [
    { ref: commitRef(commitUrl(shaA)), files: [] },
    { ref: commitRef(commitUrl(shaB)), files: [] },
  ];
  assert.equal(
    fileCommitRefAt({ commits }, { shas: [shaA.toLowerCase()] }, shaB)?.sha,
    shaA.toLowerCase(),
  );
});

test("fileCommitRefAt falls back when no commit is focused", () => {
  const commits: CommitFilesResult[] = [
    { ref: commitRef(commitUrl(shaA)), files: [] },
    { ref: commitRef(commitUrl(shaB)), files: [] },
  ];
  assert.equal(
    fileCommitRefAt({ commits }, { shas: [shaA.toLowerCase(), shaB] }, null)
      ?.sha,
    shaB,
  );
});

test("taskFilesModel tints unclaimed top folders apart from project colors", () => {
  const task = { commitUrls: [commitUrl(shaA)] } as Task;
  const state = {
    map: {
      repositoryLayout: "monorepo",
      repositoryUrl: "https://github.com/acme/widgets",
    },
    projects: [
      {
        id: "api",
        name: "Api",
        repositoryUrl: "https://github.com/acme/api",
        color: folderPalette[0],
      },
    ],
  } as Workspace;
  const paths = ["api/Program.cs", "mcp/server.ts", "docs/guide.md", "LICENSE"];
  const model = taskFilesModel(state, task, [
    {
      ref: commitRef(commitUrl(shaA)),
      files: paths.map((path) => ({
        path,
        status: "modified" as const,
        additions: 1,
        deletions: 0,
      })),
    },
  ]);
  const tintOf = (path: string) => model.filesByPath.get(path)!.tint;
  assert.equal(tintOf("api/Program.cs"), folderPalette[0]);
  assert.equal(tintOf("LICENSE"), rootTint);
  const mcp = tintOf("mcp/server.ts");
  const docs = tintOf("docs/guide.md");
  assert.ok(folderPalette.includes(mcp) && folderPalette.includes(docs));
  assert.notEqual(mcp, docs);
  assert.notEqual(mcp, folderPalette[0]);
  assert.notEqual(docs, folderPalette[0]);
  assert.equal(
    tintOf("mcp/server.ts"),
    taskFilesModel(state, task, [
      {
        ref: commitRef(commitUrl(shaA)),
        files: paths.map((path) => ({
          path,
          status: "modified" as const,
          additions: 1,
          deletions: 0,
        })),
      },
    ]).filesByPath.get("mcp/server.ts")!.tint,
  );
  assert.equal(topFolder("mcp/a/b.ts"), "mcp");
  assert.equal(topFolder("LICENSE"), "");
});

test("fetchCommitFiles shares one request, and a caller that stops listening cannot spoil it", async () => {
  clearCommitFilesCache();
  let calls = 0;
  let release: (value: Response) => void = () => {};
  const fakeFetch = (async () => {
    calls += 1;
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  }) as typeof fetch;

  const first = fetchCommitFiles(commitUrl(), { fetch: fakeFetch });
  const second = fetchCommitFiles(commitUrl(), { fetch: fakeFetch });
  assert.strictEqual(first, second);
  release(response([apiFile("src/main.ts")]));
  const result = await second;
  assert.equal(calls, 1);
  assert.equal(result.error, undefined);
  assert.equal(result.files?.[0].path, "src/main.ts");
});

test("taskFilesModel puts the newest commit on top and merges in commit order", () => {
  const task = { commitUrls: [] } as unknown as Task;
  const state = {
    map: { repositoryLayout: "monorepo", repositoryUrl: "" },
    projects: [],
  } as unknown as Workspace;
  const older: CommitFilesResult = {
    ref: commitRef(commitUrl(shaB)),
    committedAt: "2026-01-02T10:00:00Z",
    files: [
      { path: "src/b.ts", status: "added", additions: 2, deletions: 0 },
      { path: "src/old.ts", status: "added", additions: 1, deletions: 0 },
    ],
  };
  const newer: CommitFilesResult = {
    ref: commitRef(commitUrl(shaA)),
    committedAt: "2026-03-09T10:00:00Z",
    files: [
      {
        path: "src/new.ts",
        previousPath: "src/old.ts",
        status: "renamed",
        additions: 3,
        deletions: 1,
      },
    ],
  };
  const undated: CommitFilesResult = {
    ref: commitRef(commitUrl("c".repeat(40))),
    error: { kind: "not-found", status: 404 },
  };

  const model = taskFilesModel(state, task, [newer, older, undated]);
  assert.deepEqual(
    model.timeline.map((commit) => commit.ref.sha),
    [shaA.toLowerCase(), shaB, "c".repeat(40)],
  );
  assert.equal(model.filesByPath.has("src/old.ts"), false);
  assert.equal(model.filesByPath.get("src/new.ts")?.commits, 2);
  assert.equal(
    fileCommitRef(model, model.filesByPath.get("src/new.ts")!)?.sha,
    shaA.toLowerCase(),
  );
});

const shaC = "c".repeat(40);
const groupState = {
  map: {
    repositoryLayout: "monorepo",
    repositoryUrl: "https://github.com/acme/widgets",
  },
  projects: [
    {
      id: "app",
      name: "App",
      repositoryUrl: "https://github.com/acme/app",
      paths: ["apps/web"],
      color: "#5b8cff",
    },
    {
      id: "api",
      name: "Api",
      repositoryUrl: "https://github.com/acme/api",
      paths: ["services/api"],
      color: "#3fbf8f",
    },
  ],
  tasks: [
    { id: "task-a", projectIds: ["app"] },
    { id: "task-b", projectIds: ["api"] },
  ],
} as unknown as Workspace;

const groupCommits: CommitFilesResult[] = [
  {
    ref: commitRef(commitUrl(shaA)),
    committedAt: "2026-03-01T09:00:00Z",
    files: [
      {
        path: "apps/web/src/App.tsx",
        status: "modified",
        additions: 4,
        deletions: 1,
      },
      {
        path: "apps/web/src/theme.css",
        status: "added",
        additions: 9,
        deletions: 0,
      },
      { path: "README.md", status: "modified", additions: 1, deletions: 1 },
    ],
  },
  {
    ref: commitRef(commitUrl(shaB)),
    committedAt: "2026-03-04T09:00:00Z",
    files: [
      {
        path: "services/api/Program.cs",
        status: "modified",
        additions: 6,
        deletions: 2,
      },
      {
        path: "apps/web/src/App.tsx",
        status: "modified",
        additions: 2,
        deletions: 3,
      },
    ],
  },
  {
    ref: commitRef(commitUrl(shaC)),
    error: { kind: "not-found", status: 404 },
  },
];

const groupOwners = new Map([
  [commitUrl(shaA.toLowerCase()), { id: "task-a", label: "#1 Paint the web" }],
  [commitUrl(shaB), { id: "task-b", label: "#2 Teach the api" }],
]);

const paths = ["apps/web/src/App.tsx", "apps/web/src/theme.css", "README.md"];
const everyPath = [...paths, "services/api/Program.cs"].sort();

const cells = (model: { folders: { paths: string[] }[] }) =>
  model.folders.flatMap((folder) => folder.paths).sort();

test("every grouping mode keeps one cell per path", () => {
  for (const groupBy of ["projects", "paths", "types"] as const) {
    const model = filesModel(groupState, groupCommits, "Acme", groupOwners, {
      groupBy,
    });
    assert.equal(model.groupBy, groupBy);
    assert.deepEqual(cells(model), everyPath, groupBy);
    assert.equal(
      new Set(cells(model)).size,
      everyPath.length,
      `${groupBy} repeats a path`,
    );
  }
});

test("projects grouping boxes files by owner and trails an Other box", () => {
  const model = filesModel(groupState, groupCommits, "Acme", groupOwners, {
    groupBy: "projects",
  });
  assert.deepEqual(
    model.folders.map((folder) => [
      folder.id,
      folder.label,
      folder.tint,
      folder.paths,
    ]),
    [
      [
        "app",
        "App",
        "#5b8cff",
        ["apps/web/src/App.tsx", "apps/web/src/theme.css"],
      ],
      ["api", "Api", "#3fbf8f", ["services/api/Program.cs"]],
      ["", "Other", rootTint, ["README.md"]],
    ],
  );
  assert.equal(model.folders.at(-1)?.labelKey, "taskFiles.groupOther");
});

test("types grouping boxes files by extension", () => {
  const model = filesModel(groupState, groupCommits, "Acme", groupOwners, {
    groupBy: "types",
  });
  assert.deepEqual(
    model.folders.map((folder) => [folder.id, folder.label, folder.paths]),
    [
      [".cs", ".cs", ["services/api/Program.cs"]],
      [".css", ".css", ["apps/web/src/theme.css"]],
      [".md", ".md", ["README.md"]],
      [".tsx", ".tsx", ["apps/web/src/App.tsx"]],
    ],
  );
});

test("types grouping names an extensionless box for the renderer", () => {
  const model = filesModel(
    groupState,
    [
      {
        ref: commitRef(commitUrl(shaA)),
        files: [
          { path: "LICENSE", status: "added", additions: 1, deletions: 0 },
        ],
      },
    ],
    "Acme",
    undefined,
    { groupBy: "types" },
  );
  assert.equal(model.folders[0].id, "");
  assert.equal(model.folders[0].labelKey, "taskFiles.groupNoExtension");
});

test("paths grouping is still the default", () => {
  const model = filesModel(groupState, groupCommits, "Acme", groupOwners);
  assert.equal(model.groupBy, "paths");
  assert.deepEqual(
    model.folders.map((folder) => folder.label),
    ["apps/web/src/", "/", "services/api/"],
  );
});

test('a stored "tasks" grouping preference falls back to paths', () => {
  assert.equal(storedGroupBy({ getItem: () => "tasks" }), "paths");
});

test("the project filter drops other projects' files and the commits that only touched them", () => {
  const model = filesModel(groupState, groupCommits, "Acme", groupOwners, {
    groupBy: "paths",
    projectId: "api",
  });
  assert.deepEqual(
    model.files.map((file) => file.path),
    ["services/api/Program.cs"],
  );
  assert.deepEqual(
    model.timeline.map((commit) => commit.ref.sha),
    [shaB],
  );
  assert.equal(model.loaded.length, 1);
  assert.equal(model.failed.length, 0);
  assert.equal(model.timeline[0].additions, 6);
  assert.equal(model.timeline[0].deletions, 2);
  assert.equal(model.additions, 6);
  assert.equal(model.deletions, 2);
});

test("a filter of all leaves every file and commit standing", () => {
  const model = filesModel(groupState, groupCommits, "Acme", groupOwners, {
    projectId: "all",
  });
  assert.deepEqual(model.files.map((file) => file.path).sort(), everyPath);
  assert.equal(model.timeline.length, 3);
});

test("model.latest is the newest commit that could be read", () => {
  const model = filesModel(groupState, groupCommits, "Acme", groupOwners);
  assert.equal(model.timeline[0].ref.sha, shaB);
  assert.equal(model.timeline.at(-1)?.error?.kind, "not-found");
  assert.equal(model.latest?.ref.sha, shaB);
  assert.equal(filesModel(groupState, [groupCommits[2]], "Acme").latest, null);
});
