import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installPackFiles } from '../src/pack/installer.js'

const packYaml = `name: core\nversion: "1.0.0"\ndescription: Core\ntemplates:\n  - Schema\n  - Field\n`
const packYamlWithFiles = `name: core\nversion: "1.0.0"\ndescription: Core\ntemplates:\n  - Schema\nfiles:\n  - edge.schema.yaml\n`
const schemaYaml = `name: Schema\n`
const fieldYaml = `name: Field\n`

function makeMockFetch(responses: Record<string, string>): typeof fetch {
  return async (url: string | URL | Request) => {
    const key = url.toString()
    const body = responses[key]
    if (body === undefined) throw new Error(`Unexpected fetch: ${key}`)
    return { ok: true, text: async () => body } as unknown as Response
  }
}

describe('installPackFiles', () => {
  it('downloads pack.yaml and all template files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const baseUrl = 'https://raw.githubusercontent.com/a/b/v1/.corum/packs/core'
      const mockFetch = makeMockFetch({
        [`${baseUrl}/pack.yaml`]: packYaml,
        [`${baseUrl}/templates/Schema.yaml`]: schemaYaml,
        [`${baseUrl}/templates/Field.yaml`]: fieldYaml,
      })
      await installPackFiles(baseUrl, path.join(dir, 'core'), mockFetch)
      assert.equal(fs.readFileSync(path.join(dir, 'core', 'pack.yaml'), 'utf8'), packYaml)
      assert.equal(fs.readFileSync(path.join(dir, 'core', 'templates', 'Schema.yaml'), 'utf8'), schemaYaml)
      assert.equal(fs.readFileSync(path.join(dir, 'core', 'templates', 'Field.yaml'), 'utf8'), fieldYaml)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('throws if pack.yaml fetch fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const baseUrl = 'https://raw.githubusercontent.com/a/b/v1/.corum/packs/core'
      const mockFetch = async (_url: string | URL | Request) =>
        ({ ok: false, status: 404, statusText: 'Not Found' }) as unknown as Response
      await assert.rejects(
        () => installPackFiles(baseUrl, path.join(dir, 'core'), mockFetch),
        /404/,
      )
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('downloads additional files listed in the files array', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const baseUrl = 'https://raw.githubusercontent.com/a/b/v1/.corum/packs/core'
      const edgeSchemaYaml = `$schema: https://json-schema.org/draft/2020-12/schema\n`
      const mockFetch = makeMockFetch({
        [`${baseUrl}/pack.yaml`]: packYamlWithFiles,
        [`${baseUrl}/templates/Schema.yaml`]: schemaYaml,
        [`${baseUrl}/edge.schema.yaml`]: edgeSchemaYaml,
      })
      await installPackFiles(baseUrl, path.join(dir, 'core'), mockFetch)
      assert.equal(fs.readFileSync(path.join(dir, 'core', 'edge.schema.yaml'), 'utf8'), edgeSchemaYaml)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('throws if a template file fetch fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const baseUrl = 'https://raw.githubusercontent.com/a/b/v1/.corum/packs/core'
      const mockFetch = async (url: string | URL | Request) => {
        if (url.toString().endsWith('pack.yaml')) {
          return { ok: true, text: async () => packYaml } as unknown as Response
        }
        return { ok: false, status: 500, statusText: 'Server Error' } as unknown as Response
      }
      await assert.rejects(
        () => installPackFiles(baseUrl, path.join(dir, 'core'), mockFetch),
        /500/,
      )
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})
