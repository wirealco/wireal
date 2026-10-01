import assert from "node:assert/strict";
import test from "node:test";
import {
  forgetUser,
  isMissingSession,
  rememberUser,
  rememberedUser,
} from "./auth-session";

test("a dead session is told apart from a request that simply failed", () => {
  assert.ok(isMissingSession({ status: 403, message: "Forbidden" }));
  assert.ok(isMissingSession({ status: 401, message: "Unauthorized" }));
  assert.ok(
    isMissingSession({
      status: 400,
      message: "Invalid Refresh Token: Refresh Token Not Found",
    }),
  );

  // These are real failures: showing a sign-in card would lose the reason.
  assert.equal(
    isMissingSession({ status: 400, message: "Invalid login credentials" }),
    false,
  );
  assert.equal(
    isMissingSession({ status: 500, message: "Internal server error" }),
    false,
  );
  assert.equal(isMissingSession(null), false);
  assert.equal(isMissingSession(undefined), false);
  assert.equal(isMissingSession({}), false);
});

type Store = Map<string, string>;
function useLocalStorage(store: Store) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
}

const account = {
  id: "user-1",
  email: "someone@example.com",
  user_metadata: { full_name: "Someone", avatar_url: "https://example/a.png" },
  identities: [],
};

test("a remembered session lets the app open before the refresh call answers", () => {
  const store: Store = new Map();
  useLocalStorage(store);

  assert.equal(rememberedUser(), null);

  rememberUser(account);
  const remembered = rememberedUser();
  assert.equal(remembered?.id, "user-1");
  assert.equal(remembered?.email, "someone@example.com");
  assert.equal(remembered?.user_metadata.full_name, "Someone");
  assert.deepEqual(remembered?.identities, []);

  forgetUser();
  assert.equal(rememberedUser(), null);
});

test("refreshing does not push the horizon past the session it stands for", () => {
  const store: Store = new Map();
  useLocalStorage(store);

  rememberUser(account);
  const first = JSON.parse(store.get("wireal.session.v1")!).until;
  rememberUser({ ...account, user_metadata: { full_name: "Renamed" } });
  const second = JSON.parse(store.get("wireal.session.v1")!).until;
  assert.equal(second, first);
  assert.equal(rememberedUser()?.user_metadata.full_name, "Renamed");
});

test("another account starts its own horizon rather than inheriting one", () => {
  const store: Store = new Map();
  useLocalStorage(store);

  const inherited = Date.now() + 60_000;
  store.set(
    "wireal.session.v1",
    JSON.stringify({ id: "user-1", until: inherited }),
  );
  rememberUser({ ...account, id: "user-2" });
  const until = JSON.parse(store.get("wireal.session.v1")!).until;
  assert.notEqual(until, inherited);
  assert.ok(until > Date.now() + 29 * 24 * 60 * 60 * 1000);
});

test("a hint older than the longest session is discarded, not trusted", () => {
  const store: Store = new Map();
  useLocalStorage(store);

  store.set(
    "wireal.session.v1",
    JSON.stringify({ id: "user-1", until: Date.now() - 1 }),
  );
  assert.equal(rememberedUser(), null);
  assert.equal(store.has("wireal.session.v1"), false);

  store.set("wireal.session.v1", "not json");
  assert.equal(rememberedUser(), null);
  store.set("wireal.session.v1", JSON.stringify({ id: "user-1" }));
  assert.equal(rememberedUser(), null);
});
