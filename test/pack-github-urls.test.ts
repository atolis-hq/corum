import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGitHubRepo,
  parseGitHubUrl,
  toPackRawBaseUrl,
  toRegistryFetchUrl,
  toTagsApiUrl,
} from '../src/pack/github-urls.js'

describe('parseGitHubUrl', () => {
  it('parses owner, repo, and path', () => {
    assert.deepEqual(
      parseGitHubUrl('https://github.com/atolis-hq/corum/packs/registry.yaml'),
      { owner: 'atolis-hq', repo: 'corum', path: 'packs/registry.yaml' },
    )
  })

  it('parses a multi-segment path', () => {
    assert.deepEqual(
      parseGitHubUrl('https://github.com/atolis-hq/corum/.corum/packs/core'),
      { owner: 'atolis-hq', repo: 'corum', path: '.corum/packs/core' },
    )
  })

  it('throws on non-github URLs', () => {
    assert.throws(
      () => parseGitHubUrl('https://example.com/foo/bar/baz'),
      /not a github\.com url/i,
    )
  })

  it('throws if path is missing', () => {
    assert.throws(
      () => parseGitHubUrl('https://github.com/atolis-hq/corum'),
      /missing path/i,
    )
  })
})

describe('parseGitHubRepo', () => {
  it('parses owner and repo from a repo URL', () => {
    assert.deepEqual(
      parseGitHubRepo('https://github.com/atolis-hq/corum'),
      { owner: 'atolis-hq', repo: 'corum' },
    )
  })

  it('throws on non-github URLs', () => {
    assert.throws(
      () => parseGitHubRepo('https://example.com/foo'),
      /not a github\.com url/i,
    )
  })
})

describe('toRegistryFetchUrl', () => {
  it('converts github url to raw HEAD url', () => {
    assert.equal(
      toRegistryFetchUrl('https://github.com/atolis-hq/corum/packs/registry.yaml'),
      'https://raw.githubusercontent.com/atolis-hq/corum/HEAD/packs/registry.yaml',
    )
  })
})

describe('toPackRawBaseUrl', () => {
  it('constructs raw base url for a pack at a given ref', () => {
    assert.equal(
      toPackRawBaseUrl('atolis-hq', 'corum', 'v0.1.6', '.corum/packs/core'),
      'https://raw.githubusercontent.com/atolis-hq/corum/v0.1.6/.corum/packs/core',
    )
  })
})

describe('toTagsApiUrl', () => {
  it('constructs github tags api url', () => {
    assert.equal(
      toTagsApiUrl('atolis-hq', 'corum'),
      'https://api.github.com/repos/atolis-hq/corum/tags?per_page=1',
    )
  })
})
