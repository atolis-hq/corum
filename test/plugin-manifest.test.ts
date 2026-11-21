import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parsePluginManifest } from '../src/web/plugins/manifest.js'

const valid = `
id: journeys
version: 0.1.0
engines: { corum: ">=0.4" }
requires: { templates: [Journey, JourneyStep] }
main: ./index.js
contributes:
  pages:
    - { id: map, title: Journeys, icon: route, order: 5, mount: mountJourneyMap, opens: [Journey] }
  nodeActions:
    - { id: view-in-journey, label: View in journey, appliesTo: [DomainModel], page: map }
`

function withChange(from: string, to: string): string {
  assert.ok(valid.includes(from))
  return valid.replace(from, to)
}

describe('parsePluginManifest', () => {
  it('parses a valid manifest', () => {
    const { manifest, errors } = parsePluginManifest(valid)
    assert.deepEqual(errors, [])
    assert.ok(manifest)
    assert.equal(manifest.id, 'journeys')
    assert.equal(manifest.engines.corum, '>=0.4')
    assert.deepEqual(manifest.requires.templates, ['Journey', 'JourneyStep'])
    assert.equal(manifest.contributes.pages[0].order, 5)
    assert.deepEqual(manifest.contributes.nodeActions[0], {
      id: 'view-in-journey', label: 'View in journey', appliesTo: ['DomainModel'], page: 'map',
    })
  })

  it('parses optional nodeAction icon, param and quick, and the * wildcard', () => {
    const text = withChange(
      '{ id: view-in-journey, label: View in journey, appliesTo: [DomainModel], page: map }',
      '{ id: view-in-journey, label: View in journey, appliesTo: ["*"], page: map, icon: diagram-project, param: focus, quick: [header, relations] }',
    )
    const { manifest, errors } = parsePluginManifest(text)
    assert.deepEqual(errors, [])
    assert.deepEqual(manifest?.contributes.nodeActions[0], {
      id: 'view-in-journey',
      label: 'View in journey',
      appliesTo: ['*'],
      page: 'map',
      icon: 'diagram-project',
      param: 'focus',
      quick: ['header', 'relations'],
    })
  })

  it('defaults requires and contributes', () => {
    const { manifest, errors } = parsePluginManifest('id: a\nversion: 1.0.0\nengines: { corum: "*" }\nmain: index.js\n')
    assert.deepEqual(errors, [])
    assert.deepEqual(manifest?.requires.templates, [])
    assert.deepEqual(manifest?.contributes, { pages: [], nodeActions: [] })
  })

  const invalid: Array<[string, string, RegExp]> = [
    ['bad id', withChange('id: journeys', 'id: Bad_Id'), /id "Bad_Id"/],
    ['missing main', withChange('main: ./index.js\n', ''), /main is required/],
    ['main escaping', withChange('./index.js', '../x.js'), /main/],
    ['absolute main', withChange('./index.js', '/etc/x.js'), /main/],
    ['main not js', withChange('./index.js', './plugin.yaml'), /\.js or \.mjs/],
    ['missing engines', withChange('engines: { corum: ">=0.4" }\n', ''), /engines\.corum/],
    ['action to unknown page', withChange('page: map }', 'page: nope }'), /does not reference a declared page/],
    [
      'duplicate page ids',
      withChange('  nodeActions:', '    - { id: map, title: Again, mount: other }\n  nodeActions:'),
      /duplicated/,
    ],
    ['unknown quick surface', withChange('page: map }', 'page: map, quick: [header, sidebar] }'), /quick.*"sidebar"/],
    ['quick not a list', withChange('page: map }', 'page: map, quick: header }'), /quick must be a list/],
    ['non-string param', withChange('page: map }', 'page: map, param: 3 }'), /param must be a non-empty string/],
    ['empty param', withChange('page: map }', 'page: map, param: "" }'), /param must be a non-empty string/],
    ['non-string action icon', withChange('page: map }', 'page: map, icon: [x] }'), /nodeActions\[0\]\.icon must be a string/],
    ['page missing mount', withChange('mount: mountJourneyMap, ', ''), /mount is required/],
  ]
  for (const [name, text, pattern] of invalid) {
    it(`rejects ${name}`, () => {
      const { manifest, errors } = parsePluginManifest(text)
      assert.equal(manifest, null)
      assert.ok(errors.some(error => pattern.test(error)), errors.join('; '))
    })
  }

  it('rejects malformed YAML and non-mappings', () => {
    assert.equal(parsePluginManifest('id: [unclosed').manifest, null)
    assert.equal(parsePluginManifest('- a\n- b\n').manifest, null)
    assert.equal(parsePluginManifest('').manifest, null)
  })
})
