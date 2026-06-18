Add project-level config file discovery to the CLI.

Currently the CLI resolves graph source via env vars (`CORUM_SOURCE`, `CORUM_GRAPH_PATH`, etc.) with a `--graph` flag override. This works for CI and one-off runs but is unwieldy for developers who always work against the same graph in a project.

Add a `corum.yaml` (or `.corum/config.yaml`) discovery step: walk up from cwd until found, then use it as the base config before env var and flag overrides apply. Precedence: flag > env var > config file > default.

The config file is also the natural home for other future project-level settings: active pack overrides, default import strategies, scheduled import definitions.

Implementation note: `createGraphRuntimeConfig()` in `src/source/config.ts` is the right extension point — add file resolution as a step before env var fallback.
