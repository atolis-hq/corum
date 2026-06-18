#!/usr/bin/env node
import { Command } from 'commander'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadImportConfig, buildOpenAPIConfig } from '../import/config.js'
import { runImport } from '../import/runner.js'
import { loadGraph } from '../loader/index.js'
import { startMcpServer } from '../mcp/index.js'
import { createGraphRuntimeConfig } from '../source/config.js'
import { startWebServer } from '../web/server.js'

const program = new Command()

program
  .name('corum')
  .description('Corum graph CLI')
  .version('0.1.0')

// ── mcp ──────────────────────────────────────────────────────────────────────

program
  .command('mcp')
  .description('Start the MCP stdio server (+ web UI by default)')
  .option('--no-web', 'Suppress the web UI')
  .option('--watch', 'Enable file watcher')
  .option('--graph <path>', 'Override graph path')
  .action(async (opts) => {
    if (opts.graph) process.env.CORUM_GRAPH_PATH = path.resolve(opts.graph)
    await startMcpServer({ noWeb: !opts.web, watch: opts.watch ?? false })
  })

// ── web ──────────────────────────────────────────────────────────────────────

program
  .command('web')
  .description('Start the web UI')
  .option('--port <n>', 'Port to listen on', parseInt)
  .option('--graph <path>', 'Override graph path')
  .action(async (opts) => {
    if (opts.graph) process.env.CORUM_GRAPH_PATH = path.resolve(opts.graph)
    const config = createGraphRuntimeConfig()
    let graph
    try {
      graph = await loadGraph({ source: config.source, strict: true })
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
    await startWebServer(graph, {
      graphPath: config.graphPath,
      source: config.source,
      port: opts.port,
    })
  })

// ── init ─────────────────────────────────────────────────────────────────────

const CONFIG_TEMPLATE = `# Corum project configuration
# Uncomment and set the options relevant to your setup.
# All values can be overridden by environment variables (CORUM_*) or CLI flags.

# Source type: 'file' (default) or 'git'
# Maps to: CORUM_SOURCE
# source: file

# ── File source (default) ─────────────────────────────────────────────────────
# Local path to the graph directory.
# Maps to: CORUM_GRAPH_PATH
# graph: .corum/graph

# ── Git source ────────────────────────────────────────────────────────────────
# Uncomment 'source: git' above and configure one of the following:

# Local path to a git repository containing the graph.
# Maps to: CORUM_GIT_LOCAL_PATH
# git_local_path: /path/to/repo

# Remote URL of a git repository containing the graph.
# Maps to: CORUM_GIT_REMOTE_URL
# git_remote_url: https://github.com/org/repo

# Default branch to load (git source only).
# Maps to: CORUM_GIT_BRANCH
# git_branch: main

# How often to poll the remote for changes, in seconds (remote git only).
# Maps to: CORUM_GIT_POLL_SECONDS
# git_poll_seconds: 30

# Auth token for private repositories. Prefer setting CORUM_GIT_TOKEN as an
# environment variable rather than storing a token in this file.
# git_token: ""

# Auth username (default: x-access-token, suits GitHub PATs and Actions tokens).
# Maps to: CORUM_GIT_USERNAME
# git_username: x-access-token
`

program
  .command('init')
  .description('Scaffold .corum/config.yaml with commented defaults')
  .action(() => {
    const configPath = path.join(process.cwd(), '.corum', 'config.yaml')
    if (existsSync(configPath)) {
      process.stdout.write(`.corum/config.yaml already exists — not overwriting\n`)
      return
    }
    mkdirSync(path.dirname(configPath), { recursive: true })
    writeFileSync(configPath, CONFIG_TEMPLATE)
    process.stdout.write(`Created .corum/config.yaml\n`)
  })

// ── import ───────────────────────────────────────────────────────────────────

const importCmd = program.command('import')
  .description('Import specifications into the graph')
  .option('--config <path>', 'Path to import config YAML')
  .option('--graph <path>', 'Override CORUM_GRAPH_PATH')
  .action(async (opts) => {
    if (!opts.config) {
      importCmd.help()
      return
    }
    try {
      const runtimeConfig = buildRuntimeConfig(opts.graph)
      const config = loadImportConfig(path.resolve(opts.config))
      const result = await runImport(config, runtimeConfig)
      reportDiagnostics(result.diagnostics)
      if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
  })

importCmd
  .command('openapi <spec>')
  .description('Import an OpenAPI spec into the graph')
  .option('--component-strategy <strategy>', 'Component mapping: uri-segment, tag, hardcoded', 'uri-segment')
  .option('--segment <n>', 'URI segment index (uri-segment strategy)', parseInt)
  .option('--pattern <regex>', 'Regex pattern (uri-segment strategy)')
  .option('--component <name>', 'Component name (hardcoded strategy)')
  .option('--graph <path>', 'Override CORUM_GRAPH_PATH')
  .action(async (spec: string, opts) => {
    try {
      const runtimeConfig = buildRuntimeConfig(opts.graph)
      const entry = buildOpenAPIConfig(spec, opts.componentStrategy, opts.segment, opts.pattern, opts.component)
      const result = await runImport({ imports: [entry] }, runtimeConfig)
      reportDiagnostics(result.diagnostics)
      if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
  })

function buildRuntimeConfig(graphOverride?: string) {
  if (graphOverride) process.env.CORUM_GRAPH_PATH = path.resolve(graphOverride)
  return createGraphRuntimeConfig()
}

function reportDiagnostics(diagnostics: { severity: string; file: string; message: string }[]): void {
  for (const d of diagnostics) {
    const prefix = d.severity === 'error' ? 'ERROR' : 'WARN'
    process.stderr.write(`[${prefix}] ${d.file}: ${d.message}\n`)
  }
  const errors = diagnostics.filter(d => d.severity === 'error').length
  const warnings = diagnostics.filter(d => d.severity === 'warning').length
  process.stdout.write(`Import complete. ${errors} error(s), ${warnings} warning(s).\n`)
}

program.parse()
