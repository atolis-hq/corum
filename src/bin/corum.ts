#!/usr/bin/env node
import { NODE_ROOT_DIR } from '../source/graph-paths.js'
import { Command } from 'commander'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { readFile as fsReadFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { buildAsyncAPIConfig, buildOpenAPIConfig, loadImportConfig } from '../import/config.js'
import { runImport } from '../import/runner.js'
import { loadGraph } from '../loader/index.js'
import { startMcpServer } from '../mcp/index.js'
import { parseGitHubRepo, toPackRawBaseUrl } from '../pack/github-urls.js'
import { registerPackInGraph } from '../pack/graph-yaml.js'
import { installLocalPackFiles, installPackFiles } from '../pack/installer.js'
import { readManifest, upsertPack } from '../pack/manifest.js'
import { fetchRegistry, findPack, resolveRef } from '../pack/registry.js'
import { createGraphRuntimeConfig } from '../source/config.js'
import { scaffoldPlugin } from '../plugin/scaffold.js'
import { validatePluginDir } from '../plugin/validate.js'
import { startWebServer } from '../web/server.js'

const require = createRequire(import.meta.url)
const { version } = require('../../../package.json') as { version: string }

const program = new Command()

program
  .name('corum')
  .description('Corum graph CLI')
  .version(version)
  .addHelpText('after', '\nFull documentation: https://github.com/atolis-hq/corum#readme')

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

program
  .command('web')
  .description('Start the web UI')
  .option('--port <n>', 'Port to listen on', parseInt)
  .option('--graph <path>', 'Override graph path')
  .option(
    '--plugin-dir <path>',
    'Load an unpacked plugin for development, with live reload (repeatable)',
    (value: string, previous: string[]) => [...previous, path.resolve(value)],
    [] as string[],
  )
  .action(async (opts) => {
    if (opts.graph) process.env.CORUM_GRAPH_PATH = path.resolve(opts.graph)
    const pluginDirs: string[] = opts.pluginDir
    for (const dir of pluginDirs) {
      if (!existsSync(path.join(dir, 'plugin.yaml'))) {
        process.stderr.write(`[ERROR] --plugin-dir ${dir}: no plugin.yaml found\n`)
        process.exit(2)
      }
    }
    const config = createGraphRuntimeConfig()
    let graph
    try {
      graph = await loadGraph({ source: config.source, strict: true })
      reportGraphDiagnostics(graph.diagnostics)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
    await startWebServer(graph, {
      graphPath: config.graphPath,
      source: config.source,
      port: opts.port,
      pluginDirs: pluginDirs.length > 0 ? pluginDirs : undefined,
    })
  })

program
  .command('lint')
  .description('Lint the graph and report diagnostics')
  .option('--graph <path>', 'Override graph path')
  .action(async (opts) => {
    const config = buildRuntimeConfig(opts.graph)
    try {
      const graph = await loadGraph({ source: config.source, strict: false })
      reportDiagnostics(graph.diagnostics, 'Lint complete')
      if (graph.diagnostics.some(d => d.severity === 'error')) process.exit(1)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
  })

const CONFIG_TEMPLATE = `# Corum project configuration
# Uncomment and set the options relevant to your setup.
# All values can be overridden by environment variables (CORUM_*) or CLI flags.

# Registry URL for discovering and installing template packs.
pack_registry: https://github.com/atolis-hq/corum/packs/registry.yaml

# Source type: 'file' (default) or 'git'
# Maps to: CORUM_SOURCE
# source: file

# File source (default)
# Local path to the graph directory.
# Maps to: CORUM_GRAPH_PATH
# graph: .corum/graph

# Git source
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

const GRAPH_TEMPLATE = `schema-version: '1.0'
name: My Graph
templatePacks: []
components: []
`

program
  .command('init')
  .description('Scaffold .corum project structure and install default packs')
  .action(async () => {
    const cwd = process.cwd()
    const corumDir = path.join(cwd, '.corum')
    const configPath = path.join(corumDir, 'config.yaml')
    const graphPath = path.join(corumDir, 'graph', 'graph.yaml')

    if (existsSync(configPath)) {
      process.stdout.write('.corum/config.yaml already exists - not overwriting\n')
    } else {
      mkdirSync(path.dirname(configPath), { recursive: true })
      writeFileSync(configPath, CONFIG_TEMPLATE)
      process.stdout.write('Created .corum/config.yaml\n')
    }

    if (existsSync(graphPath)) {
      process.stdout.write('.corum/graph/graph.yaml already exists - not overwriting\n')
    } else {
      mkdirSync(path.dirname(graphPath), { recursive: true })
      writeFileSync(graphPath, GRAPH_TEMPLATE)
      mkdirSync(path.join(corumDir, 'graph', NODE_ROOT_DIR), { recursive: true })
      mkdirSync(path.join(corumDir, 'graph', 'edges'), { recursive: true })
      process.stdout.write('Created .corum/graph/graph.yaml\n')
    }

    for (const packName of ['core', 'domain', 'rest', 'messaging']) {
      try {
        await installPack(packName, cwd)
      } catch (err) {
        process.stderr.write(`[ERROR] Failed to install pack ${packName}: ${err instanceof Error ? err.message : String(err)}\n`)
        process.exit(1)
      }
    }
  })

const importCmd = program.command('import')
  .description('Import specifications into the graph')
  .option('--config <path>', 'Path to import config YAML')
  .option('--graph <path>', 'Override CORUM_GRAPH_PATH')
  .option('-b, --branch <name>', 'Target branch to commit the import to (required for git sources)')
  .addHelpText('after', '\nFor import config file format and options, see: https://github.com/atolis-hq/corum#readme')
  .action(async (opts) => {
    if (!opts.config) {
      importCmd.help()
      return
    }
    try {
      const runtimeConfig = buildRuntimeConfig(opts.graph)
      const config = loadImportConfig(path.resolve(opts.config))
      const result = await runImport(config, runtimeConfig, { branch: opts.branch })
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
  .option('-b, --branch <name>', 'Target branch to commit the import to (required for git sources)')
  .action(async (spec: string, opts) => {
    try {
      const runtimeConfig = buildRuntimeConfig(opts.graph)
      const entry = buildOpenAPIConfig(spec, opts.componentStrategy, opts.segment, opts.pattern, opts.component)
      const result = await runImport({ imports: [entry] }, runtimeConfig, { branch: opts.branch })
      reportDiagnostics(result.diagnostics)
      if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
  })

importCmd
  .command('asyncapi <spec>')
  .description('Import an AsyncAPI spec into the graph')
  .option('--component-strategy <strategy>', 'Component mapping: channel-segment, channel-pattern, name-segment, name-pattern, tag, hardcoded', 'channel-segment')
  .option('--separator <char>', 'Separator for segment strategies', '.')
  .option('--segment <n>', 'Segment index for segment strategies', parseInt)
  .option('--pattern <regex>', 'Regex pattern for pattern strategies')
  .option('--component <name>', 'Component name (hardcoded strategy)')
  .option('--event-classification <mode>', 'Event classification: always-integration, always-domain', 'always-integration')
  .option('--include-consumed', 'Also import receive (consumed) operations', false)
  .option('--graph <path>', 'Override CORUM_GRAPH_PATH')
  .option('-b, --branch <name>', 'Target branch to commit the import to (required for git sources)')
  .action(async (spec: string, opts) => {
    try {
      const runtimeConfig = buildRuntimeConfig(opts.graph)
      const entry = buildAsyncAPIConfig(spec, opts.componentStrategy, {
        separator: opts.separator,
        segment: opts.segment,
        pattern: opts.pattern,
        value: opts.component,
      })
      if (opts.eventClassification === 'always-domain') {
        entry.eventClassification = { strategy: 'always-domain' }
      }
      if (opts.includeConsumed) {
        entry.includeConsumed = true
      }
      const result = await runImport({ imports: [entry] }, runtimeConfig, { branch: opts.branch })
      reportDiagnostics(result.diagnostics)
      if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
  })

importCmd
  .command('corum <spec>')
  .description('Import a corum interchange file into the graph')
  .option('--graph <path>', 'Override CORUM_GRAPH_PATH')
  .option('-b, --branch <name>', 'Target branch to commit the import to (required for git sources)')
  .action(async (spec: string, opts) => {
    try {
      const runtimeConfig = buildRuntimeConfig(opts.graph)
      const entry = { adapter: 'corum' as const, spec: path.resolve(spec) }
      const result = await runImport({ imports: [entry] }, runtimeConfig, { branch: opts.branch })
      reportDiagnostics(result.diagnostics)
      if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
  })

const packCmd = program.command('pack').description('Manage template packs')

packCmd
  .command('install <name>')
  .description('Install a registry pack or a local pack directory')
  .option('--path <dir>', 'Copy a local pack directory using the explicit name')
  .action(async (name: string, opts: { path?: string }) => {
    try {
      await installPack(name, process.cwd(), opts.path)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })

packCmd
  .command('list')
  .description('List installed packs')
  .action(async () => {
    try {
      const manifest = await readManifest(path.join(process.cwd(), '.corum', 'packs.yaml'))
      if (manifest.packs.length === 0) {
        process.stdout.write('No packs installed. Run: corum pack install <name>\n')
        return
      }
      for (const p of manifest.packs) {
        process.stdout.write(`${p.sourcePath ? `${p.name} (local: ${p.sourcePath})` : `${p.name}@${p.ref}`}  (${p.installedAt})\n`)
      }
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })

const pluginCmd = program.command('plugin').description('Create and check UI plugins')

pluginCmd
  .command('init <id>')
  .description('Scaffold a working plugin (plugin.yaml, index.js)')
  .option('--dir <path>', 'Target directory (default: ./<id>)')
  .option('--theme', 'Also contribute a starter theme (theme.css, a contributes.themes entry)')
  .action((id: string, opts) => {
    const dir = opts.dir ?? id
    const result = scaffoldPlugin(id, dir, version, { theme: opts.theme === true })
    if (!result.ok) {
      for (const error of result.errors) process.stderr.write(`[ERROR] ${error}\n`)
      process.exit(1)
    }
    process.stdout.write(`Created plugin "${id}" in ${result.dir} (${result.files.join(', ')})\n`)
    process.stdout.write(`engines.corum targets Corum ${version}; adjust it before publishing.\n`)
    process.stdout.write(`Next: corum plugin validate ${dir}\n      corum web --plugin-dir ${dir}\n      open http://localhost:3000/#/p/${id}/home\n`)
  })

pluginCmd
  .command('validate [dir]')
  .description('Validate a plugin directory against the manifest rules, Corum version and graph templates')
  .option('--graph <path>', 'Override graph path')
  .action(async (dir: string | undefined, opts) => {
    const target = dir ?? '.'
    const root = path.resolve(target)
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      process.stderr.write(`[ERROR] ${root}: directory not found\n`)
      process.exit(2)
    }
    if (!existsSync(path.join(root, 'plugin.yaml'))) {
      process.stderr.write(`[ERROR] ${root}: no plugin.yaml found\n`)
      process.exit(2)
    }
    let templates: Set<string>
    try {
      const config = buildRuntimeConfig(opts.graph)
      const graph = await loadGraph({ source: config.source, strict: false })
      templates = new Set(graph.templates.keys())
    } catch (err) {
      process.stderr.write(`[ERROR] could not load the graph: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
    const result = validatePluginDir(target, templates, version)
    for (const warning of result.warnings) process.stderr.write(`[WARN] ${warning}\n`)
    for (const error of result.errors) process.stderr.write(`[ERROR] ${error}\n`)
    process.stdout.write(result.exitCode === 0 ? 'Plugin is valid.\n' : `Plugin is invalid: ${result.errors.length} error(s).\n`)
    if (result.exitCode !== 0) process.exit(result.exitCode)
  })

function buildRuntimeConfig(graphOverride?: string) {
  if (graphOverride) process.env.CORUM_GRAPH_PATH = path.resolve(graphOverride)
  return createGraphRuntimeConfig()
}

function reportDiagnostics(diagnostics: { severity: string; file: string; message: string }[], label = 'Import complete'): void {
  for (const d of diagnostics) {
    const prefix = d.severity === 'error' ? 'ERROR' : 'WARN'
    process.stderr.write(`[${prefix}] ${d.file}: ${d.message}\n`)
  }
  const errors = diagnostics.filter(d => d.severity === 'error').length
  const warnings = diagnostics.filter(d => d.severity === 'warning').length
  process.stdout.write(`${label}. ${errors} error(s), ${warnings} warning(s).\n`)
}

function reportGraphDiagnostics(diagnostics: { severity: string; file?: string; message: string }[]): void {
  const warnings = diagnostics.filter(d => d.severity === 'warning')
  for (const d of warnings) {
    process.stderr.write(`[WARN] ${d.file ?? 'graph'}: ${d.message}\n`)
  }
  if (warnings.length > 0) {
    process.stderr.write(`Graph loaded with ${warnings.length} warning(s).\n`)
  }
}

async function readPackRegistryUrl(cwd: string): Promise<string> {
  const configPath = path.join(cwd, '.corum', 'config.yaml')
  const text = await fsReadFile(configPath, 'utf8')
  const config = parseYaml(text) as { pack_registry?: string }
  if (!config.pack_registry) throw new Error('pack_registry not set in .corum/config.yaml - run corum init first')
  return config.pack_registry
}

export async function installPack(nameWithRef: string, cwd: string = process.cwd(), sourcePath?: string): Promise<void> {
  const isLocal = sourcePath !== undefined || path.isAbsolute(nameWithRef) || /[\\/]/.test(nameWithRef) || nameWithRef === '.' || nameWithRef === '..'
  if (isLocal) {
    const source = path.resolve(cwd, sourcePath ?? nameWithRef)
    const name = sourcePath !== undefined ? nameWithRef : path.basename(source)
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid pack name: ${name}`)
    const resolvedSource = await installLocalPackFiles(source, path.join(cwd, '.corum', 'packs', name))
    await registerPackInGraph(path.join(cwd, '.corum', 'graph', 'graph.yaml'), name, `../packs/${name}`)
    await upsertPack(path.join(cwd, '.corum', 'packs.yaml'), {
      name, sourcePath: resolvedSource, installedAt: new Date().toISOString(),
    })
    process.stdout.write(`Installed local pack: ${name} (${resolvedSource})\n`)
    return
  }
  const atIdx = nameWithRef.indexOf('@')
  const name = atIdx >= 0 ? nameWithRef.slice(0, atIdx) : nameWithRef
  const specifiedRef = atIdx >= 0 ? nameWithRef.slice(atIdx + 1) : undefined

  const registryUrl = await readPackRegistryUrl(cwd)
  const registry = await fetchRegistry(registryUrl)
  const pack = findPack(registry, name)
  const { owner, repo } = parseGitHubRepo(pack.repo)
  const ref = await resolveRef(owner, repo, specifiedRef)
  const baseUrl = toPackRawBaseUrl(owner, repo, ref, pack.path)

  await installPackFiles(baseUrl, path.join(cwd, '.corum', 'packs', name))
  await upsertPack(path.join(cwd, '.corum', 'packs.yaml'), {
    name,
    repo: pack.repo,
    path: pack.path,
    ref,
    installedAt: new Date().toISOString(),
  })
  await registerPackInGraph(path.join(cwd, '.corum', 'graph', 'graph.yaml'), name, `../packs/${name}`)
  process.stdout.write(`Installed pack: ${name}@${ref}\n`)
}

program.parse()
