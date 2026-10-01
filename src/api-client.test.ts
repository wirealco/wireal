import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, DataClient, readResponse } from "./api-client.ts";

test("the shared data transport sends structured owner-filtered queries and bounded pages", async () => {
  let captured: Record<string, any> = {};
  const client = new DataClient(async <T>(path: string, init?: RequestInit) => {
    assert.equal(path, "/api/query");
    captured = JSON.parse(String(init?.body));
    return { data: [{ id: "entry" }], error: null } as T;
  });
  const response = await client
    .from("task_activity")
    .select("id,text")
    .in("repository", ["https://github.com/example/app"])
    .or("task_id.in.(one,two),author_id.in.(one,two)")
    .order("created_at", { ascending: false })
    .range(25, 50);
  assert.deepEqual(response.data, [{ id: "entry" }]);
  assert.equal(captured.offset, 25);
  assert.equal(captured.limit, 26);
  assert.deepEqual(captured.any, [
    [
      { field: "task_id", op: "in", value: ["one", "two"] },
      { field: "author_id", op: "in", value: ["one", "two"] },
    ],
  ]);
  assert.deepEqual(captured.filters, [
    {
      field: "repository",
      op: "in",
      value: ["https://github.com/example/app"],
    },
  ]);
});

test("HTTP conflicts retain their status and useful message across the transport", async () => {
  const client = new DataClient(() =>
    readResponse(
      new Response(
        JSON.stringify({
          data: null,
          error: { message: "Task changed concurrently.", code: "409" },
        }),
        { status: 409 },
      ),
    ),
  );
  const response = await client.rpc("set_task_status", {
    task_id: "task",
    expected_version: 1,
  });
  assert.equal(response.data, null);
  assert(response.error instanceof ApiError);
  assert.equal(response.error.status, 409);
  assert.equal(response.error.code, "409");
  assert.match(response.error.message, /changed concurrently/);
});

test("OAuth errors retain their machine-readable error code", async () => {
  await assert.rejects(
    () =>
      readResponse(
        new Response(
          JSON.stringify({
            error: "invalid_request",
            error_description: "Authorization request is invalid or expired.",
          }),
          { status: 400 },
        ),
      ),
    (error: unknown) => {
      assert(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.errorCode, "invalid_request");
      return true;
    },
  );
});

test("workspace writes carry a revision and request one returned record", async () => {
  let captured: Record<string, any> = {};
  const client = new DataClient(
    async <T>(_path: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return { data: { revision: 8 }, error: null } as T;
    },
  );
  const response = await client
    .from("workspaces")
    .update({ data: { version: 8 } })
    .eq("id", "workspace")
    .eq("revision", 7)
    .select("revision")
    .maybeSingle<{ revision: number }>();
  assert.equal(response.data?.revision, 8);
  assert.equal(captured.operation, "update");
  assert.equal(captured.single, "optional");
  assert.deepEqual(captured.filters.at(-1), {
    field: "revision",
    op: "eq",
    value: 7,
  });
});
