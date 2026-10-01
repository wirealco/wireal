import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { backend } from "./backend";
import { NewWorkspaceDialog } from "./MapEditor";
import { PublicHeader } from "./public-chrome";
import { PublicPage } from "./PublicPage";
import type { ResolvedTheme, ThemePreference } from "./theme";
import { WorkspaceInvitations } from "./WorkspaceInvitations";

type Waiting = {
  id: string;
  workspaceName: string;
  invitedBy: { name: string };
};

function isWaiting(value: unknown): value is Waiting {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.workspaceName === "string"
  );
}

export function WorkspaceStartPage({
  theme,
  onThemeChange,
  onSignOut,
}: {
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
  onSignOut: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [checked, setChecked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(
    () => location.pathname.replace(/\/+$/, "") === "/invitations",
  );

  const check = useCallback(async () => {
    if (!backend) {
      setChecked(true);
      return;
    }
    try {
      const rows = await backend.teams.inbox();
      setWaiting(Array.isArray(rows) ? rows.filter(isWaiting) : []);
    } catch {
      setWaiting([]);
    }
    setChecked(true);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const first = waiting[0];
  const invited = checked && first !== undefined;
  return (
    <PublicPage theme={theme} onThemeChange={onThemeChange}>
      <Card className="public-page__card w-full" variant="secondary">
        <Card.Header className="flex flex-col items-start gap-6">
          <PublicHeader
            theme={theme}
            onThemeChange={onThemeChange}
            docs={false}
          />
          <div>
            <Card.Title>
              {invited
                ? t("workspaceStart.invitedTitle", {
                    count: waiting.length,
                    name: first.invitedBy?.name || t("team.unnamed"),
                    workspace: first.workspaceName,
                  })
                : t("workspaceStart.title")}
            </Card.Title>
            <Card.Description>
              {invited
                ? t("workspaceStart.invitedHelp")
                : t("workspaceStart.help")}
            </Card.Description>
          </div>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={invited ? "primary" : "secondary"}
              onPress={() => setInboxOpen(true)}
            >
              {t("workspaceStart.invitations")}
            </Button>
            <Button
              size="sm"
              variant={invited ? "secondary" : "primary"}
              onPress={() => setCreating(true)}
            >
              {t("workspaceStart.create")}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              className="ms-auto"
              onPress={() => void onSignOut()}
            >
              {t("navigation.signOut")}
            </Button>
          </div>
        </Card.Content>
      </Card>
      {creating && <NewWorkspaceDialog onClose={() => setCreating(false)} />}
      {inboxOpen && (
        <WorkspaceInvitations
          onClose={() => {
            setInboxOpen(false);
            if (location.pathname.replace(/\/+$/, "") === "/invitations")
              navigate("/app", { replace: true });
            void check();
          }}
        />
      )}
    </PublicPage>
  );
}
