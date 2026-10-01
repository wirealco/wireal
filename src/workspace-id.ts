/**
 * The board an account holds before it holds one of its own.
 *
 * It is a workspace in every way the app cares about — it opens, it is edited,
 * it is saved — and in no way the server does: there is no row behind it and its
 * id is not an id. Anything asked of the server with it in hand is answered with
 * a fault, so the question is not asked.
 */
export const localWorkspaceId = "local-default";

export function remoteWorkspace(id: string | null | undefined): id is string {
  return Boolean(id) && id !== localWorkspaceId;
}
