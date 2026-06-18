import { Command } from 'commander'
import path from 'node:path'
import { loadImportConfig, buildOpenAPIConfig } from '../import/config.js'
import { runImport } from '../import/runner.js'
import { createGraphRuntimeConfig } from '../source/config.js'

const program = new Command()

program
  .name('corum')
  .description('Corum graph CLI')
  .version('0.1.0')

const importCmd = program.command('import')

importCmd
  .command('openapi <spec>')
  .description('Import an OpenAPI spec into the graph')
  .option('--component-strategy <strategy>', 'Component mapping: uri-segment, tag, hardcoded', 'uri-segment')
  .option('--segment <n>', 'URI segment index (uri-segment strategy)', parseInt)
  .option('--pattern <regex>', 'Regex pattern (uri-segment strategy)')
  .option('--component <name>', 'Component name (hardcoded strategy)')
  .option('--graph <path>', 'Override CORUM_GRAPH_PATH')
  .action(async (spec: string, opts) => {
    const runtimeConfig = buildRuntimeConfig(opts.graph)
    const entry = buildOpenAPIConfig(spec, opts.componentStrategy, opts.segment, opts.pattern, opts.component)
    const result = await runImport({ imports: [entry] }, runtimeConfig)
    reportDiagnostics(result.diagnostics)
    if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
  })

importCmd
  .command('run')
  .description('Run imports from a config file')
  .option('--config <path>', 'Path to import config YAML', 'corum-imports.yaml')
  .option('--graph <path>', 'Override CORUM_GRAPH_PATH')
  .action(async (opts) => {
    const runtimeConfig = buildRuntimeConfig(opts.graph)
    const config = loadImportConfig(path.resolve(opts.config))
    const result = await runImport(config, runtimeConfig)
    reportDiagnostics(result.diagnostics)
    if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
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
