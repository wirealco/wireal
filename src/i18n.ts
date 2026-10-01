import i18n from "i18next";
import { timeZone, zoneHour12 } from "./time-zone";
import { initReactI18next } from "react-i18next";

import { landingShowcaseCopy } from "./landing-showcase-copy";

export const supportedLanguages = ["en"] as const;
export type AppLanguage = (typeof supportedLanguages)[number];

const LANGUAGE_KEY = "wireal.language";

function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "en";
}

function initialLanguage(): AppLanguage {
  return "en";
}

const resources = {
  en: {
    translation: {
      authPopup: {
        label: "Log in or create an account",
        close: "Close sign-in",
      },
      common: {
        done: "Done",
        email: "Email",
        password: "Password",
        userMenu: "User menu",
        workspaceUnavailable: "Your workspace could not be loaded",
        workspaceUnavailableHelp:
          "Wireal reached your account but not your workspaces, so there is nothing to open yet. Your work is safe in the cloud — check your connection and try again.",
        tryAgain: "Try again",
      },
      workspaceStart: {
        title: "You don't have a workspace yet",
        help: "A workspace holds your projects, your tasks and the agents that work on them. Make one of your own, or check whether someone has invited you to theirs.",
        invitedTitle_one: "{{name}} invited you to {{workspace}}",
        invitedTitle_other: "You have {{count}} invitations waiting",
        invitedHelp:
          "Accept an invitation to open that workspace, or make one of your own to work on the side.",
        invitations: "Invitations",
        create: "New workspace",
      },
      theme: {
        appearance: "Appearance",
        colorTheme: "Color theme",
        light: "Light theme",
        dark: "Dark theme",
        switchTo: "Switch to {{theme}} theme",
      },
      navigation: {
        sidebar: "Workspace sidebar",
        openSidebarMenu: "Open sidebar menu",
        workspaceNavigation: "Workspace navigation",
        workspace: "Workspace",
        projects: "Projects",
        newProject: "New project",
        otherWorkspaces: "Other workspaces",
        workspaces: "Workspaces",
        newWorkspace: "New workspace",
        menuSettings: "Settings",
        menuElsewhere: "Elsewhere",
        menuDanger: "Danger",
        preferences: "Preferences",
        preferencesDescription: "Theme and the board's look.",
        accountSettings: "Account settings",
        accountSettingsDescription: "Profile, email, password and apps.",
        workspaceSettings: "Workspace settings",
        workspaceSettingsDescription: "Name, orb, projects and labels.",
        docs: "Docs",
        docsDescription: "Documentation of MCP & the runner.",
        changelog: "Changelog",
        changelogDescription: "What shipped and when.",
        labelSettings: "Label settings",
        signOut: "Sign out",
        signOutDescription: "End this session on this device.",
        resizeSidebar: "Resize sidebar",
        resizeSidebarHint: "Drag to resize; click to collapse",
        reorderProject: "Drag, or Alt + Arrow, to reorder",
        color: "{{name}} color",
      },
      preferences: {
        title: "Preferences",
        appearanceDescription: "How Wireal looks on this device.",
        whiteboardBackground: "Whiteboard background",
        whiteboardBackgroundDescription:
          "The animated fluid field behind the board, and how the cards answer the cursor. Turn either off if it feels slow or busy. Saved on this device.",
        fluidBackground: "Animated fluid background",
        cardDrift: "Cards drift with the cursor",
        gettingStarted: "Getting started",
        gettingStartedDescription:
          "Replay the guided tour: workspace, project, task, wiring, views and MCP setup.",
        showTour: "Show getting started tour",
      },
      account: {
        title: "Account settings",
        profile: "Profile",
        profileDescription: "Shown on your tasks and activity.",
        yourProfile: "Your profile",
        chooseImage: "Choose profile image",
        uploadImage: "Upload image",
        imageHelp: "JPEG, PNG, WebP, or GIF. Max 2 MB.",
        imageTypeError: "Choose a JPEG, PNG, WebP, or GIF image.",
        imageSizeError: "Profile images must be 2 MB or smaller.",
        imageUpdated: "Profile image updated.",
        displayName: "Display name",
        yourName: "Your name",
        saveProfile: "Save profile",
        displayNameUpdated: "Display name updated.",
        emailAddress: "Email address",
        emailDescription:
          "Changing your email sends a confirmation link to the new and current addresses.",
        updateEmail: "Update email",
        confirmationSent:
          "Confirmation link sent. Check both inboxes to finish the change.",
        changePassword: "Change password",
        setPassword: "Set a password",
        passwordHelp: "Use at least 15 characters.",
        passwordDescription:
          "Add a password so you can also sign in without a provider.",
        newPassword: "New password",
        passwordUpdated: "Password updated.",
        connectedAccounts: "Connected accounts",
        connectedAccountsDescription:
          "Sign in faster by linking a provider to this account.",
        connected: "Connected",
        disconnect: "Disconnect",
        connect: "Connect",
        emailPassword: "Email & password",
        manualLinking:
          "Enable Manual Linking in your Wireal Auth settings to connect more providers.",
        disconnected: "Disconnected {{provider}}.",
        connectedMcp: "Connected MCP clients",
        connectedMcpDescription:
          "Clients you approved to access this Wireal workspace.",
        mcpClient: "MCP client",
        revoke: "Revoke",
        revoked: "Revoked access for {{client}}.",
        noMcpClients: "No MCP clients have access.",
      },
      tour: {
        progress: "Getting started · {{current}} of {{total}}",
        agentLabel: "Wireal guide",
        workspaceTitle: "Set up your workspace",
        workspaceDescription:
          "Name it, choose Coding or Everyday, link a repository and invite teammates. Everything here is shared with your agents.",
        projectTitle: "Add your first project",
        projectDescription:
          "Projects live in the sidebar. Each one groups tasks and tells agents which repository or folders to focus on.",
        taskTitle: "Give it a first task",
        taskDescription:
          "Describe an outcome, not a to-do. The task becomes the shared brief for you and your agents.",
        wireTitle: "Wire tasks together",
        wireDescription:
          "Use the arrow tools to draw dependencies and subtasks between tasks. The order you draw is the order agents follow.",
        viewsTitle: "Two ways to see the work",
        viewsDescription:
          "Whiteboard is the canvas, and List groups tasks by status, solution or label. The search button finds anything.",
        end: "End tour",
        next: "Next",
        done: "Done",
        loadError: "The getting started state could not be loaded.",
        saveError: "The getting started state could not be saved.",
      },
      changelog: {
        title: "What changed",
        lead: "What arrived in Wireal, and when.",
      },
      docs: {
        navTitle: "Documentation",
        mcp: {
          group: "MCP",
          nav: "Connect an agent",
          title: "Connect an agent over MCP",
          lead: "Point a client you already use — Claude Code, the Codex CLI, ChatGPT — at your workspace. It reads your projects and tasks, and reports what it changes.",
          endpointHeading: "One endpoint, one approval",
          endpointText:
            "Add the Wireal server to your client, then approve access in the browser. Every client below talks to the same endpoint.",
          accessHeading: "Taking access back",
        },
        runner: {
          group: "Runner",
          nav: "Run agents on your machine",
          title: "Run agents on your machine",
          lead: "The runner claims the tasks your workspace makes ready and runs each one in its own git worktree, on your own machine. Nothing of your code leaves it.",
          installHeading: "Install it",
          installText:
            "The runner is an npm package. Install it once to have the command everywhere, or run it straight from npx to try it without keeping anything.",
          globalTitle: "Install the command",
          globalNote:
            "Signs this machine in. The browser opens for consent and the session is remembered for thirty days.",
          npxTitle: "Or run it without installing",
          npxNote:
            "npx fetches the package into its cache and runs it. @latest checks for a newer one each time.",
          needs:
            "Needs Node 22 or newer, git, and the agent CLIs you want it to host.",
          startHeading: "Start it in your repository",
          startText:
            "Run it in the folder the agents should work in. The first run binds that folder to a workspace and remembers it.",
          startTitle: "Start the runner",
          startNote:
            'Add --workspace "Name" the first time if your account has more than one workspace.',
          keys: "It draws a live screen: each CLI's usage, every agent's task and timer, and a feed of what just happened. + and - add or remove an agent, c and x add a Claude Code or Codex one, p pauses, 1-9 attaches to an agent's screen, ctrl-g detaches, q quits. The machine is held awake until you quit, and --allow-sleep starts without that hold.",
          checks:
            'A branch merges only once this folder\'s checks pass. They are set on this machine and nowhere else, so nobody who shares the workspace can name a command that runs on your computer: wireal-run checks "npm test" "npm run build".',
          one: "One runner to a folder. A second start names the one holding it and stops, so a task is never claimed twice; --force takes the folder from it.",
          roster:
            "The runner brings its own agents, one per CLI it finds, and names them. In the app they show under Crew, inside the runner's card; the gear there sets what happens to a finished branch.",
          rename:
            "The runner takes its terminal's name, or the folder's. wireal-run rename gives it another, and a running one picks it up on its next heartbeat.",
          limits:
            "wireal-run usage prints the five-hour and seven-day window each CLI has left, without starting an agent. The crew pill on the board shows the same, and an agent over the pause limit waits instead of taking a task.",
          flowHeading: "How the branches stay in sync",
          flowText:
            "The runner keeps three branches level: the default branch, the agent branch every line is cut from, and the branch one line works on. Of these, only the promotion waits for you.",
          flowMain: "the default branch",
          flowAgents: "the agent branch",
          flowLine: "one line's branch",
          flowFolder: "your folder",
          flowStep1:
            "The agent branch catches up with the default branch when a worktree opens and once a minute after that. Nothing is checked out, so no folder is touched.",
          flowStep2:
            "Every line is cut from the agent branch as it stands, so an agent starts on what was pushed a minute ago rather than where the branch was left.",
          flowStep3:
            "A finished line is rebased onto the agent branch and lands as one commit. A rebase that conflicts becomes a merge commit; if that conflicts too the branch is left where it is and the task keeps a blocker.",
          flowStep4:
            "Promote is the one step nobody takes for you. One merge commit naming every task it carries goes to the default branch and to the agent branch, so the two end level.",
          flowStep5:
            "The folder follows what it tracks, and only forward: clean and behind is a fast-forward, uncommitted changes are left alone, and a folder that has moved on its own is named rather than pulled at.",
          flowRuleMain:
            "The default branch moves on two things only: a push of your own and a promotion. No agent writes to it.",
          flowRuleUnpushed:
            "Commits that are not pushed are outside all of this, because every branch is cut from origin. The runner says so when the folder is holding some.",
          commandsTitle: "wireal-run",
          commandsNote:
            "Useful flags on run: --agents <n> caps how many work at once (0 only reports in), --repo <path> works on another folder, --once takes one round and stops.",
          cmdLogin: "Sign in to Wireal on this machine",
          cmdRun: "Claim ready tasks and run an agent on each",
          cmdUsage: "Show what is left of each agent's limits",
          cmdChecks: "Show or set the checks a merge waits for here",
          cmdRename: "Rename this folder's runner",
          cmdStatus: "Show this folder's runner binding",
          cmdUnbind: "Remove this folder's runner binding",
          cmdLogout: "Forget the saved session",
        },
      },
      mcpSetup: {
        copy: "Copy",
        copied: "Copied",
        revokeHint:
          "Access is tied to your Wireal account. Revoke a client later from Account settings → Connected MCP clients.",
        tags: {
          web: "Web",
          cli: "CLI",
          config: "Config",
        },
        chatgpt: {
          settings: "Settings → Security and login → Developer mode: On",
          plugins: "Plugins → + → MCP server URL: {{endpoint}}",
          next: "Connect your Wireal account, start a new chat, then enable Wireal from the tools menu.",
        },
        claude: {
          next: "Run /mcp, choose wireal, then Authenticate. The browser opens for consent.",
        },
        codex: {
          next: "The login command opens Wireal authorization in your browser.",
        },
        other: {
          name: "Any other MCP client",
          next: "Cursor, VS Code, Zed and others read a file in this shape. Put it where your client keeps its MCP servers, then start the client and approve access in the browser.",
        },
      },
      landing: {
        title: "Draw the wires, the work follows",
        openWorkspace: "Open your workspace",
        openShort: "Open",
        hero: {
          scene:
            "A plan of six tasks: an agent takes them in turn and leaves a branch behind",
          lead: "Plan the work as tasks and the dependencies between them.",
          rows: {
            machine: "A runner on your own machine claims whatever is ready",
            branch: "Each task is worked on a branch of its own",
            card: "Every step of it reports back on the card",
          },
          secondary: "Look inside",
        },
        openSource: {
          heading: "Open source, yours to run",
          lead: "Wireal is AGPL-3.0. Use it here at wireal.co, or run the whole of it, board, API and MCP server, on a machine of your own.",
          github: "View on GitHub",
          guide: "Self-hosting guide",
          codeLabel: "The commands that run Wireal on your own server",
          codeNote: "on any Linux server with Docker",
          orRead: "or read the code",
        },
        integrations: {
          heading: "Works with",
          chips: {
            claudeCode: "Claude Code",
            codex: "Codex",
            chatgpt: "ChatGPT",
            anyClient: "Any MCP client",
            github: "GitHub",
          },
        },
        team: {
          heading: "Work as a team",
          lead: "Invite the people you work with, seat their agents on the same board, and read one history for both.",
          rows: {
            board: "One board for people and agents",
            invites: "Invitations by email or GitHub",
            roles: "Owner and collaborator roles",
          },
          editors: "Editors",
          activity: "Recent activity",
          feed: {
            claimed: "Codex · Pepper claimed Tokenize card fields",
            seated: "Mr. Banana seated Juno on pip-air",
            branch: "Claude · Sol opened wireal/1",
            merged: "Merged into main as 7c1f0a9",
            sentBack: "Captain Marmalade sent the price chip back",
            reported: "ChatGPT verified the totals on settleRefund",
          },
        },
        kinds: {
          heading: "Two kinds of workspace",
          coding: {
            repository: "A GitHub repository",
            revision: "Reports pinned to exact commits",
            lines: "The files each one touched",
          },
          everyday: {
            any: "Any project at all",
            none: "No repository to connect",
            notes: "Notes kept as versions",
          },
        },
        tools: {
          heading: "Every agent talks to one server",
          lead: "To an agent, the MCP server is the whole of Wireal: the board, the tasks, what happened to them. One URL, one approval in the browser, and the runner on your own machine hosts the CLIs that use it.",
          points: {
            server: {
              title: "One URL",
              body: "{{host}} over Streamable HTTP with OAuth 2.1. {{count}} tools, and no key to paste anywhere.",
            },
            clients: {
              title: "Any client",
              body: "Claude Code, the Codex CLI, ChatGPT. Whatever speaks MCP connects the same way.",
            },
            machine: {
              title: "Your machine",
              body: "The runner hosts the agents' CLIs in your folder, so what they read and write is yours, not ours.",
            },
          },
          terminalLabel:
            "A terminal adding the Wireal server to Claude Code, then starting the runner",
        },
        close: {
          heading: "Start with one workspace",
          privacy:
            "Private by default: nothing leaves it until you invite someone in, and the agents work in your folder rather than ours.",
        },
        showcase: landingShowcaseCopy.en,
      },
      public: {
        github: "Wireal on GitHub",
        home: "Wireal home",
        docs: "Docs",
        changelog: "Changelog",
        privacy: "Privacy",
        terms: "Terms",
        footer: {
          product: "Product",
          getStarted: "Get started",
          company: "Company",
          connect: "Connect",
          copyright: "© {{year}} Wireal",
          links: {
            lookInside: "Look inside",
            lines: "How a line works",
            team: "Work as a team",
            workspaces: "Two kinds of workspace",
            integrations: "Open source",
            tools: "Tools",
            openWorkspace: "Open your workspace",
            createAccount: "Create an account",
            docs: "Setup guide",
            connectAgent: "Connect an agent",
            changelog: "Changelog",
            contact: "Contact",
            privacy: "Privacy",
            terms: "Terms",
            github: "GitHub",
            email: "Email",
          },
        },
      },
      auth: {
        connect: "Connect Wireal",
        createAccount: "Create your account",
        welcomeBack: "Welcome back",
        connectDescription:
          "Sign in before approving access for your MCP client.",
        registerDescription: "Register to open your private workspace.",
        loginDescription: "Sign in to open your workspace.",
        passwordHelp: "Use at least 15 characters.",
        login: "Log in",
        register: "Register",
        createAccountAction: "Create account",
        authentication: "Authentication",
        or: "or",
        continueWith: "Continue with {{provider}}",
        loginWithEmail: "Log in with email",
        registerWithEmail: "Register with email",
        name: "Name",
        confirmEmail: "Check your email to confirm your account, then log in.",
        resendVerification: "Didn't get it? Send the email again",
        verificationResent:
          "If that account is still waiting to be confirmed, another email is on its way.",
      },
      status: {
        proposed: "Proposed",
        todo: "To do",
        doing: "Doing",
        done: "Done",
      },
      workspace: {
        closeSidebar: "Close sidebar",
        openSidebar: "Open sidebar",
        openRepository: "Open GitHub repository",
        editProject: "Edit project",
        openSearch: "Open search",
        search: "Search",
        newTask: "New task",
        undo: "Undo",
        redo: "Redo",
        projectView: "Project view",
        whiteboard: "Whiteboard",
        list: "List",
        commits: "Commits",
        closeViewControls: "Close view controls",
        openViewControls: "Open view controls",
        linkDuplicateOrCycle:
          "Those tasks can't be linked — it would duplicate a dependency or create a cycle.",
        linkSubtaskCycle:
          "That subtask link can't be made — it would create a cycle.",
        shortcuts: "Board shortcuts",
        shortcutSelectBox: "Draw a box around cards",
        shortcutSelectAdd: "Add or remove one card",
        shortcutSelectMove: "Drag any selected card to move them all",
        shortcutFitView: "Fit the canvas",
        shortcutArrangeTasks: "Arrange what is on screen",
        shortcutDelete: "Delete the selection",
        selectionCount_one: "{{count}} selected",
        selectionCount_other: "{{count}} selected",
        clearSelection: "Clear",
        searchTasks: "Search tasks",
        searchTasksPlaceholder: "Search tasks…",
        filterStatus: "Filter status",
        allStatuses: "All statuses",
        groupTasks: "Group tasks",
        groupByStatus: "Group by status",
        groupBySolution: "Group by solution",
        groupByLabel: "Group by label",
        relatedTasks: "Related tasks",
        addSubtask: "Add subtask",
        openTaskDetails: "Open task details",
        deleteTask: "Delete task",
        arrangeTasks: "Arrange tasks",
        arrangeSelection: "Arrange selection",
        noMatchingTasks: "No matching tasks",
        noTasks: "No tasks yet",
        firstProject: "Create your first project to start mapping tasks.",
        clearFilters: "Clear filters",
        createProject: "Create project",
      },
      workspaceKind: {
        label: "Workspace type",
        heading: "What will you make room for?",
        coding: "Coding",
        codingDescription:
          "Software: a repository, its commits, and what agents report about them.",
        everyday: "Everyday",
        everydayDescription:
          "Plan a trip, grow an idea, get life in order — no code in sight.",
      },
      mapEditor: {
        title: "Workspace settings",
        deleteTitle: "Delete workspace?",
        deleteConfirm: "Delete {{name}} and all of its projects and tasks?",
        deleteWarning: "This cannot be undone after it syncs to Wireal.",
        deleteThenOpens: "Wireal opens {{name}} afterwards.",
        deleteThenNothing:
          "This is your last workspace. Afterwards your account has none, and Wireal takes you to the screen where you can make one or accept an invitation.",
        delete: "Delete workspace",
        cancel: "Cancel",
        sectionWorkspace: "Workspace",
        sectionWorkspaceNote:
          "What this workspace is called and what it holds.",
        sectionLook: "Look",
        sectionLookNote: "The orb that stands for this workspace.",
        workspaceName: "Workspace name",
        enterName: "Enter a workspace name.",
        monorepo: "Monorepo",
        monorepoOn:
          "One repository for the workspace. Each project owns subfolders of it, and a project can own several.",
        monorepoOff:
          "Off: each project carries its own repository, set on the project.",
        workspaceRepository: "Workspace repository",
        repositoryDescription:
          "Every project in this workspace lives in this repository.",
        repositoryError: "Use https://github.com/owner/repository",
        projects: "Projects",
        projectsDescription: "Customize projects in this workspace.",
        newProject: "New project",
        editProject: "Edit {{name}}",
        noProjects: "No projects yet.",
        labelsDescription: "The labels every task in this workspace can wear.",
        editLabels: "Edit labels",
        noLabels: "No labels yet.",
        save: "Save workspace",
        newWorkspace: "New workspace",
        createWorkspace: "Create workspace",
      },
      github: {
        title: "GitHub",
        localPreview:
          "GitHub connects once the app runs against the Wireal backend.",
        afterCreate:
          "Connect GitHub from workspace settings once this workspace exists.",
        notConfigured: "GitHub App is not configured on this server.",
        connectDescription:
          "Connect GitHub so every member can see the files a commit touched, and so each project can pick its repository and folders.",
        connectDescriptionMonorepo:
          "Connect GitHub so every member can see the files a commit touched, and so each project can pick folders of the workspace repository.",
        connect: "Connect GitHub",
        scopeWarning:
          "Choose \u201cOnly select repositories\u201d on GitHub. Everyone you invite to this workspace can see the names of the repositories you grant and browse their folders, so grant the ones this board works on and no more.",
        askOwner: "Ask the workspace owner to connect GitHub.",
        organization: "Organization",
        personal: "Personal account",
        allRepositories: "All repositories",
        allRepositoriesWarning:
          "Every member of this workspace can see the names of all of them and browse their folders. Narrow the installation on GitHub to the repositories this board works on.",
        selectedRepositories_one: "{{count}} selected repository",
        selectedRepositories_other: "{{count}} selected repositories",
        connectedBy: "Connected by {{name}} · {{when}}",
        manage: "Manage on GitHub",
        disconnect: "Disconnect",
        confirmDisconnect: "Disconnect?",
        confirm: "Confirm",
        cancel: "Cancel",
        chooseRepository: "Choose a repository",
        otherUrl: "Other URL…",
        otherUrlLabel: "Repository URL",
        noticeConnected: "GitHub connected.",
        noticeRequested:
          "Installation requested. An organization owner has to approve it.",
        noticeError: "GitHub connection failed. Try again.",
        noticeChoose: "Choose the account this workspace should read.",
        connectedElsewhere: "already connected to another workspace",
        use: "Use",
        installElsewhere: "Install on another account",
      },
      projectFolders: {
        label: "Folders",
        description:
          "Leave this empty and the project claims no folders: commits are attributed by project name instead.",
        add: "Add",
        addLabel: "Folder path",
        placeholder: "apps/web",
        remove: "Remove {{path}}",
        open: "Open {{name}}",
        browseError: "Could not list folders. You can still type a path.",
        empty: "No subfolders here.",
      },
      team: {
        title: "Workspace team",
        open: "Team and invitations",
        members: "Team",
        inbox: "Invitations",
        inboxDescription: "Workspaces waiting for your answer.",
        unnamed: "Unnamed member",
        noEmail: "No email available",
        owner: "Owner",
        collaborator: "Collaborator",
        remove: "Remove",
        leave: "Leave workspace",
        invite: "Invite a collaborator",
        method: "Invite by",
        email: "Email",
        githubUsername: "GitHub username",
        githubId: "GitHub ID",
        target: "Exact address or ID",
        createLink: "Create private link",
        copyLink: "Copy",
        copied: "Copied",
        copyFailed: "Could not copy the invitation link.",
        revoke: "Revoke",
        accept: "Accept",
        decline: "Decline",
        empty: "No pending invitations.",
        inviteAction: "Invite",
        you: "You",
        confirmRemove: "Remove?",
        confirmLeave: "Leave?",
        confirm: "Confirm",
        cancel: "Cancel",
        pending: "Pending invitations",
        expires: "Expires {{when}}",
      },
      invitations: {
        subtitle: "Workspaces you've been invited to join.",
        notFound:
          "That invitation isn't addressed to this account, or it has expired.",
        invitedBy: "Invited by {{name}} · {{kind}}",
        expires: "Expires {{when}}",
        members_one: "{{count}} member",
        members_other: "{{count}} members",
        accepted: "You're in. Opening {{name}}…",
        emptyTitle: "No invitations",
        emptyHelp:
          "When someone invites you to their workspace, it shows up here.",
        notice: "{{name}} invited you to {{workspace}}",
        pendingCount_one: "{{count}} pending invitation",
        pendingCount_other: "{{count}} pending invitations",
      },
      labels: {
        label: "Label",
        new: "New label",
        name: "Label name",
        color: "Color",
        preview: "Preview",
        delete: "Delete label",
        cancel: "Cancel",
        save: "Save label",
        invalid: "Invalid label",
      },
      editor: {
        deleteProjectTitle: "Delete project?",
        deleteProjectConfirm:
          "Delete {{name}}? Tasks shared with other projects will be kept. This can be undone.",
        cancel: "Cancel",
        deleteProject: "Delete project",
        editProject: "Edit project",
        newProject: "New project",
        newSubtask: "New subtask",
        newTask: "New task",
        projectName: "Project name",
        newTaskName: "New task name",
        enterName: "Enter a name.",
        sectionProject: "Project",
        sectionCode: "Code",
        sectionLook: "Look",
        sectionLookNote: "The orb that stands for this project.",
        projectColor: "Project color",
        githubRepository: "GitHub repository",
        inheritedRepository: "{{repository}} — inherited from this workspace.",
        setWorkspaceRepository:
          "Set the workspace repository in Workspace settings.",
        switchRepositoryMode:
          "Switch this workspace to multiple repositories to assign one per project.",
        projectRepositoryDescription:
          "Used by this project. Projects with the same repository share reports.",
        chooseProject: "Choose at least one project.",
        taskStatus: "New task status",
        taskObjective: "Task objective",
        objectivePlaceholder: "Describe the outcome this task should achieve…",
        githubCommit: "GitHub commit",
        commitDescription: "Optional exact commit URL (full SHA)",
        invalidCommit:
          "Use a GitHub commit URL with the full 40-character SHA.",
        saveChanges: "Save changes",
        createProject: "Create project",
        createSubtask: "Create subtask",
        createTask: "Create task",
        projects: "Projects",
        addProject: "Add {{name}} project",
        removeProject: "Remove {{name}} project",
        labels: "Labels",
        noLabels: "Create labels in Label settings before assigning them.",
        removeLabel: "Remove label {{name}}",
        orbPreview: "Orb preview",
        palette: "{{name}} palette",
        randomOrb: "Random orb",
        color: "Color {{number}}",
        colorCode: "Color {{number}} code",
        speed: "Speed",
        distortion: "Distortion",
        swirl: "Swirl",
        phase: "Phase",
      },
      taskList: {
        task: "Task",
        solutions: "Solutions",
        labels: "Labels",
        commit: "Commit",
        status: "Status",
        editors: "Editors",
        related: "Related",
        none: "None",
        groupTasks: "{{name}} tasks",
        statusFor: "Status for {{name}}",
        openCommit: "Open commit for {{name}}",
      },
      taskPeople: {
        editors: "Editors",
        list: "Editors: {{names}}",
        person: "Person",
        agent: "Agent",
        agentWithBrand: "Agent · {{brand}}",
        entries_one: "{{count}} activity entry",
        entries_other: "{{count}} activity entries",
        lastEdit: "Last edit {{when}}",
        noEdits: "No edits yet",
        editAge: {
          now: "just now",
          minute: "{{count}} min ago",
          hour: "{{count}} hr ago",
          day: "{{count}} d ago",
        },
      },
      taskInspector: {
        details: "Details",
        editName: "Edit task name",
        taskName: "Task name",
        objective: "Objective",
        activity: "Activity",
        addActivity: "Add activity",
        saveActivity: "Save activity",
        deleteActivity: "Delete activity by {{author}}",
      },
      review: {
        sendBack: "Send back",
        title: "Send this work back",
        intro:
          "The task stays done and keeps its history. What you write here reaches the agent the way the objective does, and the card wears the review until the agent comes back.",
        agent: "Send it to",
        anyoneAutomatic:
          "No agent chosen. The task goes back in the queue and the first free agent takes it.",
        anyoneDirected:
          "No agent chosen. Drop an agent onto the card to hand it to one.",
        directed: "{{name}} is held for the task and picks it up next.",
        thatAgent: "That agent",
        noRoster:
          "No agents are on this workspace's roster yet, so this will wait until one is.",
        wrong: "What is wrong with it",
        wrongPlaceholder:
          "Name what the earlier pass got wrong, and what right looks like...",
        send: "Send it back",
        cancel: "Cancel",
        open: "Sent back",
        openTo: "Sent back to {{name}}",
        banner: "{{name}} sent this back",
        to: "→ {{name}}",
      },
      taskFiles: {
        mapLabel: "Map of the files this task's commits changed",
        noCommits:
          "No commits linked yet. Link a GitHub commit on a task and the files it changed draw themselves here.",
        commits_one: "{{count}} commit",
        commits_other: "{{count}} commits",
        files_one: "{{count}} file",
        files_other: "{{count}} files",
        loading: "Reading commits from GitHub…",
        errorUnauthorized:
          "GitHub would not share this commit through the workspace connection.",
        errorNotConnected: "GitHub is not connected to this workspace.",
        errorNotFound:
          "GitHub does not have this commit yet. It is probably still local: push the branch and try again.",
        errorRateLimited: "GitHub's rate limit is spent. Try again later.",
        errorNetwork: "GitHub could not be reached.",
        errorInvalid: "This commit link is not a GitHub commit URL.",
        openSettings: "Workspace settings",
        retry: "Try again",
        legendAdded: "added",
        legendModified: "modified",
        legendRemoved: "removed",
        legendRenamed: "renamed",
        legendWire: "changed by the chosen commit",
        inCommits_one: "in {{count}} commit",
        inCommits_other: "in {{count}} commits",
        openOnGitHub: "GitHub",
        openInEditor: "VS Code",
        editorRoot: "Local folder for {{repo}}",
        editorRootSave: "Open",
        closeFile: "Close file",
        openTask: "Open task",
        openCanvas: "Commits canvas",
        failedSummary_one: "{{count}} commit could not be read from GitHub.",
        failedSummary_other: "{{count}} commits could not be read from GitHub.",
        latest: "latest",
        groupLabel: "Group files",
        groupProjects: "Projects",
        groupPaths: "Paths",
        groupTypes: "Types",
        groupOther: "Other",
        groupNoExtension: "No extension",
      },
      canvas: {
        selectMode: "Select by dragging",
        selectModeOn: "Back to panning",
        zoomIn: "Zoom in",
        zoomOut: "Zoom out",
        fitView: "Fit view",
        cancelDependency: "Cancel dependency arrow",
        drawDependency:
          "Draw dependency arrow — click a task, then the task it blocks",
        cancelSubtask: "Cancel subtask arrow",
        drawSubtask:
          "Draw subtask arrow — click the parent task, then the subtask",
        clickBlockedTask: "Now click the task it blocks",
        clickSubtask: "Now click the subtask",
        clickFirstTask: "Click the task that must come first",
        clickParentTask: "Click the parent task",
        dependency: "Dependency",
        subtask: "Subtask",
        delete: "Delete",
        related: "Related",
        subtasks: "Subtasks",
        crossProject: "Cross-project",
        openCommit: "Open commit for {{name}}",
        dropDependency: "Drop a dependency arrow here",
        dragArrow: "Drag an arrow to another task",
      },
      compass: {
        toggle: "How flows work",
        title: "How flows work",
        flow: "flow",
        flowCaption: "tasks run left to right along their wires",
        order: "launch order",
        orderCaption: "rows run top to bottom",
        proposed: "proposed, waiting for you",
        working: "an agent working",
        dependency: "dependency",
      },
      relations: {
        subtasks: "Subtasks",
        subtask: "Subtask",
        new: "New",
        parent: "Parent",
        removeParent: "Remove parent {{name}}",
        reopen: "Reopen {{name}}",
        complete: "Complete {{name}}",
        detach: "Detach subtask {{name}}",
        noSubtasks: "No subtasks",
        attachExisting: "Attach existing task",
        chooseTask: "Choose a task",
        dependencies: "Dependencies",
        direction: "prerequisite → follow-up",
        needs: "Needs",
        unblocks: "Unblocks",
        thisTask: "This task",
        removeRelation: "Remove relation to {{name}}",
        noDependencies: "No dependency arrows",
        addDependency: "Add dependency",
        dependsOn: "Depends on…",
        addFollowUp: "Add follow-up",
        unblocksChoice: "Unblocks…",
      },
      activity: {
        kinds: {
          change: "Change",
          discovery: "Discovery",
          decision: "Decision",
          verification: "Verification",
          blocker: "Blocker",
          review: "Review",
          report: "Report",
        },
      },
      agents: {
        rules: "Rules",
        rulesNote: "how every agent works",
        openRules: "Open rules",
        openRulesFor: "Open rules for {{workspace}}",
        openCrew: "Open crew",
        backToCrew: "Back to crew",
        close: "Close",
        summaryWorking: "{{working}} of {{total}} working",
        summaryOnline_one: "1 runner online",
        summaryOnline_other: "{{count}} runners online",
        usageHeading: "Usage",
        workingHeading: "Working",
        readyHeading: "Ready",
        allReady_one: "1 agent ready",
        allReady_other: "{{count}} agents ready",
        pill: {
          working: "working",
          paused: "paused",
          offline: "No runner",
          workingOf: "{{working}} of {{total}} working",
          workingLabel: "{{working}} of {{total}} agents working",
          pausedLabel: "{{working}} of {{total}} agents working, paused",
          kindWeek: "{{brand}} {{percent}}% of the week",
          weekWord: "week",
          news_one: "1 update while you were away",
          news_other: "{{count}} updates while you were away",
        },
        ring: {
          fiveHour: "5h",
          week: "week",
          fiveHourName: "{{brand}} 5-hour window",
          weekName: "{{brand}} weekly window",
          used: "{{name}}: {{percent}}% used",
          unknown: "{{name}}: not reported",
          resets: "Resets {{time}}, in {{countdown}}",
          in: "in {{countdown}}",
        },
        cardWorking: "{{count}} working",
        offlineSeen: "Offline · seen {{when}}",
        facts: "Runner",
        details: "Details",
        behindChip: "{{count}} to pull",
        runnerActions: "More for {{name}}",
        connectNote: "One command on any machine with Claude Code or Codex.",
        connectCommand: "Run this in the folder the agents should work in",
        connectGlobal: "Or install it globally",
        waitingForRunner: "Waiting for your runner…",
        leftOverNote: "Their runners are gone or stopped.",
        autoEmpty:
          "No agents yet. Start wireal-run on a machine with Claude Code or Codex and it brings its own agents, named for you.",
        connectRunner: "Connect a runner",
        dock: {
          peopleHeading: "People in their own CLI",
          noTask: "No task named",
        },
        title: "Crew",
        sectionLines: "Lines",
        sectionLinesNote:
          "A line is the branch an agent opens for one task, and what becomes of it.",
        sectionLimits: "Limits",
        sectionLimitsNote: "Ceilings every runner keeps for every agent.",
        unknownWorkspace: "Unknown workspace",
        agentPaused: "Paused",
        agentOffline: "Offline",
        runnerGone: "Its runner is gone or stopped",
        leftOver_one: "1 agent is left over",
        leftOver_other: "{{count}} agents are left over",
        removeLeftOver: "Remove",
        removeAgent: "Remove {{name}}",
        agentLocked: "Locked to it",
        workingIn: "In {{workspace}}",
        elsewhereGroup: "Other workspaces",
        notWired: "No runner is connected to this workspace.",
        setupGuide: "How to start one",
        cancel: "Cancel",
        unnamedRunner: "Runner",
        unknownHost: "Unknown machine",
        unknownOwner: "Unknown owner",
        connected: "Connected",
        offline: "Offline",
        machine: "Machine",
        owner: "Owner",
        workspace: "Workspace",
        lastSeen: "Last seen",
        secondsAgo: "{{seconds}} s ago",
        never: "never",
        spend: "Spend",
        agentIdle: "Idle",
        forget: "Forget",
        testing: "Waiting for an answer…",
        answered: "Answered in {{seconds}} s",
        noAnswer: "No answer after {{seconds}} s",
        copy: "Copy",
        copied: "Copied",
        clearValue: "Clear {{name}}",
        lease: "Hold a task for",
        leaseHint:
          "The agent keeps its task this long; the hold renews while it works and lapses if it stops. 2 to 30 minutes.",
        pauseAbove: "Pause above",
        pauseAboveHint:
          "No agent takes a new task once its usage passes this. Empty never pauses.",
        minutesUnit: "min",
        percentUnit: "%",
        pauseOff: "Never",
        modeLabel: "How agents pick work",
        modePaused: "Paused",
        modeDirected: "Directed",
        modeAutomatic: "Automatic",
        modePausedHint: "Runners stay connected and claim nothing.",
        modeDirectedHint:
          "Drop an idle agent on a task. It follows that line and stops where the line ends.",
        modeAutomaticHint:
          "Every agent claims every ready task, in launch order.",
        switchTitle: "Agents are working",
        switchIntro:
          "Switching to {{mode}} reaches the runners on their next heartbeat. These agents are on a task right now:",
        switchNotePaused:
          "Paused claims nothing more, so each of these lines ends with the task it holds.",
        switchNoteDirected:
          "Directed hands the next pick back to you, so each of these lines ends with the task it holds.",
        switchNoteAutomatic:
          "Automatic lets every agent claim every ready task as soon as it is free.",
        switchConfirm: "Switch anyway",
        dropHint: "Drop on a task to start it",
        mergePolicy: "When a line finishes",
        agentBranch: "Agent branch",
        agentBranchPlaceholder: "agents",
        promote: "Promote",
        promoting: "Promoting…",
        promoteHint:
          "Merges {{branch}} into the repository's default branch as one commit naming every task it carries.",
        mergeToMain: "Merge to main",
        mergeLeaveBranch: "Leave the branch",
        mergeToBranch: "Merge to {{branch}}",
        checks: "Checks before merging",
        checksMoved:
          'Checks belong to the machine that runs them, so nobody else can name a command that runs on your computer. Set them where the runner is: wireal-run checks "npm test".',
        merge: "Merge",
        merging: "Merging…",
        openCompare: "Open compare",
        folder: "Folder",
        folderPath: "Path",
        folderUnknownPath: "not reported",
        folderBranch: "Branch",
        folderBehind: "To pull",
        folderBehindValue_one: "{{count}} commit",
        folderBehindValue: "{{count}} commits",
        folderLevel: "Nothing",
        folderTracks: "Tracks",
        folderAhead: "Not pushed",
        folderAheadValue_one: "{{count}} commit of its own",
        folderAheadValue: "{{count}} commits of its own",
        folderChanges: "Working copy",
        folderDirty: "Has uncommitted changes",
        folderClean: "Clean",
        pull: "Pull",
        pulling: "Pulling…",
        onboarding: {
          startTitle: "Start a runner",
          startNote:
            "Agents work on your machine, never ours. One command signs this machine in; the runner takes it from there.",
          nextTitle: "What happens next",
          stepsLabel: "From here to an agent at work",
          step1Title: "Connect a runner",
          step1Note:
            "Start it in the folder the agents should work in. It shows up here on its first heartbeat.",
          step2Title: "It brings its agents",
          step2Note:
            "The runner starts Claude Code and Codex agents on that machine and names them itself. Add or remove them from its terminal.",
          step3Title: "Work moves on the board",
          step3Note:
            "Drop an agent on a task and it opens its own worktree. Drop it on a second and that one waits its turn.",
        },
      },
      runners: {
        noFolder: "This runner watches no folder yet.",
        you: "{{name}} (you)",
        pullCount: "Pull {{count}}",
        testShort: "Test",
        pullReady: "It is {{count}} commits behind {{upstream}}.",
        pullLevel:
          "It is level with {{upstream}}, so there is nothing to pull.",
        pullDirty: "It has uncommitted changes, so it is left alone.",
        pullSplit:
          "It holds {{ahead}} commits {{upstream}} has not seen and is {{behind}} behind it, so it takes a rebase by hand.",
        promoteNoBranch:
          "No agent branch is set, so lines already land on the default branch.",
        testHint: "Times how long the runner takes to answer.",
        forgetHint: "It comes back on this list the next time it starts.",
        ownerOnly: "Only {{owner}} can do this from here.",
        noFolderYet: "This runner watches no folder yet.",
        offlineNow: "The runner is offline.",
      },
      githubAccess: {
        ownerOnly:
          "Only the workspace owner can change the repository and folders.",
        noRepository: "No repository chosen yet.",
        noFolders: "No folders chosen.",
      },
      report: {
        done: "Done",
        where: "Where",
        next: "Next",
        blocked: "Blocked",
        blockedStatus: "Blocked",
        nextLine: "Next: {{next}}",
        by: "{{author}} · {{when}}",
        none: "No agent has reported on this task yet.",
        awayTitle: "While you were away",
        awaySummary_one:
          "{{count}} task moved · {{done}} done · {{blocked}} blocked",
        awaySummary_other:
          "{{count}} tasks moved · {{done}} done · {{blocked}} blocked",
        awayDismiss: "Mark seen",
      },
      workflows: {
        strip: "Workflows",
        all: "All tasks",
        filterTo: "Show only {{name}}",
        showAll: "Show every task",
        progress: "{{done}} of {{total}} done",
        menuHint: "right-click to rename, recolour or delete",
        color: "Colour",
        delete: "Delete workflow",
        workflow: "Workflow",
        namePlaceholder: "Workflow name",
        create: "Create",
        save: "Save",
        newFromSelection: "New workflow from selection",
        addHeading: "Add to",
        removeHeading: "Remove from",
        newFromConnected: "New workflow from connected tasks",
        created: "Workflow {{name}} created",
        assigned: "{{count}} open tasks locked to {{name}}",
        lockFailed: "Some tasks could not be locked: {{reason}}",
      },
      locks: {
        lock: "Lock",
        lockLine: "Lock line",
        unlock: "Unlock",
        unlockLine: "Unlock line",
        lockedBy: "Locked by {{name}}",
        lockedToAgent: "Locked to one agent",
        someone: "someone",
        needRunner: "Connect a runner of your own to lock a task.",
        runnerElsewhere: "Your runner {{name}} is bound to another workspace.",
        waitingForAgent: "Locked and waiting for the agent",
        stopTitle: "Stop this agent?",
        stopKeep: "Leave it running",
        stopBody:
          "Unlocking the task ends the run. The agent leaves whatever it has already committed on its branch and takes no further step.",
        stopConfirm: "Stop it",
        stopLineBody:
          "Unlocking the line ends every run along it. {{count}} tasks are locked, and each agent leaves what it already committed on its branch.",
        stopSomeoneElse:
          "This task is locked by {{name}}, not by you. You can stop it because you own the workspace, and the task's activity will record that you did.",
        locked: "The task is locked to you.",
        unlocked: "The lock is off.",
        statusLocked:
          "{{name}} holds this task. Only they can change its status.",
        lockLineTitle: "Lock this line",
        lockLineIntro:
          "These tasks are locked to you, and only your runner takes them.",
        unlockTitle: "Unlock this task",
        unlockLineTitle: "Unlock this line",
        unlockIntro: "This stops the runner on these tasks.",
        noObjective: "No objective yet",
        confirm: "Confirm",
        cancel: "Cancel",
      },
      search: {
        dialog: "Global search",
        tasks: "Tasks",
        all: "Search all tasks",
        placeholder: "Search tasks…",
        results: "Global search results",
        noTasksMatch: "No tasks match that search.",
        noTasks: "No tasks in this workspace yet.",
      },
    },
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: "en",
  supportedLngs: supportedLanguages,
  interpolation: { escapeValue: false },
  initAsync: false,
});

function applyLanguage(language: string) {
  const resolved = isAppLanguage(language.split("-")[0])
    ? (language.split("-")[0] as AppLanguage)
    : "en";
  document.documentElement.lang = resolved;
  document.documentElement.dir = "ltr";
  try {
    localStorage.setItem(LANGUAGE_KEY, resolved);
  } catch {
    // The active language still works for the current page.
  }
}

applyLanguage(i18n.resolvedLanguage ?? i18n.language);
i18n.on("languageChanged", applyLanguage);

export function currentLanguage(): AppLanguage {
  const language = (i18n.resolvedLanguage ?? i18n.language).split("-")[0];
  return isAppLanguage(language) ? language : "en";
}

export function formatDateTime(value: string | number | Date): string {
  return new Intl.DateTimeFormat(currentLanguage(), {
    timeZone: timeZone(),
    hour12: zoneHour12(),
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** "2 hours ago", in the app's language. Past a week the exact date reads
 *  better than "9 days ago", so this falls back to formatDateTime there. */
export function formatRelativeTime(
  value: string | number | Date,
  now: number = Date.now(),
): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs >= 7 * 86400) return formatDateTime(time);
  const format = new Intl.RelativeTimeFormat(currentLanguage(), {
    numeric: "auto",
  });
  if (abs < 60)
    return format.format(0, "second") === "now" || abs < 60
      ? i18n.t("time.justNow", { defaultValue: "just now" })
      : format.format(seconds, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86400), "day");
}

export default i18n;
