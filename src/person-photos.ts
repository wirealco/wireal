import type { TaskPerson } from "./task-people";

/**
 * Faces for the people a task remembers.
 *
 * A task carries activity, and an activity entry names its author with the
 * account id behind the name, which is what `personOf` turns into a `user:<id>`
 * key. The entry carries no photo, so the picture has to come from somewhere
 * that has actually met the person: the signed-in account for themselves, and
 * the workspace's team list for everyone else.
 *
 * That is what this map is, keyed by account id the same way people are keyed.
 * A display name is never a key here. Names are chosen, and two accounts can
 * choose the same one, so lending a face to whoever answers to a name would put
 * one person's picture on another person's work.
 */
export type PersonPhotoMap = Record<string, string | undefined>;

/** Everything this map needs to know about someone: a team row and the
 *  signed-in account both narrow to these two fields. */
export type PhotoPerson = {
  id?: string | null;
  avatarUrl?: string | null;
};

/**
 * Build the map the faces read, from the team of the workspace that is open
 * plus the signed-in account.
 *
 * The account goes in last and wins, because it is the freshest thing the app
 * holds: the team list is whatever the server said when the workspace was
 * opened, while the account is the profile this session is signed in as. Change
 * your picture in settings and the team row behind you is immediately stale, so
 * the account's own value — including the absence of one, which is what
 * removing your picture looks like — overwrites it rather than losing to it.
 */
export function personPhotos(
  members: readonly PhotoPerson[],
  self?: PhotoPerson | null,
): PersonPhotoMap {
  const photos: PersonPhotoMap = {};
  const add = (person: PhotoPerson, fresh: boolean) => {
    if (!person.id) return;
    const photo = (person.avatarUrl ?? "").trim() || undefined;
    if (photo) photos[`user:${person.id}`] = photo;
    else if (fresh) delete photos[`user:${person.id}`];
  };
  for (const member of members) add(member, false);
  if (self) add(self, true);
  return photos;
}

/**
 * The photo for one person, or nothing if the app has never met them.
 *
 * The id is the only thing asked for. An account the workspace does not know
 * wears its initials, and so does an agent: agents are not people, have no
 * account, and their branch draws the mark their brand wears instead.
 */
export function photoFor(
  photos: PersonPhotoMap,
  person: Pick<TaskPerson, "key">,
): string | undefined {
  if (!person.key.startsWith("user:")) return undefined;
  return photos[person.key];
}
