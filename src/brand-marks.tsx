/** The marks the integration chips wear. Three of them already exist inside the
 *  app — Claude, Codex and ChatGPT have activity avatars, so the chip borrows
 *  those rather than inventing a second face for the same product — and GitHub
 *  and the MCP plug come from the app's icon
 *  set. Only Cursor has no mark anywhere here, so it gets one: a small
 *  isometric cube, drawn in currentColor. Nothing is fetched and nothing is an
 *  image; every mark is inline SVG that inherits the chip's colour. */
import { ActivityBloub } from "./ActivityBloub";
import { GitHubMark, Plug } from "./icons";
import type { ActivityAgentBrand } from "./activity-author";

export type BrandMarkProps = { size?: number };

/** The agent avatar at chip size. It is decorative here: the chip already says
 *  the product's name, so the mark is hidden from a reader rather than read
 *  out a second time. */
function AgentMark({
  brand,
  label,
}: {
  brand: ActivityAgentBrand;
  label: string;
}) {
  return (
    <span className="landing-chip__bloub" aria-hidden="true">
      <ActivityBloub brand={brand} label={label} />
    </span>
  );
}

export function ClaudeCodeMark() {
  return <AgentMark brand="claude" label="Claude" />;
}

export function CodexMark() {
  return <AgentMark brand="codex" label="Codex" />;
}

export function ChatGptMark() {
  return <AgentMark brand="chatgpt" label="ChatGPT" />;
}

export function GitHubBrandMark({ size = 16 }: BrandMarkProps) {
  return <GitHubMark size={size} aria-hidden="true" focusable="false" />;
}

/** Anything else that speaks MCP: a plug, because the point of the chip is that
 *  the client is not named. */
export function McpClientMark({ size = 16 }: BrandMarkProps) {
  return <Plug size={size} aria-hidden="true" focusable="false" />;
}
