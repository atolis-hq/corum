# Configuration

`corum init` writes `.corum/config.yaml`. Corum walks up from the current
directory to find it, so it can live at your project root.

**Precedence (highest first):** CLI flags → environment variables →
`.corum/config.yaml`.

| Config key | Environment variable | Description |
| --- | --- | --- |
| `pack_registry` | - | URL of the pack registry (set by `corum init`) |
| `source` | `CORUM_SOURCE` | `file` / `filesystem` / `fs` (default) or `git` |
| `graph` | `CORUM_GRAPH_PATH` | Graph directory |
| `git_local_path` | `CORUM_GIT_LOCAL_PATH` | Local Git repository |
| `git_remote_url` | `CORUM_GIT_REMOTE_URL` | Remote Git repository |
| `git_branch` | `CORUM_GIT_BRANCH` | Default branch for reads |
| `git_poll_seconds` | `CORUM_GIT_POLL_SECONDS` | Poll interval for Git-backed web reloads |
| `git_token` | `CORUM_GIT_TOKEN` | Auth token for private repositories |
| `git_username` | `CORUM_GIT_USERNAME` | Auth username (default `x-access-token`) |

Environment-only settings:

| Variable | Description |
| --- | --- |
| `CORUM_WEB_PORT` | Default port for `corum web` |
| `CORUM_FILE_WATCHER` / `CORUM_WATCH` | Watch filesystem graphs for changes in the web UI |

## File source (default)

```yaml
source: file
graph: .corum/graph
```

The graph is read from, and written to, the local filesystem. Write sessions
default to **autosave on**.

## Git source

Instead of reading a working directory, Corum can read the graph from a Git
repository and any of its branches. Set `source: git` and choose **one** of two
modes.

### Local repository

Corum reads straight from a repository already on disk, and writes to it.

```yaml
source: git
git_local_path: /path/to/repo
git_branch: main
```

Use this on your own machine, for example when an agent works in a checkout of
your design repository.

### Remote repository

Corum keeps its own clone (under `~/.config/corum/cache`) and fetches updates
from the remote.

```yaml
source: git
git_remote_url: https://github.com/org/design-repo
git_branch: main
git_poll_seconds: 30
```

Use this when nothing is checked out locally, notably for a shared or hosted
web UI. For private repositories set `CORUM_GIT_TOKEN` (and optionally
`CORUM_GIT_USERNAME`) in the environment rather than the config file.

### Rules for both modes

- Set exactly one of `git_local_path` or `git_remote_url`.
- Reads and the web UI use `git_branch`; branch-scoped tools can read others.
- Write sessions default to **autosave off**, and imports need `--branch`.
- `git_poll_seconds` makes the web UI re-fetch and reload on that interval.

> **Status:** Git source behaviour is under active development.

## Hosting the web UI

The web UI is currently a read-only browser view of the graph. Because all state is in
Git, hosting it needs only a Node process pointed at the repository:

```bash
CORUM_SOURCE=git \
CORUM_GIT_REMOTE_URL=https://github.com/org/design-repo \
CORUM_GIT_BRANCH=main \
CORUM_GIT_POLL_SECONDS=60 \
CORUM_GIT_TOKEN=... \
CORUM_WEB_PORT=3000 \
corum web
```

The UI then follows the repository: merge a change and it appears after the next
poll. The `/health` endpoint is available for liveness checks.

Things to know before exposing it:

- **No built-in authentication.** The server listens on all interfaces and
  doesn't authenticate requests. Put it behind a reverse proxy or identity-aware
  gateway, and use a read-only token for the Git remote.
- It serves the graph from `git_branch` (and can overlay other branches), so
  it exposes everything in that repository's graph.
- Agents and humans editing the graph use their own clone or the MCP server;
  the hosted UI never needs write access.

For local use, `corum web --graph <path>` with `CORUM_FILE_WATCHER=true`
reloads as files change.
