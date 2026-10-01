import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { DocumentHero, PublicDocument } from "./PublicPage";
import { CircleCheck, Copy } from "./icons";
import { runnerPackage, version } from "./version";
import { mcpEndpoint } from "./mcp-endpoint";
import type { ResolvedTheme, ThemePreference } from "./theme";
import "./docs-page.css";

const endpoint = mcpEndpoint;

export type DocsTopic = "mcp" | "runner";

/** The sidebar is a shelf, not a pair of buttons: pages are filed under a
 *  named group, and a page opened here unfolds its own headings under its
 *  row. A page added later is one entry in this list, and a kind of page
 *  nothing here covers yet is one more group id beside them. */
type DocsGroup = "guides";

const docsGroups: DocsGroup[] = ["guides"];

export const docsTopics: { id: DocsTopic; href: string; group: DocsGroup }[] = [
  { id: "mcp", href: "/docs", group: "guides" },
  { id: "runner", href: "/docs/runner", group: "guides" },
];

type Snippet = {
  id: string;
  title: string;
  tag?: string;
  lines: readonly string[];
  note?: string;
};

type Block = {
  id: string;
  heading: string;
  text?: string;
  facts?: DocsTopic;
  flow?: boolean;
  snippets?: Snippet[];
  notes?: string[];
};

const release: Record<DocsTopic, string> = {
  mcp: `wireal ${version}`,
  runner: `${runnerPackage} ${version}`,
};

type FlowStep = { step: number; dir: "down" | "up"; manual?: boolean };

function FlowNode({ name, role }: { name: string; role: string }) {
  return (
    <div className="docs-flow__node">
      <code className="docs-flow__ref">{name}</code>
      <span className="docs-flow__role">{role}</span>
    </div>
  );
}

function FlowEdge({ steps }: { steps: readonly FlowStep[] }) {
  return (
    <div className="docs-flow__edge">
      {steps.map((entry) => (
        <span
          key={entry.step}
          className="docs-flow__arrow"
          data-dir={entry.dir}
          data-manual={entry.manual ? "true" : undefined}
        >
          <span className="docs-flow__num">{entry.step}</span>
        </span>
      ))}
    </div>
  );
}

function FlowFigure() {
  const { t } = useTranslation();
  const legend = [
    { step: 1, path: "origin/main → origin/agents" },
    { step: 2, path: "origin/agents → wireal/44" },
    { step: 3, path: "wireal/44 → origin/agents" },
    { step: 4, path: "origin/agents → origin/main", manual: true },
    { step: 5, path: "origin/main → ~/repo" },
  ];
  return (
    <figure className="docs-flow">
      <div className="docs-flow__frame">
        <FlowNode name="origin/main" role={t("docs.runner.flowMain")} />
        <div className="docs-flow__aside">
          <span className="docs-flow__link" data-from="origin/main">
            <span className="docs-flow__num">5</span>
          </span>
          <FlowNode name="~/repo" role={t("docs.runner.flowFolder")} />
        </div>
        <FlowEdge
          steps={[
            { step: 1, dir: "down" },
            { step: 4, dir: "up", manual: true },
          ]}
        />
        <FlowNode name="origin/agents" role={t("docs.runner.flowAgents")} />
        <FlowEdge
          steps={[
            { step: 2, dir: "down" },
            { step: 3, dir: "up" },
          ]}
        />
        <FlowNode name="wireal/44" role={t("docs.runner.flowLine")} />
      </div>
      <ol className="docs-flow__legend">
        {legend.map((entry) => (
          <li key={entry.step} data-manual={entry.manual ? "true" : undefined}>
            <span className="docs-flow__mark">{entry.step}</span>
            <div className="docs-flow__note">
              <code className="docs-flow__path">{entry.path}</code>
              <p>{t(`docs.runner.flowStep${entry.step}`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function Code({
  snippet,
  copied,
  onCopy,
}: {
  snippet: Snippet;
  copied: boolean;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="docs-snippet">
      <div className="docs-snippet__head">
        <span className="docs-snippet__title">{snippet.title}</span>
        {snippet.tag && (
          <span className="docs-snippet__tag">{snippet.tag}</span>
        )}
        <button type="button" className="docs-snippet__copy" onClick={onCopy}>
          {copied ? <CircleCheck size={13} /> : <Copy size={13} />}
          {copied ? t("mcpSetup.copied") : t("mcpSetup.copy")}
        </button>
      </div>
      <pre className="docs-snippet__code">
        <code>{snippet.lines.join("\n")}</code>
      </pre>
      {snippet.note && <p className="docs-snippet__note">{snippet.note}</p>}
    </div>
  );
}

export function DocsPage({
  topic,
  theme,
  onThemeChange,
}: {
  topic: DocsTopic;
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, lines: readonly string[]) => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(id);
    window.setTimeout(
      () => setCopied((current) => (current === id ? null : current)),
      1800,
    );
  };

  const mcp: Block[] = [
    {
      id: "endpoint",
      heading: t("docs.mcp.endpointHeading"),
      text: t("docs.mcp.endpointText"),
      facts: "mcp",
      snippets: [
        {
          id: "claude",
          title: "Claude Code",
          tag: t("mcpSetup.tags.cli"),
          lines: [
            `claude mcp add --scope user --transport http wireal ${endpoint}`,
          ],
          note: t("mcpSetup.claude.next"),
        },
        {
          id: "codex",
          title: "Codex CLI",
          tag: t("mcpSetup.tags.cli"),
          lines: [
            `codex mcp add wireal --url ${endpoint}`,
            "codex mcp login wireal --oauth-client-registration dcr",
          ],
          note: t("mcpSetup.codex.next"),
        },
        {
          id: "chatgpt",
          title: "ChatGPT.com",
          tag: t("mcpSetup.tags.web"),
          lines: [
            t("mcpSetup.chatgpt.settings"),
            t("mcpSetup.chatgpt.plugins", { endpoint }),
          ],
          note: t("mcpSetup.chatgpt.next"),
        },
        {
          id: "config",
          title: t("mcpSetup.other.name"),
          tag: t("mcpSetup.tags.config"),
          lines: [
            `{\n  "mcpServers": {\n    "wireal": {\n      "type": "http",\n      "url": "${endpoint}"\n    }\n  }\n}`,
          ],
          note: t("mcpSetup.other.next"),
        },
      ],
    },
    {
      id: "access",
      heading: t("docs.mcp.accessHeading"),
      text: t("mcpSetup.revokeHint"),
    },
  ];

  const runner: Block[] = [
    {
      id: "install",
      heading: t("docs.runner.installHeading"),
      text: t("docs.runner.installText"),
      facts: "runner",
      snippets: [
        {
          id: "global",
          title: t("docs.runner.globalTitle"),
          lines: ["npm install -g wireal-run", "wireal-run login"],
          note: t("docs.runner.globalNote"),
        },
        {
          id: "npx",
          title: t("docs.runner.npxTitle"),
          lines: ["npx wireal-run@latest login"],
          note: t("docs.runner.npxNote"),
        },
      ],
      notes: [t("docs.runner.needs")],
    },
    {
      id: "start",
      heading: t("docs.runner.startHeading"),
      text: t("docs.runner.startText"),
      snippets: [
        {
          id: "run",
          title: t("docs.runner.startTitle"),
          lines: ["cd path/to/your/repository", "wireal-run run"],
          note: t("docs.runner.startNote"),
        },
        {
          id: "commands",
          title: t("docs.runner.commandsTitle"),
          lines: [
            "wireal-run login      " + t("docs.runner.cmdLogin"),
            "wireal-run run        " + t("docs.runner.cmdRun"),
            "wireal-run usage      " + t("docs.runner.cmdUsage"),
            "wireal-run checks     " + t("docs.runner.cmdChecks"),
            "wireal-run rename     " + t("docs.runner.cmdRename"),
            "wireal-run status     " + t("docs.runner.cmdStatus"),
            "wireal-run unbind     " + t("docs.runner.cmdUnbind"),
            "wireal-run logout     " + t("docs.runner.cmdLogout"),
          ],
          note: t("docs.runner.commandsNote"),
        },
      ],
      notes: [
        t("docs.runner.keys"),
        t("docs.runner.checks"),
        t("docs.runner.one"),
        t("docs.runner.roster"),
        t("docs.runner.rename"),
        t("docs.runner.limits"),
      ],
    },
    {
      id: "flow",
      heading: t("docs.runner.flowHeading"),
      text: t("docs.runner.flowText"),
      flow: true,
      notes: [t("docs.runner.flowRuleMain"), t("docs.runner.flowRuleUnpushed")],
    },
  ];

  const blocks: Block[] = topic === "mcp" ? mcp : runner;

  /** Only arriving from somewhere else starts the guide at the top. Moving
   *  between pages of the guide is moving inside one document, so the sidebar
   *  stays under the cursor and the reader keeps the height they were at,
   *  rather than being sent back to the title of a page they did not ask to
   *  re-read. A hash is the one thing that still decides where to stand. */
  const arrived = useRef(false);
  useEffect(() => {
    const wanted = window.location.hash.replace("#", "");
    const node = wanted ? document.getElementById(wanted) : null;
    if (node) node.scrollIntoView({ block: "start", behavior: "instant" });
    else if (!arrived.current)
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    arrived.current = true;
  }, [topic]);

  return (
    <PublicDocument theme={theme} onThemeChange={onThemeChange}>
      <DocumentHero
        title={t(`docs.${topic}.title`)}
        lead={t(`docs.${topic}.lead`)}
      />
      <div className="landing-section docs" data-tone="raise">
        <div className="docs__body">
          <nav className="docs__nav" aria-label={t("docs.navTitle")}>
            <div className="docs__nav-sticky">
              <span className="docs__nav-title">{t("docs.navTitle")}</span>
              {docsGroups.map((group) => (
                <div className="docs__group" key={group}>
                  <ul className="docs__list">
                    {docsTopics
                      .filter((entry) => entry.group === group)
                      .map((entry) => (
                        <li key={entry.id}>
                          <Link
                            className="docs__link"
                            to={entry.href}
                            aria-current={
                              entry.id === topic ? "page" : undefined
                            }
                            data-current={entry.id === topic}
                          >
                            {t(`docs.${entry.id}.group`)}
                          </Link>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
          <article className="docs__doc" key={topic}>
            {blocks.map((block) => (
              <section className="docs__block" id={block.id} key={block.id}>
                <h2 className="docs__heading">{block.heading}</h2>
                {block.text && <p className="docs__text">{block.text}</p>}
                {block.facts === "mcp" && (
                  <div className="docs__facts">
                    <code className="docs__endpoint">{endpoint}</code>
                    <code className="docs__endpoint">{release.mcp}</code>
                  </div>
                )}
                {block.facts === "runner" && (
                  <div className="docs__facts">
                    <code className="docs__endpoint">{release.runner}</code>
                  </div>
                )}
                {block.flow && <FlowFigure />}
                {block.snippets?.map((snippet) => (
                  <Code
                    key={snippet.id}
                    snippet={snippet}
                    copied={copied === snippet.id}
                    onCopy={() => void copy(snippet.id, snippet.lines)}
                  />
                ))}
                {block.notes && (
                  <ul className="docs__notes">
                    {block.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </article>
        </div>
      </div>
    </PublicDocument>
  );
}
