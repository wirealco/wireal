import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Description,
  Input,
  Label,
  ScrollShadow,
  Skeleton,
  TextField,
  Typography,
} from "@heroui/react";
import { backend } from "./backend";
import { ChevronDown, Plus, X } from "./icons";
import { normalizeProjectPath } from "./domain";
import type { GitHubFolder } from "./github-connection";
import "./settings-card.css";

function repositoryParts(url: string): { owner: string; repo: string } | null {
  const match = url
    .trim()
    .match(/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/?$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

function breadcrumbSegments(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((part, index) => ({
    label: part,
    path: parts.slice(0, index + 1).join("/"),
  }));
}

export function ProjectFolderPicker({
  value,
  onChange,
  repositoryUrl,
  workspaceId,
  connected,
  readOnly = false,
}: {
  value: string[];
  onChange: (paths: string[]) => void;
  repositoryUrl: string;
  workspaceId: string;
  connected: boolean;
  /** A collaborator sees the owner's folders but cannot change or browse them. */
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [path, setPath] = useState("");
  const [folders, setFolders] = useState<GitHubFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const parts = repositoryParts(repositoryUrl);
  const browsable = !readOnly && connected && !!backend && !!parts;
  const owner = parts?.owner ?? "";
  const repo = parts?.repo ?? "";
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setPath("");
  }, [repositoryUrl]);

  useEffect(() => {
    if (!browsable || !backend) {
      setFolders([]);
      setLoading(false);
      setError("");
      return;
    }
    let current = true;
    setLoading(true);
    setError("");
    backend.github
      .folders(workspaceId, owner, repo, path)
      .then((result) => {
        if (!current || !alive.current) return;
        setFolders(result);
      })
      .catch((cause) => {
        if (!current || !alive.current) return;
        setFolders([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current && alive.current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [browsable, workspaceId, owner, repo, path]);

  const add = (raw: string) => {
    const next = normalizeProjectPath(raw);
    if (!next || value.includes(next)) return;
    onChange([...value, next]);
  };

  const toggle = (folderPath: string, selected: boolean) => {
    const next = normalizeProjectPath(folderPath);
    if (!next) return;
    if (selected) {
      if (!value.includes(next)) onChange([...value, next]);
      return;
    }
    onChange(value.filter((item) => item !== next));
  };

  if (readOnly)
    return (
      <fieldset className="flex min-w-0 flex-col gap-2">
        <Label>{t("projectFolders.label")}</Label>
        {value.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {value.map((folder) => (
              <Chip key={folder} size="sm" variant="soft">
                <Chip.Label className="max-w-48 truncate">{folder}/</Chip.Label>
              </Chip>
            ))}
          </div>
        ) : (
          <Typography type="body-sm">{t("githubAccess.noFolders")}</Typography>
        )}
        <Description>{t("githubAccess.ownerOnly")}</Description>
      </fieldset>
    );

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <Label>{t("projectFolders.label")}</Label>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((folder) => (
            <Chip key={folder} size="sm" variant="soft">
              <Chip.Label className="inline-flex items-center gap-1">
                <span className="max-w-48 truncate">{folder}/</span>
                <button
                  type="button"
                  className="inline-flex items-center text-muted hover:text-foreground"
                  aria-label={t("projectFolders.remove", { path: folder })}
                  onClick={() =>
                    onChange(value.filter((item) => item !== folder))
                  }
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </Chip.Label>
            </Chip>
          ))}
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <TextField
          className="min-w-0 flex-1"
          value={draft}
          onChange={setDraft}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add(draft);
            setDraft("");
          }}
        >
          <Input
            aria-label={t("projectFolders.addLabel")}
            placeholder={t("projectFolders.placeholder")}
            maxLength={200}
          />
        </TextField>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          isDisabled={!normalizeProjectPath(draft)}
          onPress={() => {
            add(draft);
            setDraft("");
          }}
        >
          <Plus size={14} />
          {t("projectFolders.add")}
        </Button>
      </div>
      {browsable && (
        <Card
          variant="secondary"
          className="settings-card settings-card--tight"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-0.5">
            <Button
              size="sm"
              variant="tertiary"
              className="h-6 px-2 text-xs"
              onPress={() => setPath("")}
            >
              {repo}
            </Button>
            {breadcrumbSegments(path).map((segment) => (
              <span
                key={segment.path}
                className="flex items-center gap-0.5 text-xs text-muted"
              >
                <span aria-hidden>/</span>
                <Button
                  size="sm"
                  variant="tertiary"
                  className="h-6 px-2 text-xs"
                  onPress={() => setPath(segment.path)}
                >
                  {segment.label}
                </Button>
              </span>
            ))}
          </div>
          {loading && (
            <div className="flex flex-col gap-1.5" aria-hidden>
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-6 rounded-md" />
              ))}
            </div>
          )}
          {!loading && error && (
            <Typography type="body-xs" color="muted">
              {t("projectFolders.browseError")}
            </Typography>
          )}
          {!loading && !error && folders.length === 0 && (
            <Typography type="body-xs" color="muted">
              {t("projectFolders.empty")}
            </Typography>
          )}
          {!loading && !error && folders.length > 0 && (
            <ScrollShadow
              orientation="vertical"
              variant="fade"
              hideScrollBar
              className="flex max-h-[21rem] min-w-0 flex-col gap-0.5"
            >
              {folders.map((folder) => (
                <div
                  key={folder.path}
                  className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1"
                >
                  <Checkbox
                    className="min-w-0 flex-1"
                    aria-label={folder.path}
                    isSelected={value.includes(
                      normalizeProjectPath(folder.path),
                    )}
                    onChange={(selected) => toggle(folder.path, selected)}
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <Label className="min-w-0 truncate text-sm">
                        {folder.name}/
                      </Label>
                    </Checkbox.Content>
                  </Checkbox>
                  <Button
                    size="sm"
                    variant="tertiary"
                    isIconOnly
                    className="shrink-0"
                    aria-label={t("projectFolders.open", { name: folder.name })}
                    onPress={() => setPath(folder.path)}
                  >
                    <ChevronDown size={14} className="-rotate-90" />
                  </Button>
                </div>
              ))}
            </ScrollShadow>
          )}
        </Card>
      )}
      <Description>{t("projectFolders.description")}</Description>
    </fieldset>
  );
}
