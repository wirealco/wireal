export type AgentBrand = "chatgpt" | "codex" | "claude";

export function agentBrand(name: string): AgentBrand | null {
  // Prefer a named product over a vendor: OpenAI alone doesn't identify Codex.
  if (/\bcodex\b/i.test(name)) return "codex";
  if (/\bchatgpt\b/i.test(name)) return "chatgpt";
  if (/\b(claude|clode|anthropic)\b/i.test(name)) return "claude";
  return null;
}

const brandNames: Record<AgentBrand, string> = {
  chatgpt: "ChatGPT",
  codex: "Codex",
  claude: "Claude",
};

export function agentQualifier(name: string): string {
  const match = /^\s*(?:claude|codex|chatgpt)\s*·\s*(.+?)\s*$/i.exec(name);
  return match ? match[1].slice(0, 60) : "";
}

export function agentDisplayName(name: string): string {
  const brand = agentBrand(name);
  if (!brand) return name.trim().slice(0, 80) || "Agent";
  const qualifier = agentQualifier(name);
  return qualifier ? `${brandNames[brand]} · ${qualifier}` : brandNames[brand];
}
