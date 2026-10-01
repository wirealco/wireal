const { appendFileSync } = require("node:fs");

function read(then) {
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    body += chunk;
  });
  process.stdin.on("end", () => {
    let payload = {};
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object") payload = parsed;
    } catch {
      payload = {};
    }
    then(payload);
  });
}

function write(kind, payload) {
  const file = process.env.WIREAL_AGENT_EVENTS;
  if (!file) return;
  try {
    appendFileSync(
      file,
      JSON.stringify({ at: new Date().toISOString(), kind, payload }) + "\n",
    );
  } catch {
    return;
  }
}

module.exports = { read, write };
