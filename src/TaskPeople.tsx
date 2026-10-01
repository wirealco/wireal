import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Avatar, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { remoteWorkspace } from "./workspace-id";
import { ActivityBloub } from "./ActivityBloub";
import { backend } from "./backend";
import { formatDateTime } from "./i18n";
import {
  personPhotos,
  photoFor,
  type PersonPhotoMap,
  type PhotoPerson,
} from "./person-photos";
import { editAge, initials, personHue, type TaskPerson } from "./task-people";

/** Photos the app knows for people, keyed the way people are keyed. An activity
 *  entry carries a name and sometimes an id and nothing else, so the picture has
 *  to come from somewhere that has met the person — the signed-in account, the
 *  workspace's team — and a person nobody has a photo for wears their initials.
 *  `person-photos.ts` explains why the account id is the only key. */
export const PersonPhotos = createContext<PersonPhotoMap>({});

/** A team row, as much of it as a face needs. The server sends more; reading
 *  only these three keeps this independent of the settings panel's shape. */
type TeamRow = { id: string; name: string | null; avatarUrl: string | null };

/* The payload is whatever the API returned, so it is read rather than trusted:
   a shape this does not recognise leaves the map empty and everyone keeps their
   initials, which is exactly what they had before the team was ever fetched. */
function teamRows(payload: unknown): TeamRow[] {
  const members = (payload as { members?: unknown } | null)?.members;
  if (!Array.isArray(members)) return [];
  const rows: TeamRow[] = [];
  for (const member of members) {
    const row = member as Record<string, unknown>;
    if (typeof row?.id !== "string" || !row.id) continue;
    rows.push({
      id: row.id,
      name: typeof row.name === "string" ? row.name : null,
      avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : null,
    });
  }
  return rows;
}

/**
 * The photos for the workspace that is open, loaded once per workspace.
 *
 * The team is the only place the app can learn what anyone other than the
 * signed-in account looks like, so it is read here — once, when the workspace
 * changes, and never again until it changes — rather than by each card or each
 * face, which would ask the server the same question as many times as there are
 * people on the board. There is nothing to poll for: a photo changes about as
 * often as a person changes their face, and the next time this workspace is
 * opened the new one is read with everything else.
 *
 * Everything here is allowed to come to nothing. `backend` is null in the local
 * preview, which has no server to ask; the landing showcase renders workspace
 * panels for a workspace nobody is signed in to, which has no session to ask
 * with; and a request can simply fail. In all three cases the map stays as small
 * as it was and the faces fall back to initials, because a missing picture is a
 * cosmetic absence and not something worth putting an error in front of someone
 * — or in their console — over.
 */
export function useWorkspacePhotos(
  workspaceId: string | null | undefined,
  self: PhotoPerson | null | undefined,
): PersonPhotoMap {
  const [team, setTeam] = useState<TeamRow[]>([]);
  useEffect(() => {
    // No server, no workspace, or no account signed in: nothing to ask, and
    // nothing that would be answered if we did.
    if (!backend || !remoteWorkspace(workspaceId) || !self?.id) {
      setTeam([]);
      return;
    }
    let active = true;
    void backend.teams
      .get(workspaceId)
      .then((payload) => {
        if (active) setTeam(teamRows(payload));
      })
      .catch(() => {
        // Silence is the fallback: whoever we already know keeps their face and
        // everyone else keeps their initials.
        if (active) setTeam([]);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, self?.id]);
  const { id, avatarUrl } = self ?? {};
  return useMemo(
    () => personPhotos(team, id ? { id, avatarUrl } : null),
    [team, id, avatarUrl],
  );
}

export function PersonAvatar({
  name,
  photo,
  size = "sm",
  className = "",
  alt = name,
  "aria-hidden": ariaHidden,
}: {
  name: string;
  photo?: string | null;
  size?: "sm" | "md";
  className?: string;
  alt?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <Avatar
      size={size}
      className={`person-avatar ${className}`.trim()}
      style={{ "--person-hue": personHue(name) } as CSSProperties}
      aria-hidden={ariaHidden}
    >
      {photo && <Avatar.Image src={photo} alt={alt} />}
      <Avatar.Fallback>{initials(name)}</Avatar.Fallback>
    </Avatar>
  );
}

/** One face: a person as their photo or their initials, an agent as the
 *  avatar the activity rail draws for it. Two sizes, and a person and an agent
 *  are always the same one: small in a row of faces, large beside an entry in
 *  an activity list. */
export function PersonFace({
  person,
  size = "sm",
}: {
  person: TaskPerson;
  size?: "sm" | "lg";
}) {
  const photos = useContext(PersonPhotos);
  const sized = `task-people__face task-people__face--${size}`;
  if (person.kind === "agent")
    return (
      <span className={`${sized} task-people__face--agent`}>
        <ActivityBloub brand={person.brand} label={person.name} />
      </span>
    );
  const photo = photoFor(photos, person);
  return (
    <PersonAvatar
      name={person.name}
      photo={photo}
      size={size === "lg" ? "md" : "sm"}
      className={`${sized} task-people__face--person`}
      aria-hidden={true}
    />
  );
}

function LastEdit({ at }: { at: string }) {
  const { t } = useTranslation();
  const age = editAge(at);
  const when =
    age.unit === "date"
      ? formatDateTime(at)
      : t(`taskPeople.editAge.${age.unit}`, { count: age.count });
  return (
    <span title={formatDateTime(at)}>{t("taskPeople.lastEdit", { when })}</span>
  );
}

function PersonTip({ person }: { person: TaskPerson }) {
  const { t } = useTranslation();
  const kind =
    person.kind === "agent" ? t("taskPeople.agent") : t("taskPeople.person");
  return (
    <div className="task-people__tip">
      <span className="task-people__tip-name">{person.name}</span>
      <span className="task-people__tip-kind">{kind}</span>
      <span className="task-people__tip-fact">
        {t("taskPeople.entries", { count: person.entries })}
      </span>
      <span className="task-people__tip-fact">
        <LastEdit at={person.at} />
      </span>
    </div>
  );
}

export function TaskEditorList({ people }: { people: TaskPerson[] }) {
  const { t } = useTranslation();
  if (!people.length)
    return (
      <span className="task-editor-list__empty">{t("taskPeople.noEdits")}</span>
    );
  return (
    <div className="task-editor-list" role="list">
      {people.map((person) => {
        const brand =
          person.brand === "chatgpt"
            ? "ChatGPT"
            : person.brand === "codex"
              ? "Codex"
              : person.brand === "claude"
                ? "Claude"
                : person.name;
        return (
          <div
            className="task-editor-list__row"
            role="listitem"
            key={person.key}
          >
            <PersonFace person={person} size="lg" />
            <span className="task-editor-list__identity">
              <span className="task-editor-list__name">{person.name}</span>
              <span className="task-editor-list__kind">
                {person.kind === "agent"
                  ? t("taskPeople.agentWithBrand", { brand })
                  : t("taskPeople.person")}
              </span>
            </span>
            <span className="task-editor-list__activity">
              <span>{t("taskPeople.entries", { count: person.entries })}</span>
              <LastEdit at={person.at} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FaceTip({
  children,
  content,
  label,
}: {
  children: ReactNode;
  content: ReactNode;
  label: string;
}) {
  return (
    <Tooltip delay={250}>
      <Tooltip.Trigger className="task-people__trigger" aria-label={label}>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content placement="top">{content}</Tooltip.Content>
    </Tooltip>
  );
}

/**
 * The people on a task, as a row of faces. Nothing here is assigned: these are
 * the people and agents whose activity the task carries, which is who has
 * actually worked on it. A row past `max` faces folds the rest into a count.
 * Each face gives its name and a little more on hover, the folded count
 * names everyone it hides, and the full list is always in the accessible
 * name.
 */
export function TaskPeople({
  people,
  label = false,
  names = false,
  max = 5,
  align = "start",
  className = "",
}: {
  people: TaskPerson[];
  /** Say "Editors" before the faces. */
  label?: boolean;
  /** Write the names out after the faces. */
  names?: boolean;
  max?: number;
  /** `end` pushes the row to the far side of a flex parent, the way a card
   *  keeps its editors bottom-right. */
  align?: "start" | "end";
  className?: string;
}) {
  const { t } = useTranslation();
  if (!people.length) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const all = people.map((person) => person.name).join(", ");
  const hidden = people.slice(max);
  return (
    <div
      className={`task-people ${align === "end" ? "task-people--end" : ""} ${className}`.trim()}
      role="group"
      aria-label={t("taskPeople.list", { names: all })}
    >
      {label && (
        <span className="task-people__label">{t("taskPeople.editors")}</span>
      )}
      <span className="task-people__faces">
        {shown.map((person) => (
          <FaceTip
            key={person.key}
            label={person.name}
            content={<PersonTip person={person} />}
          >
            <PersonFace person={person} />
          </FaceTip>
        ))}
        {rest > 0 && (
          <FaceTip
            label={hidden.map((person) => person.name).join(", ")}
            content={
              <div className="task-people__tip">
                {hidden.map((person) => (
                  <span key={person.key} className="task-people__tip-name">
                    {person.name}
                  </span>
                ))}
              </div>
            }
          >
            <span className="task-people__more">+{rest}</span>
          </FaceTip>
        )}
      </span>
      {names && <span className="task-people__names">{all}</span>}
    </div>
  );
}
