import { Fragment, useRef, useState } from "react";
import {
  Button,
  Description,
  Dropdown,
  Header,
  Kbd,
  Separator,
  Tooltip,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { IconButton } from "./ui";
import {
  Book,
  ChevronDown,
  History,
  LogOut,
  Moon,
  PanelLeftOpen,
  Plus,
  Settings2,
  Sun,
  Network,
  UserCog,
  Mail,
} from "./icons";
import { FluidOrb } from "./FluidOrb";
import { useCommandKey } from "./platform";
import { PersonAvatar } from "./TaskPeople";
import type { Project } from "./domain";
import type { OrbSettings } from "./orb-settings";
import type { WorkspaceUser } from "./AuthGate";
import type { ThemePreference } from "./theme";
import type { WorkspaceInfo } from "./store";

type Props = {
  collapsed: boolean;
  projects: Project[];
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string;
  projectId: string;
  mapName: string;
  mapOrb: OrbSettings;
  user: WorkspaceUser;
  theme: ThemePreference;
  invitationCount?: number;
  onSignOut?: () => Promise<void>;
  onAccountSettings?: () => void;
  onInvitations?: () => void;
  onProject: (id: string) => void;
  onReorderProjects: (orderedIds: string[]) => void;
  onCreate: () => void;
  onCreateWorkspace: () => void;
  onWorkspace: (id: string) => void;
  onPreferences: () => void;
  onMapSettings: () => void;
  onToggle: () => void;
  /* Phones keep the collapsed rail on screen instead of hiding the sidebar, so
     the rail carries the button that opens the full menu itself. */
  onExpand?: () => void;
  onResize: (width: number) => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
  onThemeChange: (theme: ThemePreference) => void;
};

function UserAvatar({
  user,
  invitationCount,
}: {
  user: WorkspaceUser;
  invitationCount?: number;
}) {
  const avatar = (
    <PersonAvatar
      name={user.name}
      photo={user.avatarUrl}
      className="workspace-sidebar__avatar"
    />
  );
  if (!invitationCount) return avatar;
  return (
    <span className="workspace-sidebar__avatar-wrap">
      {avatar}
      <span className="workspace-sidebar__badge" aria-hidden="true" />
    </span>
  );
}

export function ThemeToggle({
  theme,
  onThemeChange,
  onBeforeChange,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onBeforeChange?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="workspace-theme-toggle"
      role="group"
      aria-label={t("theme.colorTheme")}
    >
      {(
        [
          ["light", t("theme.light"), <Sun key="light" size={14} />],
          ["dark", t("theme.dark"), <Moon key="dark" size={14} />],
        ] as const
      ).map(([value, label, icon]) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={theme === value}
          data-active={theme === value || undefined}
          onClick={() => {
            onBeforeChange?.();
            window.requestAnimationFrame(() => onThemeChange(value));
          }}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

export function WorkspaceSidebar(props: Props) {
  const { t } = useTranslation();
  const { collapsed } = props;
  const usesCommandKey = useCommandKey();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    moved: boolean;
  } | null>(null);
  const ignoreRailClick = useRef(false);
  // Project drag state. `drop` is the row the pointer is over; which side the
  // marker sits on follows from the direction of travel.
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const order = props.projects.map((project) => project.id);
  const move = (id: string, to: number) => {
    const from = order.indexOf(id);
    if (from < 0 || to < 0 || to >= order.length || to === from) return;
    const next = [...order];
    next.splice(to, 0, next.splice(from, 1)[0]);
    props.onReorderProjects(next);
  };
  const item = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    active = false,
    extra?: React.ReactNode,
    // Anchors a first-run tour step to this row.
    tour?: string,
  ) => (
    <Tooltip delay={250}>
      <Tooltip.Trigger className="workspace-sidebar__tooltip-trigger">
        <Button
          variant="tertiary"
          className="workspace-sidebar__item"
          aria-label={label}
          aria-current={active ? "page" : undefined}
          data-tour={tour}
          onPress={action}
        >
          <span className="workspace-sidebar__icon">{icon}</span>
          <span className="workspace-sidebar__label">{label}</span>
          {extra}
        </Button>
      </Tooltip.Trigger>
      {collapsed && (
        <Tooltip.Content placement="right">{label}</Tooltip.Content>
      )}
    </Tooltip>
  );
  const menuRow = ({
    id,
    icon,
    title,
    description,
    shortcut,
    trailing,
    href,
    danger,
  }: {
    id: string;
    icon: React.ReactNode;
    title: string;
    description: string;
    shortcut?: string[];
    trailing?: React.ReactNode;
    href?: string;
    danger?: boolean;
  }) => (
    <Dropdown.Item
      id={id}
      textValue={title}
      variant={danger ? "danger" : undefined}
      className="workspace-sidebar__menu-item"
      href={href}
      target={href ? "_blank" : undefined}
      rel={href ? "noreferrer" : undefined}
      aria-keyshortcuts={
        shortcut
          ? shortcut
              .map((key) =>
                key === "command" ? "Meta" : key === "Ctrl" ? "Control" : key,
              )
              .join("+")
          : undefined
      }
    >
      <span className="workspace-sidebar__menu-icon">{icon}</span>
      <span className="workspace-sidebar__menu-text">
        <span data-slot="label">{title}</span>
        <Description>{description}</Description>
      </span>
      {shortcut && (
        <Kbd variant="light" className="workspace-sidebar__menu-shortcut">
          {shortcut.map((key) =>
            key === "command" ? (
              <Kbd.Abbr key={key} keyValue="command" />
            ) : (
              <Kbd.Content key={key}>{key}</Kbd.Content>
            ),
          )}
        </Kbd>
      )}
      {trailing}
    </Dropdown.Item>
  );
  return (
    <aside
      ref={sidebarRef}
      className="workspace-sidebar"
      data-collapsed={collapsed}
      aria-label={t("navigation.sidebar")}
    >
      <div className="workspace-sidebar__header">
        <img
          className="app-logo workspace-sidebar__logo workspace-sidebar__wordmark"
          src="/logo.png"
          alt="Wireal"
          draggable={false}
        />
        <img
          className="app-logo workspace-sidebar__logo workspace-sidebar__mark"
          src="/favicon.png"
          alt="Wireal"
          draggable={false}
        />
      </div>
      {props.onExpand && (
        /* The mark keeps the top-left corner; the toggle sits under it, above
           the orbs, and out of the scrolling list. The same IconButton the
           desktop header uses, so the two sidebar toggles are one control. */
        <div className="workspace-sidebar__rail-actions">
          <IconButton
            label={t("navigation.openSidebarMenu")}
            className="workspace-sidebar__expand"
            onPress={props.onExpand}
          >
            <PanelLeftOpen size={18} />
          </IconButton>
        </div>
      )}
      <div className="workspace-sidebar__content">
        <nav
          aria-label={t("navigation.workspaceNavigation")}
          className="workspace-sidebar__group workspace-sidebar__workspace"
        >
          <div className="workspace-sidebar__group-label">
            {t("navigation.workspace")}
          </div>
          {/* The workspace row is the whole-workspace view; its projects hang
              off it, so neither repeats the other's orb. */}
          {item(
            props.mapName,
            <FluidOrb
              settings={props.mapOrb}
              size={16}
              label={t("navigation.color", { name: props.mapName })}
            />,
            () => props.onProject("all"),
            props.projectId === "all",
          )}
          <div className="workspace-sidebar__children">
            <ul
              className="workspace-sidebar__projects"
              aria-label={t("navigation.projects")}
            >
              {props.projects.map((project, index) => (
                <li key={project.id}>
                  <Tooltip delay={250}>
                    <Tooltip.Trigger className="workspace-sidebar__tooltip-trigger">
                      <button
                        type="button"
                        className="workspace-sidebar__project"
                        draggable
                        title={
                          collapsed ? undefined : t("navigation.reorderProject")
                        }
                        aria-label={project.name}
                        aria-current={
                          props.projectId === project.id ? "page" : undefined
                        }
                        data-dragging={drag === project.id || undefined}
                        data-drop={
                          drop === project.id
                            ? order.indexOf(drag ?? "") < index
                              ? "after"
                              : "before"
                            : undefined
                        }
                        onClick={() => props.onProject(project.id)}
                        onDragStart={(event) => {
                          setDrag(project.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "text/plain",
                            project.name,
                          );
                        }}
                        onDragOver={(event) => {
                          if (!drag || drag === project.id) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDrop(project.id);
                        }}
                        onDragLeave={() =>
                          setDrop((current) =>
                            current === project.id ? null : current,
                          )
                        }
                        onDrop={(event) => {
                          event.preventDefault();
                          if (drag) move(drag, index);
                          setDrag(null);
                          setDrop(null);
                        }}
                        onDragEnd={() => {
                          setDrag(null);
                          setDrop(null);
                        }}
                        // Dragging always needs a keyboard equivalent.
                        onKeyDown={(event) => {
                          if (
                            !event.altKey ||
                            (event.key !== "ArrowUp" &&
                              event.key !== "ArrowDown")
                          )
                            return;
                          event.preventDefault();
                          move(
                            project.id,
                            index + (event.key === "ArrowUp" ? -1 : 1),
                          );
                        }}
                      >
                        <FluidOrb
                          settings={project.orb}
                          size={16}
                          label={t("navigation.color", { name: project.name })}
                        />
                        <span className="workspace-sidebar__label">
                          {project.name}
                        </span>
                      </button>
                    </Tooltip.Trigger>
                    {collapsed && (
                      <Tooltip.Content placement="right">
                        {project.name}
                      </Tooltip.Content>
                    )}
                  </Tooltip>
                </li>
              ))}
            </ul>
            {/* The drawer copy of the sidebar only mounts while it is open and
                the rail comes first in the DOM, so the tour's querySelector
                lands on the visible row either way. */}
            {item(
              t("navigation.newProject"),
              <Plus />,
              props.onCreate,
              false,
              undefined,
              "project",
            )}
          </div>
        </nav>
        {/* Other workspaces are siblings, not entries hidden inside this one. */}
        <nav
          aria-label={t("navigation.otherWorkspaces")}
          className="workspace-sidebar__group"
        >
          <div className="workspace-sidebar__group-label">
            {t("navigation.workspaces")}
          </div>
          {props.workspaces
            .filter((workspace) => workspace.id !== props.activeWorkspaceId)
            .map((workspace) => (
              <Fragment key={workspace.id}>
                {item(
                  workspace.name,
                  <FluidOrb
                    settings={workspace.workspace.map.orb}
                    size={16}
                    label={t("navigation.color", { name: workspace.name })}
                  />,
                  () => props.onWorkspace(workspace.id),
                )}
              </Fragment>
            ))}
          {item(
            t("navigation.newWorkspace"),
            <Plus />,
            props.onCreateWorkspace,
          )}
        </nav>
      </div>
      <div className="workspace-sidebar__footer">
        <div className="workspace-sidebar__footer-row">
          <Dropdown isOpen={userMenuOpen} onOpenChange={setUserMenuOpen}>
            {/* Dropdown.Trigger, not a Button: it carries HeroUI's own
                trigger press-scale, transitions and focus ring. */}
            <Dropdown.Trigger
              className="workspace-sidebar__user flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-default"
              aria-label={
                props.invitationCount
                  ? `${t("common.userMenu")} — ${t("invitations.pendingCount", { count: props.invitationCount })}`
                  : t("common.userMenu")
              }
              data-tour="mcp"
            >
              <UserAvatar
                user={props.user}
                invitationCount={props.invitationCount}
              />
              <span className="workspace-sidebar__label text-sm font-medium text-foreground">
                {props.user.name}
              </span>
              <ChevronDown className="workspace-sidebar__user-chevron ml-auto size-3 text-muted" />
            </Dropdown.Trigger>
            <Dropdown.Popover
              placement={collapsed ? "right bottom" : "top start"}
              className="workspace-sidebar__popover"
            >
              <div className="workspace-sidebar__account">
                <UserAvatar user={props.user} />
                <div className="min-w-0">
                  <div className="truncate">{props.user.name}</div>
                  <div className="truncate text-xs text-muted">
                    {props.user.email}
                  </div>
                </div>
              </div>
              <div className="workspace-sidebar__theme-row">
                <span>{t("theme.appearance")}</span>
                <ThemeToggle
                  theme={props.theme}
                  onThemeChange={props.onThemeChange}
                  onBeforeChange={() => setUserMenuOpen(false)}
                />
              </div>
              <Dropdown.Menu
                aria-label={t("common.userMenu")}
                onAction={(key) => {
                  if (key === "account") props.onAccountSettings?.();
                  if (key === "invitations") props.onInvitations?.();
                  if (key === "map") props.onMapSettings();
                  if (key === "preferences") props.onPreferences();
                  if (key === "signout") void props.onSignOut?.();
                }}
              >
                <Dropdown.Section>
                  <Header>{t("navigation.menuSettings")}</Header>
                  {menuRow({
                    id: "preferences",
                    icon: <Settings2 />,
                    title: t("navigation.preferences"),
                    description: t("navigation.preferencesDescription"),
                    shortcut: usesCommandKey ? ["command", ","] : ["Ctrl", ","],
                  })}
                  {props.onAccountSettings &&
                    menuRow({
                      id: "account",
                      icon: <UserCog />,
                      title: t("navigation.accountSettings"),
                      description: t("navigation.accountSettingsDescription"),
                    })}
                  {menuRow({
                    id: "map",
                    icon: <Network />,
                    title: t("navigation.workspaceSettings"),
                    description: t("navigation.workspaceSettingsDescription"),
                  })}
                </Dropdown.Section>
                <Dropdown.Section>
                  <Header>{t("navigation.menuElsewhere")}</Header>
                  {props.onInvitations &&
                    menuRow({
                      id: "invitations",
                      icon: <Mail />,
                      title: t("team.inbox"),
                      description: t("team.inboxDescription"),
                      trailing: !!props.invitationCount && (
                        <span className="workspace-sidebar__count">
                          {props.invitationCount}
                        </span>
                      ),
                    })}
                  {menuRow({
                    id: "docs",
                    icon: <Book />,
                    title: t("navigation.docs"),
                    description: t("navigation.docsDescription"),
                    href: "/docs",
                  })}
                  {menuRow({
                    id: "changelog",
                    icon: <History />,
                    title: t("navigation.changelog"),
                    description: t("navigation.changelogDescription"),
                    href: "/changelog",
                  })}
                </Dropdown.Section>
                {props.onSignOut && <Separator />}
                {props.onSignOut && (
                  <Dropdown.Section>
                    <Header>{t("navigation.menuDanger")}</Header>
                    {menuRow({
                      id: "signout",
                      icon: <LogOut />,
                      title: t("navigation.signOut"),
                      description: t("navigation.signOutDescription"),
                      danger: true,
                    })}
                  </Dropdown.Section>
                )}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>
      <button
        type="button"
        className="workspace-sidebar__rail"
        aria-label={t("navigation.resizeSidebar")}
        title={t("navigation.resizeSidebarHint")}
        tabIndex={-1}
        onPointerDown={(event) => {
          if (collapsed || !sidebarRef.current) return;
          resizeRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: sidebarRef.current.getBoundingClientRect().width,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          props.onResizeStart();
        }}
        onPointerMove={(event) => {
          const resize = resizeRef.current;
          if (!resize || resize.pointerId !== event.pointerId) return;
          const delta = event.clientX - resize.startX;
          if (Math.abs(delta) > 2) resize.moved = true;
          props.onResize(
            Math.min(384, Math.max(192, resize.startWidth + delta)),
          );
        }}
        onPointerUp={(event) => {
          const resize = resizeRef.current;
          if (!resize || resize.pointerId !== event.pointerId) return;
          ignoreRailClick.current = resize.moved;
          resizeRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          props.onResizeEnd();
        }}
        onPointerCancel={() => {
          resizeRef.current = null;
          props.onResizeEnd();
        }}
        onClick={() => {
          if (ignoreRailClick.current) {
            ignoreRailClick.current = false;
            return;
          }
          props.onToggle();
        }}
      />
    </aside>
  );
}
