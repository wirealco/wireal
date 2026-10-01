export type BriefProject = {
  name: string;
  repositoryUrl: string;
  folders: string[];
};
export type BriefUpstream = {
  referenceId: string;
  name: string;
  summary: string;
};
export type Brief = {
  referenceId: string;
  name: string;
  objective: string;
  projects: BriefProject[];
  upstream: BriefUpstream[];
  review?: { text: string; by: string };
};
export type Workspace = {
  worktree: string;
  branch: string;
  deps?: boolean;
  shots?: boolean;
};

export function composePrompt(
  brief: Brief,
  workspace: Workspace,
  style = "",
): string {
  const sections: string[] = [
    `Task ${brief.referenceId}: ${brief.name}`,
    brief.objective.trim() || "No objective was written for this task.",
  ];
  if (brief.review)
    sections.push(
      [
        "Sent back for review",
        `This task was already finished and ${brief.review.by} sent it back. Read what the earlier pass did before you touch it, fix what is named here, and do not start the task over.`,
        brief.review.text.trim(),
      ].join("\n"),
    );
  if (brief.projects.length)
    sections.push(
      [
        "Projects",
        ...brief.projects.map((project) =>
          [
            `- ${project.name}`,
            project.repositoryUrl ? ` (${project.repositoryUrl})` : "",
            project.folders.length ? ` owns ${project.folders.join(", ")}` : "",
          ].join(""),
        ),
      ].join("\n"),
    );
  if (brief.upstream.length)
    sections.push(
      [
        "What earlier tasks reported",
        ...brief.upstream.map(
          (task) => `- ${task.referenceId} ${task.name}: ${task.summary}`,
        ),
      ].join("\n"),
    );
  const task = brief.referenceId;
  sections.push(
    [
      "Rules",
      `- Work only in ${workspace.worktree} (branch ${workspace.branch}). Commit with a message starting "Task ${task}:".`,
      ...(workspace.deps
        ? [
            "- node_modules is shared with other agents: never run npm install, npm ci or npm update. Name a missing package under Blocked.",
          ]
        : []),
      ...(workspace.shots
        ? [
            "- To see a page run npm run shot -- docs privacy --width=1440 (no leading slash; --dark, --full, --scroll=bottom). Read only the shots you need; never install a browser.",
          ]
        : []),
      "- If .wireal/peers.md exists it says who else is working and on which files; read it before editing shared files.",
      "- Separate work you notice: propose_task. Stuck partway: add_task_activity kind blocker, then report.",
      `- Finish with exactly one report call on task ${task}: done = what changed; where = files; commit = full SHA from git rev-parse HEAD; next = what remains, or none; blocked = only if blocked. Plain text.`,
      "- Never change the task's status, never narrate progress over MCP, never ask questions. A call that fails twice goes under Blocked. After the report, stop.",
    ].join("\n"),
  );
  if (style.trim()) sections.push(`Working style: ${style.trim()}`);
  return sections.join("\n\n");
}
