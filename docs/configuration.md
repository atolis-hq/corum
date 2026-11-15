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

```yaml
source: git
git_remote_url: https://github.com/org/design-repo
git_branch: main
git_poll_seconds: 30
```

Or for a local repository:

```yaml
source: git
git_local_path: /path/to/repo
git_branch: main
```

- Set exactly one of `git_local_path` or `git_remote_url`.
- Reads and the web UI use `git_branch`; branch-scoped tools can read others.
- Write sessions default to **autosave off**, and imports need `--branch`.
- For private repositories set `CORUM_GIT_TOKEN` in the environment rather than
  the config file.

> **Status:** Git source behaviour is under active development.
