import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../../src/loader/index.js'
import { saveGraph } from '../../src/writer/graph-writer.js'
import { runImport } from '../../src/import/runner.js'
import { createGraphRuntimeConfig } from '../../src/source/config.js'
import type { ImportConfig, AsyncAPIImportEntry } from '../../src/import/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')
const specsDir = path.join(repoRoot, 'test/fixtures/asyncapi/specs')
const expectedBaseDir = path.join(repoRoot, 'test/fixtures/asyncapi/expected')

function makeRuntimeConfig(graphDir: string) {
  process.env.CORUM_GRAPH_PATH = graphDir
  return createGraphRuntimeConfig()
}

async function setupGraphDir() {
  const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-asyncapi-'))
  const graph = await loadGraph({ graphPath: fixtureGraphDir })
  await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: graphDir })
  return { graphDir, cleanup: () => fs.rmSync(graphDir, { recursive: true, force: true }) }
}

function normalizeYaml(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/lastModifiedAt: .+/g, 'lastModifiedAt: <date>')
    .replace(/extractedFrom: .+/g, 'extractedFrom: <spec>')
}

function assertMatchesExpected(graphDir: string, goldenSubdir: string): void {
  const goldenDir = path.join(expectedBaseDir, goldenSubdir)
  function readYamlFiles(baseDir: string): Map<string, string> {
    const map = new Map<string, string>()
    if (!fs.existsSync(baseDir)) return map
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.yaml')) {
          const key = path.relative(baseDir, full).split(path.sep).join('/')
          map.set(key, fs.readFileSync(full, 'utf-8'))
        }
      }
    }
    walk(baseDir)
    return map
  }
  const golden = readYamlFiles(goldenDir)
  assert.ok(golden.size > 0, `golden dir ${goldenSubdir} should contain at least one file`)
  for (const [key, expected] of golden) {
    const actualPath = path.join(graphDir, key)
    assert.ok(fs.existsSync(actualPath), `expected ${key} to exist in graph output`)
    assert.equal(
      normalizeYaml(fs.readFileSync(actualPath, 'utf-8')),
      normalizeYaml(expected),
      `${key} should match golden file`,
    )
  }
}

async function runFixture(specFile: string, entry: Omit<AsyncAPIImportEntry, 'spec'>) {
  const { graphDir, cleanup } = await setupGraphDir()
  try {
    const config: ImportConfig = {
      imports: [{ spec: path.join(specsDir, specFile), ...entry }],
    }
    await runImport(config, makeRuntimeConfig(graphDir))
    return { graphDir, cleanup }
  } catch (err) {
    cleanup()
    throw err
  }
}

describe('asyncapi import runner — simple-events.yaml', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'asyncapi',
          spec: path.join(specsDir, 'simple-events.yaml'),
          componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
        }],
      }
      await runImport(config, makeRuntimeConfig(graphDir))
      assertMatchesExpected(graphDir, 'simple-events')
    } finally {
      cleanup()
    }
  })

  it('is idempotent — second import produces no new nodes', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'asyncapi',
          spec: path.join(specsDir, 'simple-events.yaml'),
          componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
        }],
      }
      const runtimeConfig = makeRuntimeConfig(graphDir)
      await runImport(config, runtimeConfig)
      const before = await loadGraph({ graphPath: graphDir })
      const beforeCount = before.nodesById.size
      await runImport(config, runtimeConfig)
      const after = await loadGraph({ graphPath: graphDir })
      assert.equal(after.nodesById.size, beforeCount)
    } finally {
      cleanup()
    }
  })
})

describe('asyncapi import runner — mixed-events.yaml', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await runFixture('mixed-events.yaml', {
      adapter: 'asyncapi',
      componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
      eventClassification: { from: { strategy: 'tag' }, domainValue: 'domain' },
    })
    try {
      assertMatchesExpected(graphDir, 'mixed-events')
    } finally {
      cleanup()
    }
  })
})

describe('asyncapi import runner — with-enums.yaml', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await runFixture('with-enums.yaml', {
      adapter: 'asyncapi',
      componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
    })
    try {
      assertMatchesExpected(graphDir, 'with-enums')
    } finally {
      cleanup()
    }
  })
})

describe('asyncapi import runner — shared-payload.yaml', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await runFixture('shared-payload.yaml', {
      adapter: 'asyncapi',
      componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
    })
    try {
      assertMatchesExpected(graphDir, 'shared-payload')
    } finally {
      cleanup()
    }
  })
})

describe('asyncapi import runner — with-headers.yaml', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await runFixture('with-headers.yaml', {
      adapter: 'asyncapi',
      componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
    })
    try {
      assertMatchesExpected(graphDir, 'with-headers')
    } finally {
      cleanup()
    }
  })
})

describe('asyncapi import runner — message-naming.yaml', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await runFixture('message-naming.yaml', {
      adapter: 'asyncapi',
      componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
      messageNaming: { strategy: 'name-segment', separator: '.', segment: 0 },
    })
    try {
      assertMatchesExpected(graphDir, 'message-naming')
    } finally {
      cleanup()
    }
  })
})

describe('asyncapi import runner — wrapped-payload.yaml', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await runFixture('wrapped-payload.yaml', {
      adapter: 'asyncapi',
      componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
    })
    try {
      assertMatchesExpected(graphDir, 'wrapped-payload')
    } finally {
      cleanup()
    }
  })
})
