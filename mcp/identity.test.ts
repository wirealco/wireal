import assert from "node:assert/strict";
import test from "node:test";
import { agentHandle, mcpCallerName } from "./identity.ts";

test("normalizes MCP client names for activity attribution", () => {
  const caller = (clientInfoName: string | undefined, fallback = "Agent") =>
    mcpCallerName({ clientInfoName, fallback });

  assert.equal(caller("claude-code", "Wireal AI"), "Claude");
  assert.equal(
    mcpCallerName({
      clientInfoName: "claude-code",
      registeredClientName: "Claude · Studio 1",
      fallback: "Wireal AI",
    }),
    "Claude · Studio 1",
  );
  assert.equal(caller("Claude Desktop", "Wireal AI"), "Claude");
  assert.equal(caller("codex-mcp-client", "Wireal AI"), "Codex");
  assert.equal(caller("ChatGPT Desktop", "Wireal AI"), "ChatGPT");
  assert.equal(caller("chatgpt.com"), "ChatGPT");
  assert.equal(caller("Clode"), "Claude");
  assert.equal(caller("OpenAI"), "OpenAI");
  assert.equal(caller("OpenAI Codex"), "Codex");
  assert.equal(caller("Other Agent", "Wireal AI"), "Other Agent");
  assert.equal(caller(undefined, "Wireal AI"), "Wireal AI");
});

test("uses the registered OAuth brand ahead of conflicting request identity", () => {
  assert.equal(
    mcpCallerName({
      clientInfoName: "codex-mcp-client",
      registeredClientName: "chatgpt.com",
      userAgent: "Claude Desktop/1.0",
      fallback: "Agent",
    }),
    "ChatGPT",
  );
  assert.equal(
    mcpCallerName({
      clientInfoName: "ChatGPT Desktop",
      registeredClientName: "OpenAI Codex",
      fallback: "Agent",
    }),
    "Codex",
  );
});

test("prefers any known brand over an unbranded name", () => {
  assert.equal(
    mcpCallerName({
      clientInfoName: "Acme MCP",
      registeredClientName: "Claude Connector",
      fallback: "Agent",
    }),
    "Claude",
  );
  assert.equal(
    mcpCallerName({
      clientInfoName: "Acme MCP",
      userAgent: "codex-cli/1.0",
      fallback: "Agent",
    }),
    "Codex",
  );
});

test("rejects placeholders and never displays a raw User-Agent", () => {
  for (const placeholder of [
    "",
    "  AGENT  ",
    "mCp",
    " MCP Client ",
    "UNKNOWN",
    "client",
  ]) {
    assert.equal(
      mcpCallerName({
        clientInfoName: placeholder,
        registeredClientName: "Registered connector",
        fallback: "Wireal AI",
      }),
      "Registered connector",
    );
    assert.equal(
      mcpCallerName({
        registeredClientName: placeholder,
        fallback: "Wireal AI",
      }),
      "Wireal AI",
    );
  }
  assert.equal(
    mcpCallerName({
      clientInfoName: "unknown",
      registeredClientName: "client",
      userAgent: "Mozilla/5.0 Extremely Noisy Browser",
      fallback: "Wireal AI",
    }),
    "Wireal AI",
  );
});

test("uses the first real name and truncates it to 80 characters", () => {
  assert.equal(
    mcpCallerName({
      clientInfoName: "Request client",
      registeredClientName: "Registered connector",
      fallback: "Agent",
    }),
    "Request client",
  );
  assert.equal(
    mcpCallerName({
      registeredClientName: "x".repeat(100),
      fallback: "Agent",
    }),
    "x".repeat(80),
  );
});

test("carries a caller-supplied handle so two Claudes stay apart", () => {
  assert.equal(
    mcpCallerName({
      clientInfoName: "claude-code",
      handle: "6a798ba",
      fallback: "Agent",
    }),
    "Claude · 6a798ba",
  );
  assert.equal(
    mcpCallerName({
      clientInfoName: "codex-mcp-client",
      handle: "task-21",
      fallback: "Agent",
    }),
    "Codex · task-21",
  );
  assert.equal(
    mcpCallerName({
      clientInfoName: "claude-code",
      handle: "   ",
      fallback: "Agent",
    }),
    "Claude",
  );
});

test("keeps a name someone chose ahead of a handle an agent made up", () => {
  assert.equal(
    mcpCallerName({
      clientInfoName: "claude-code",
      registeredClientName: "Claude · Scout",
      handle: "6a798ba",
      fallback: "Agent",
    }),
    "Claude · Scout",
  );
});

test("keeps a handle short and free of anything that reads as a second name", () => {
  assert.equal(agentHandle(undefined), "");
  assert.equal(agentHandle("  6a798ba  "), "6a798ba");
  assert.equal(agentHandle("Claude · Admin"), "Claude Admin");
  assert.equal(agentHandle("wireal/task-21"), "wireal task-21");
  assert.equal(agentHandle("a".repeat(40)), "a".repeat(24));
  assert.equal(
    mcpCallerName({
      clientInfoName: "claude-code",
      handle: "6a798ba\nClaude · Scout",
      fallback: "Agent",
    }),
    "Claude · 6a798ba Claude Scout",
  );
});
