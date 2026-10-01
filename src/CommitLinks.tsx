import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Label, Link, Typography } from "@heroui/react";
import { ArrowUpRight, GitCommitHorizontal, Plus, X } from "./icons";
import {
  agentBranchOf,
  agentSettings,
  mergePolicyOf,
  normalizeCommitUrl,
  projectRepository,
  taskRepository,
  updateTask,
  type Activity,
  type Task,
} from "./domain";
import { repository, useWorkspace } from "./store";
import { Field, IconButton } from "./ui";
import { awaitingMerge, compareUrl, lineBranch, mergedCommit } from "./runners";
import { requestMerge, useFlowRequests } from "./runners-client";

function MergeControl({ task }: { task: Task }) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const workspaceId = repository.getActiveWorkspaceId();
  const { requests, reload } = useFlowRequests(workspaceId);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const settings = agentSettings(state);
  const policy = mergePolicyOf(settings);
  const branch = lineBranch(task);
  if (policy !== "merge") {
    const url = compareUrl(
      taskRepository(state, task),
      branch,
      agentBranchOf(settings),
    );
    if (!url) return null;
    return (
      <Link
        href={url}
        target="_blank"
        rel="noreferrer"
        className="commit-merge__compare text-xs"
      >
        {t("agents.openCompare")}
        <ArrowUpRight size={11} />
      </Link>
    );
  }
  const pending = asking || awaitingMerge(task, requests);
  return (
    <span className="commit-merge">
      {!!error && (
        <Typography type="body-xs" className="text-danger">
          {error}
        </Typography>
      )}
      <Button
        size="sm"
        variant="secondary"
        className="commit-merge__button"
        isDisabled={pending}
        onPress={() => {
          setError("");
          setAsking(true);
          void requestMerge(workspaceId, task.id)
            .then(() => reload())
            .catch((cause: unknown) => {
              setAsking(false);
              setError(cause instanceof Error ? cause.message : String(cause));
            });
        }}
      >
        {pending ? t("agents.merging") : t("agents.merge")}
      </Button>
    </span>
  );
}

export function CommitLinks({
  task,
  author,
}: {
  task: Task;
  /** Who is linking: the entry the task keeps names them. */
  author: Pick<Activity, "author" | "authorType" | "authorId">;
}) {
  const state = useWorkspace();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const latest = task.commitUrls.at(-1) ?? "";
  const mergeable = task.status === "done" && !!latest && !mergedCommit(task);
  let error = "";
  try {
    if (draft) normalizeCommitUrl(draft);
  } catch {
    error = "Use an exact GitHub commit URL with the full 40-character SHA.";
  }
  const projects = state.projects
    .filter(
      (project) =>
        task.projectIds.includes(project.id) &&
        projectRepository(state, project),
    )
    .map((project) => ({
      ...project,
      repositoryUrl: projectRepository(state, project),
    }));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Label>GitHub</Label>
        <Typography type="body-xs" color="muted">
          {task.commitUrls.length}{" "}
          {task.commitUrls.length === 1 ? "commit" : "commits"}
        </Typography>
        <Button
          size="sm"
          variant="tertiary"
          className="ml-auto"
          onPress={() => {
            setDraft("");
            setAdding((current) => !current);
          }}
        >
          {adding ? <X size={14} /> : <Plus size={14} />}
          {adding ? "Cancel" : "Link"}
        </Button>
      </div>

      {projects.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={project.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs"
            >
              {project.name}
              <ArrowUpRight size={11} />
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1">
        {task.commitUrls.map((url) => {
          const parts = new URL(url).pathname.split("/");
          return (
            <div
              key={url}
              className="flex items-center gap-2 rounded-lg px-1 py-0.5"
            >
              <GitCommitHorizontal size={14} className="shrink-0 text-muted" />
              <Typography
                type="body-xs"
                color="muted"
                className="min-w-0 truncate"
              >
                {parts[1]}/{parts[2]}
              </Typography>
              <Link
                href={url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open commit ${parts[4]}`}
                className="ml-auto font-mono text-xs"
              >
                {parts[4].slice(0, 8)}
                <ArrowUpRight size={11} />
              </Link>
              {mergeable && url === latest && <MergeControl task={task} />}
              <IconButton
                label={`Remove commit ${parts[4]}`}
                onPress={() =>
                  repository.commit((current) =>
                    updateTask(
                      current,
                      task.id,
                      {
                        commitUrls: task.commitUrls.filter(
                          (commit) => commit !== url,
                        ),
                      },
                      `Unlinked GitHub commit ${parts[4]}`,
                      author,
                    ),
                  )
                }
              >
                <X size={14} />
              </IconButton>
            </div>
          );
        })}
        {!task.commitUrls.length && (
          <Typography type="body-xs" color="muted">
            No commits linked
          </Typography>
        )}
      </div>

      {adding && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft || error) return;
            const url = normalizeCommitUrl(draft);
            if (!task.commitUrls.includes(url))
              repository.commit((current) =>
                updateTask(
                  current,
                  task.id,
                  { commitUrls: [...task.commitUrls, url] },
                  `Linked GitHub commit ${url.split("/").at(-1) ?? ""}`.trim(),
                  author,
                ),
              );
            setDraft("");
            setAdding(false);
          }}
        >
          <Field
            label="Commit URL"
            value={draft}
            onChange={setDraft}
            placeholder="https://github.com/owner/repo/commit/..."
            description="Use the exact URL with its full SHA."
            error={error}
            maxLength={500}
            autoFocus
          />
          <Button
            type="submit"
            size="sm"
            variant="primary"
            className="self-end"
            isDisabled={!draft || !!error}
          >
            <GitCommitHorizontal size={14} />
            Link commit
          </Button>
        </form>
      )}
    </section>
  );
}
