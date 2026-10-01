import type { Activity } from "./domain";
import {
  agentBrand,
  agentDisplayName,
  type AgentBrand,
} from "./agent-identity";

export type ActivityAgentBrand = AgentBrand;

export function activityAgentBrand(
  activity: Activity,
): ActivityAgentBrand | null {
  if (activity.authorType !== "ai") return null;
  return agentBrand(activity.author);
}

export function activityAuthorName(activity: Activity): string {
  return activity.authorType === "ai"
    ? agentDisplayName(activity.author)
    : activity.author;
}
