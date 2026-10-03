# Wireal

Wireal is a task board for work shared between people and coding agents. You
plan tasks and their dependencies; `wireal-run`, a runner on your own machine,
claims what is ready and works each task with Claude Code or the Codex CLI on a
branch of its own, reporting back on the card. People in their own Claude Code
or Codex session join the same board through the Wireal MCP server.

Status: [![CI](https://github.com/wirealco/wireal/actions/workflows/ci.yml/badge.svg)](https://github.com/wirealco/wireal/actions/workflows/ci.yml)

| Piece      | Where             | What it is                                                    |
| ---------- | ----------------- | ------------------------------------------------------------- |
| API        | `backend/`        | ASP.NET Core (.NET 10) on PostgreSQL (the only supported DB). |
| Web app    | `src/`, `public/` | React 19 and Vite, served as static files.                    |
| MCP server | `mcp/`, `worker/` | Cloudflare Worker, or a Node process (`docker/mcp/`).         |
| Runner     | `runner/`         | `wireal-run` on npm (its page is `runner/README.md`).         |

## Run it

### Cloud

Sign up at https://wireal.co. MCP clients connect to `https://mcp.wireal.co/mcp`;
the runner uses `https://api.wireal.co` by default.

### Self-host with Docker Compose

Needs a Linux server with Docker Engine and the compose plugin, ports 80 and 443
open, and three DNS names on one registrable domain (the app and API must be
same-site for sign-in cookies), e.g. `app.example.com`, `api.example.com`,
`mcp.example.com`. Caddy gets the certificates.

```sh
git clone https://github.com/wirealco/wireal.git && cd wireal
cp .env.example .env    # fill in the required values below
docker compose up -d --build
docker compose ps       # migrate: Exited (0), the rest: Up
```

| Variable (required)                                     | Meaning                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `WIREAL_APP_HOST`, `WIREAL_API_HOST`, `WIREAL_MCP_HOST` | The three hostnames, without `https://`.                   |
| `POSTGRES_PASSWORD`                                     | Letters and digits only: `openssl rand -hex 24`.           |
| `WIREAL_JWT_SIGNING_KEY`                                | `openssl rand -base64 32`. Changing it signs everyone out. |
| `WIREAL_ADMIN_EMAIL`                                    | The address allowed to register the first account.         |
| `WIREAL_INVITE_ONLY`                                    | `true` (default): only the admin and invitees register.    |

Optional integrations stay off while empty: email (`CLOUDFLARE_EMAIL_*`; without
it verification links go to `docker compose logs api | grep "Verification link"`,
valid 30 minutes), Turnstile (`TURNSTILE_*`) and the GitHub App (`GITHUB_APP_*`,
key in `./secrets/github-app.pem`, see [GitHub App](#github-app)).

Open `https://<WIREAL_APP_HOST>`, register with `WIREAL_ADMIN_EMAIL`, verify,
create a workspace and invite people. MCP is at `https://<WIREAL_MCP_HOST>/mcp`.
Point the runner at your server with
`WIREAL_API_URL=https://api.example.com WIREAL_MCP_RESOURCE=https://mcp.example.com npx wireal-run login`.

For a single machine without DNS use `app.wireal.localhost`,
`api.wireal.localhost`, `mcp.wireal.localhost` and trust Caddy's local root
(`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt`);
MCP still needs real, publicly trusted names.

**Backups.** Keep the database, the `keys` volume (Data Protection keys) and
`.env`:

```sh
docker compose exec -T postgres pg_dump -U wireal -d wireal -Fc > wireal-$(date +%F).dump
docker run --rm -v wireal_keys:/keys -v "$PWD":/backup alpine tar czf /backup/wireal-keys-$(date +%F).tgz -C /keys .
```

Restore: `docker compose exec -T postgres pg_restore -U wireal -d wireal --clean --if-exists --no-owner < file.dump`.

**Upgrade.** Back up, then `git pull && docker compose up -d --build`. `migrate`
runs new migrations first; if it fails the API does not start
(`docker compose logs migrate`).

Limits: Linux images only (amd64, arm64); email only via Cloudflare Email
Sending (no SMTP); the key ring is unencrypted unless you set
`Security__KeyCertificatePath`/`Security__KeyCertificatePassword` on `api`; the
privacy policy, terms and contact addresses describe wireal.co, replace them.

## Runner

```sh
npx wireal-run login   # sign this machine in
npx wireal-run run     # in a repo: bind it to a workspace and start agents
```

It starts one agent per CLI on `PATH` (`claude`, `codex`), each on its own
worktree and `wireal/<n>` branch. Keys while it runs:

| Key     | Action                                                           |
| ------- | ---------------------------------------------------------------- |
| `+`     | Add an agent on the least-used CLI (`=` too)                     |
| `-`     | Remove the highest-numbered agent that is idle and not in a lock |
| `c`/`x` | Add a Claude Code / Codex agent                                  |
| `p`     | Pause or resume intake on this runner                            |
| `1-9`   | Attach to an agent's terminal (`ctrl-g` detaches)                |
| `↑`/`↓` | Scroll the feed (`PgUp`/`PgDn` ten lines, `End` the newest)      |
| `q`     | Quit                                                             |

The crew is saved per folder; `--agents N`, `--claude N`, `--codex N` replace
it. The agents' folder-trust question is answered for them (`--ask-trust`
leaves it to you). `WIREAL_CODEX_PATH` picks which Codex runs (the feed names
the one it found); on Windows Codex runs without its sandbox, whose write mode
refuses the worktree there, and `WIREAL_CODEX_SANDBOX` picks another mode.
Commands and flags: [runner/README.md](runner/README.md).

**Credentials it reads** (`runner/agents/usage.ts`), only to show the 5-hour and
7-day usage columns: Claude Code's `claudeAiOauth.accessToken` from
`.credentials.json` in `CLAUDE_CONFIG_DIR` or `~/.claude` (on macOS the
`Claude Code-credentials` keychain item), sent only to
`GET https://api.anthropic.com/api/oauth/usage` about hourly; Codex's
`tokens.access_token` and `tokens.account_id` from `auth.json` in `CODEX_HOME`
or `~/.codex`, sent only to `GET https://chatgpt.com/backend-api/wham/usage`
every five minutes. Both are undocumented endpoints. No token is stored or sent
to Wireal; only the usage windows (percent used, length, reset time) reach
Wireal in the heartbeat. The last figures are cached in `usage.json` beside the
session file.

## MCP

Endpoint `https://mcp.wireal.co/mcp` (OAuth). Claude Code:

```sh
claude mcp add --scope user --transport http wireal https://mcp.wireal.co/mcp
```

Codex: `codex mcp add wireal --url https://mcp.wireal.co/mcp`.

Tools: `workspaces`, `list_projects`, `project`, `label`, `list_tasks`,
`get_task`, `task_brief`, `create_tasks`, `update_task`, `delete_task`,
`report`, `add_task_activity`, `propose_task`, `working_on`, `runner`. The
runner's own profile (`WIREAL_MCP_PROFILE=runner`) has only `task_brief`,
`report`, `add_task_activity`, `propose_task`.

`runner {action, task?, note?}` actions: `hands_off` (mark a task yours and stop
its agent), `release`, `stop`, `pause`, `resume`, `status`.

## Configuration

| Variable                      | Used by    | Meaning                                                                         |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------- |
| `VITE_API_URL`                | web build  | API origin (`https://api.wireal.co`); also the only API origin in the CSP.      |
| `VITE_MCP_URL`                | web build  | MCP endpoint shown in the app (`https://mcp.wireal.co/mcp`).                    |
| `VITE_CF_WEB_ANALYTICS`       | web build  | `edge` if Cloudflare injects Web Analytics at the edge (allows it in the CSP).  |
| `VITE_CF_BEACON_TOKEN`        | web build  | Web Analytics token for a build that embeds the beacon itself; not with `edge`. |
| `WIREAL_API_URL`              | MCP/runner | API origin. Required for MCP.                                                   |
| `MCP_PUBLIC_URL`              | MCP        | The MCP server's public origin; must equal the API's `App:McpResource`.         |
| `WIREAL_APP_URL`              | MCP/runner | Web app origin. Default: the MCP/API host without `mcp.`/`api.`.                |
| `WIREAL_AGENT_NAME`, `PORT`   | MCP        | Author for unnamed clients (`Agent`); Node server port (8787).                  |
| `WIREAL_MCP_RESOURCE`         | runner     | MCP resource the runner's token is for (`https://mcp.wireal.co`).               |
| `App:ClientOrigin`            | API        | Web app origin; verification and invitation links point here.                   |
| `App:AdditionalClientOrigins` | API        | Extra exact HTTPS app origins (e.g. staging).                                   |
| `App:PublicApiOrigin`         | API        | The API's own public origin.                                                    |
| `App:McpResource`             | API        | MCP origin every MCP token is bound to (default: `mcp.` + client host).         |
| `ConnectionStrings:Postgres`  | API        | Npgsql string; loopback/socket or `SSL Mode=VerifyFull` in production.          |

`VITE_*` apply only to non-`development` builds. The API reads ASP.NET Core
configuration (environment: `__` for `:`); the full template is
`backend/deploy/appsettings.Production.example.json`.

## GitHub App

One app does sign-in and commit reading. Register it under Settings -> Developer
settings -> GitHub Apps:

- Callback URLs, in this order: `https://<api>/auth/github/app/callback`, then
  `https://<api>/auth/github/callback`.
- Request user authorization (OAuth) during installation: on. Redirect on
  update: off. No webhook.
- Repository permissions: Contents read-only, Metadata read-only.
- Set `GitHub:App` `ClientId`, `ClientSecret` (sign-in; both or neither) and
  `AppId`, `Slug`, `PrivateKeyPath` (commits; all or `AppId` 0).

## Development

Node.js 22+; the .NET SDK in `backend/global.json` and PostgreSQL for backend
work.

```sh
npm ci
npm run dev             # http://localhost:5174, local preview, no backend (/app, /app?tour=1)
npx tsc -b && npm test && npm run build
npm run test:runner     # runner tests only
docker run -d --name wireal-test-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
dotnet test backend/Wireal.slnx   # WIREAL_TEST_POSTGRES, default Host=localhost;Username=postgres;Password=postgres
npm run notices         # after adding/upgrading a production dependency; commit THIRD_PARTY_NOTICES.txt
```

`dev/` has preview pages: `npx vite` then open `/dev/task-files-preview.html` or
`/dev/agents-preview.html` (`npx tsx dev/runner-ui-preview.ts` for the runner
screen). `npm run worker:dev:mcp` serves the MCP Worker on http://localhost:8787.

New migration (no database needed):

```sh
cd backend && dotnet tool restore
dotnet ef migrations add <Name> --project Wireal.Api --context AppDbContext
```

Publish the runner: `npm run pack:runner && npm publish ./dist-runner` (the `./`
matters).

## Contributing

Issues and pull requests welcome. Run the checks above and `npm run format`
first. Documentation lives in this README and `runner/README.md` only; schema
changes are EF Core migrations. Contributions are AGPL-3.0-only.

## Security

Do not report vulnerabilities in public issues; use GitHub private vulnerability
reporting (Security tab -> Report a vulnerability).

## License

AGPL-3.0-only (`LICENSE`): a modified version run as a network service must offer
its users the source. Third-party notices: `THIRD_PARTY_NOTICES.txt`.

## Trademarks

The Wireal name and logo are not covered by the AGPL; forks and self-hosted
deployments use their own name and branding. See `TRADEMARKS.txt`.
