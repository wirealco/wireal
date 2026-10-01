import { render, spinnerMs, type View } from "../runner/ui.ts";

const started = Date.now() - 74_000;

const view: View = {
  awake: true,
  runner: "studio-mac",
  runnerId: "160d46f9-ab62-4b69-8ea0-13322bb52bc8",
  host: "studio-mac.local",
  workspace: "Wireal",
  mode: "automatic",
  costUsd: 12.87,
  paused: "",
  skipped: [
    { reference: "20", name: "Docs page for MCP", reason: "no objective" },
  ],
  folder: {
    branch: "main",
    dirty: true,
    behind: 2,
    path: "~/Desktop/wireal",
  },
  usage: [
    {
      kind: "claude",
      fiveHour: 21,
      sevenDay: 55,
      fiveHourReset: Date.now() + 2 * 3_600_000 + 13 * 60_000,
      sevenDayReset: Date.now() + 3 * 86_400_000,
      at: Date.now(),
    },
    {
      kind: "codex",
      fiveHour: 94,
      sevenDay: 71,
      fiveHourReset: Date.now() + 40 * 60_000,
      at: Date.now() + 400,
    },
  ],
  feed: [
    { at: Date.now() - 600_000, text: "runner studio-mac ready" },
    { at: Date.now() - 125_000, text: "the app pinged this runner" },
    { at: Date.now() - 80_000, text: "Merging wireal/18" },
    { at: Date.now() - 76_000, text: "Checks: npm test" },
    { at: Date.now() - 75_000, text: "Merged into main as a3f19c2" },
    {
      at: Date.now(),
      text: "Readying the browser agents take screenshots with",
      pending: true,
    },
    { at: Date.now() + 3_000, text: "18 done a3f19c2 $0.84" },
  ],
  slots: [
    {
      agent: "opus1",
      kind: "claude",
      model: "opus",
      enabled: true,
      hosted: true,
      reference: "19",
      name: "Runners roster rework",
      state: "working",
      since: started,
      last: "Editing src/AgentsWindow.tsx",
      step: "editing src/AgentsWindow.tsx",
      files: ["src/domain.ts", "src/AgentsWindow.tsx", "src/i18n.ts"],
      costUsd: 4.12,
      fiveHour: 21,
      sevenDay: 55,
      paused: "",
      following: "18",
      lines: [],
    },
    {
      agent: "cod2",
      kind: "codex",
      model: "gpt-5.6-sol",
      enabled: true,
      hosted: true,
      reference: "",
      name: "",
      state: "idle",
      since: 0,
      last: "",
      costUsd: 0,
      fiveHour: 94,
      sevenDay: 71,
      paused: "",
      following: "",
      lines: [],
    },
  ],
};

const columns = process.stdout.columns ?? 110;
const rows = process.stdout.rows ?? 40;
let frame = 0;
process.stdout.write("\u001b[?25l");
const timer = setInterval(() => {
  frame += 1;
  process.stdout.write(
    "\u001b[H" +
      render(view, Date.now(), null, columns, {
        colour: true,
        frame,
        height: rows,
        motion: true,
      }) +
      "\u001b[0J",
  );
}, spinnerMs);

const stop = () => {
  clearInterval(timer);
  process.stdout.write("\u001b[?25h\n");
  process.exit(0);
};
process.on("SIGINT", stop);
setTimeout(stop, 20_000);
