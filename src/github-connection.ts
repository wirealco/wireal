export type GitHubRole = "owner" | "collaborator";

export type GitHubRepository = {
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

export type GitHubStatus =
  | {
      configured: boolean;
      connected: false;
      role: GitHubRole;
    }
  | {
      configured: true;
      connected: true;
      role: GitHubRole;
      account: string;
      accountType: "User" | "Organization";
      connectedAt: string;
      connectedBy: { id: string; name: string };
      /**
       * For the owner, every repository the installation reaches. For a
       * collaborator (or any token), only the ones the owner chose for this
       * workspace; the installation fields below are then absent.
       */
      repositories: GitHubRepository[];
      installationId?: number;
      repositorySelection?: "all" | "selected";
      manageUrl?: string;
    };

export type GitHubFolder = {
  name: string;
  path: string;
};

export type GitHubConnectResult = {
  url: string;
};

export type GitHubInstallationChoice = {
  id: number;
  account: string;
  accountType: "User" | "Organization";
  connectedElsewhere: boolean;
};

export type GitHubInstallationChoices = {
  installations: GitHubInstallationChoice[];
  installUrl: string;
};

export type GitHubNotice =
  "connected" | "requested" | "error" | { kind: "choose"; ticket: string };

export type ProxyCommitError = {
  kind:
    | "invalid"
    | "not-connected"
    | "unauthorized"
    | "not-found"
    | "rate-limited"
    | "network";
  status?: number;
};

export type ProxyCommitFile = {
  path: string;
  previousPath?: string;
  status:
    | "added"
    | "modified"
    | "removed"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";
  additions: number;
  deletions: number;
};

export type ProxyCommitResult =
  | {
      url: string;
      owner: string;
      repo: string;
      sha: string;
      committedAt: string | null;
      additions: number;
      deletions: number;
      files: ProxyCommitFile[];
    }
  | {
      url: string;
      error: ProxyCommitError;
    };
