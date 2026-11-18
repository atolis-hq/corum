import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../../src/loader/index.js'
import { saveGraph } from '../../src/writer/graph-writer.js'
import { runImport } from '../../src/import/runner.js'
import { createGraphRuntimeConfig } from '../../src/source/config.js'
import type { ImportConfig } from '../../src/import/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')
const specFile = path.join(repoRoot, 'test/fixtures/openapi/specs/multi-component.yaml')
const BAD_YAML = 'id: [unclosed\n  : : :\n'

function makeRuntimeConfig(graphDir: string) {
  process.env.CORUM_GRAPH_PATH = graphDir
  return createGraphRuntimeConfig()
}

async function setupGraphDir(): Promise<{ graphDir: string; cleanup: () => void }> {
  const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-import-broken-'))
  const graph = await loadGraph({ graphPath: fixtureGraphDir })
  await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: graphDir })
  return { graphDir, cleanup: () => fs.rmSync(graphDir, { recursive: true, force: true }) }
}

function importConfig(): ImportConfig {
  return {
    imports: [{
      adapter: 'openapi',
      spec: specFile,
      componentMapping: { strategy: 'uri-segment', segment: 0 },
    }],
  }
}

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else out.set(path.relative(dir, full), fs.readFileSync(full, 'utf-8'))
    }
  }
  walk(dir)
  return out
}

describe('import runner — broken target graph', () => {
  it('returns the load error as a diagnostic without throwing, and writes nothing', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      fs.mkdirSync(path.join(graphDir, 'nodes'), { recursive: true })
      fs.writeFileSync(path.join(graphDir, 'nodes', 'broken.yaml'), BAD_YAML)
      const before = snapshot(graphDir)

      const result = await runImport(importConfig(), makeRuntimeConfig(graphDir))

      assert.ok(
        result.diagnostics.some(d => d.severity === 'error' && d.file.includes('broken.yaml')),
        JSON.stringify(result.diagnostics),
      )
      const after = snapshot(graphDir)
      assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort())
      for (const [k, v] of before) assert.equal(after.get(k), v, `${k} changed`)
    } finally {
      cleanup()
    }
  })

  it('CLI prints the diagnostics and exits 1 without an uncaught exception', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    const cfgPath = path.join(os.tmpdir(), `corum-import-cfg-${path.basename(graphDir)}.yaml`)
    try {
      fs.mkdirSync(path.join(graphDir, 'nodes'), { recursive: true })
      fs.writeFileSync(path.join(graphDir, 'nodes', 'broken.yaml'), BAD_YAML)
      fs.writeFileSync(cfgPath, [
        'imports:',
        '  - adapter: openapi',
        `    spec: ${specFile}`,
        '    componentMapping: { strategy: uri-segment, segment: 0 }',
        '',
      ].join('\n'))
      const res = spawnSync(process.execPath, [path.join(repoRoot, 'dist/src/bin/corum.js'), 'import', '--config', cfgPath], {
        env: { ...process.env, CORUM_GRAPH_PATH: graphDir },
        encoding: 'utf-8',
      })
      assert.equal(res.status, 1, res.stdout + res.stderr)
      assert.match(res.stdout + res.stderr, /broken\.yaml/)
      assert.doesNotMatch(res.stderr, /LoadError|\.js:\d+/)
    } finally {
      fs.rmSync(cfgPath, { force: true })
      cleanup()
    }
  })

  it('healthy target: no error diagnostics and the import is committed', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const before = snapshot(graphDir)
      const result = await runImport(importConfig(), makeRuntimeConfig(graphDir))
      assert.ok(!result.diagnostics.some(d => d.severity === 'error'), JSON.stringify(result.diagnostics))
      assert.notDeepEqual([...snapshot(graphDir).keys()].sort(), [...before.keys()].sort())
    } finally {
      cleanup()
    }
  })
})
