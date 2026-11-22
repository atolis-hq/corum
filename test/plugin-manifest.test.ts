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
    assert.deepEqual(manifest?.contributes, { pages: [], nodeActions: [], themes: [] })
  })

  describe('contributes.themes', () => {
    const themes = (entries: string) => `${valid}  themes:\n${entries}\n`
    const ok = '    - { id: high-contrast, label: High contrast, colorScheme: light, css: ./themes/high-contrast.css }'

    it('parses valid theme entries', () => {
      const { manifest, errors } = parsePluginManifest(themes(`${ok}\n    - { id: night, label: Night, colorScheme: dark, css: night.css }`))
      assert.deepEqual(errors, [])
      assert.deepEqual(manifest?.contributes.themes, [
        { id: 'high-contrast', label: 'High contrast', colorScheme: 'light', css: './themes/high-contrast.css' },
        { id: 'night', label: 'Night', colorScheme: 'dark', css: 'night.css' },
      ])
    })

    const bad: Array<[string, string, RegExp]> = [
      ['invalid id', '    - { id: Night_Mode, label: N, colorScheme: dark, css: n.css }', /id "Night_Mode"/],
      ['the reserved system id', '    - { id: system, label: N, colorScheme: dark, css: n.css }', /reserved/],
      ['missing id', '    - { label: N, colorScheme: dark, css: n.css }', /id is required/],
      ['missing label', '    - { id: n, colorScheme: dark, css: n.css }', /label is required/],
      ['unknown colorScheme', '    - { id: n, label: N, colorScheme: sepia, css: n.css }', /colorScheme must be one of light, dark/],
      ['missing css', '    - { id: n, label: N, colorScheme: dark }', /css is required/],
      ['escaping css path', '    - { id: n, label: N, colorScheme: dark, css: ../n.css }', /css "..\/n.css" must be a relative path/],
      ['absolute css path', '    - { id: n, label: N, colorScheme: dark, css: /etc/n.css }', /relative path/],
      ['non-css file', '    - { id: n, label: N, colorScheme: dark, css: n.js }', /must be a \.css file/],
      ['duplicate ids in one plugin', `${ok}\n${ok}`, /"high-contrast" is duplicated/],
    ]
    for (const [name, entries, pattern] of bad) {
      it(`rejects ${name}`, () => {
        const { manifest, errors } = parsePluginManifest(themes(entries))
        assert.equal(manifest, null)
        assert.ok(errors.some(error => pattern.test(error)), errors.join('; '))
      })
    }

    it('rejects a non-list', () => {
      const { errors } = parsePluginManifest(`${valid}  themes: nope\n`)
      assert.ok(errors.some(error => error.includes('contributes.themes must be a list')))
    })
  })

  for (const menu of [true, false]) {
    it(`preserves explicit menu: ${menu} independently of quick`, () => {
      const text = withChange('page: map }', `page: map, menu: ${menu}, quick: [header, relations] }`)
      const { manifest, errors } = parsePluginManifest(text)
      assert.deepEqual(errors, [])
      assert.equal(manifest?.contributes.nodeActions[0].menu, menu)
      assert.deepEqual(manifest?.contributes.nodeActions[0].quick, ['header', 'relations'])
    })
  }

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
    ['non-boolean menu', withChange('page: map }', 'page: map, menu: "true" }'), /menu must be a boolean/],
    ['null menu', withChange('page: map }', 'page: map, menu: null }'), /menu must be a boolean/],
    ['page missing mount', withChange('mount: mountJourneyMap, ', ''), /mount is required/],
  ]
  for (const [name, text, pattern] of invalid) {
    it(`rejects ${name}`, () => {
      const { manifest, errors } = parsePluginManifest(text)
      assert.equal(manifest, null)
      assert.ok(errors.some(error => pattern.test(error)), errors.join('; '))
    })
  }

  describe('sidebar and legacy page fields', () => {
    const page = (extra: string) => withChange('opens: [Journey] }', `opens: [Journey], ${extra} }`)

    it('parses nav, sidebar, nodeSidebar, detail and legacyPaths', () => {
      const { manifest, errors } = parsePluginManifest(
        page('nav: false, sidebar: mountTree, nodeSidebar: true, detail: true, legacyPaths: ["/namespaces", "/namespace"]'),
      )
      assert.deepEqual(errors, [])
      const parsed = manifest!.contributes.pages[0]
      assert.equal(parsed.nav, false)
      assert.equal(parsed.sidebar, 'mountTree')
      assert.equal(parsed.nodeSidebar, true)
      assert.equal(parsed.detail, true)
      assert.deepEqual(parsed.legacyPaths, ['/namespaces', '/namespace'])
    })

    it('omits the optional fields when absent', () => {
      const parsed = parsePluginManifest(valid).manifest!.contributes.pages[0]
      for (const key of ['nav', 'sidebar', 'nodeSidebar', 'detail', 'legacyPaths']) assert.ok(!(key in parsed), key)
    })

    it('rejects non-boolean flags', () => {
      for (const flag of ['nav', 'nodeSidebar', 'detail']) {
        const { manifest, errors } = parsePluginManifest(page(`${flag}: yes-please`))
        assert.equal(manifest, null, flag)
        assert.ok(errors.some(error => error.includes(`${flag} must be a boolean`)), errors.join('; '))
      }
    })

    it('rejects an empty or non-string sidebar', () => {
      for (const value of ['""', '5']) {
        const { manifest, errors } = parsePluginManifest(page(`sidebar: ${value}`))
        assert.equal(manifest, null)
        assert.ok(errors.some(error => error.includes('sidebar must be a non-empty string')))
      }
    })

    it('rejects malformed legacyPaths', () => {
      const { errors } = parsePluginManifest(page('legacyPaths: namespaces'))
      assert.ok(errors.some(error => error.includes('legacyPaths must be a list')))
    })

    it('rejects legacy paths that are not retired host routes, so /node and /dashboard cannot be claimed', () => {
      for (const path of ['/node', '/dashboard', '/', '/anything', 'namespaces', '/p/other/home']) {
        const { manifest, errors } = parsePluginManifest(page(`legacyPaths: ["${path}"]`))
        assert.equal(manifest, null, path)
        assert.ok(errors.some(error => error.includes('is not a deprecated host route')), `${path}: ${errors.join('; ')}`)
      }
    })
  })

  it('rejects malformed YAML and non-mappings', () => {
    assert.equal(parsePluginManifest('id: [unclosed').manifest, null)
    assert.equal(parsePluginManifest('- a\n- b\n').manifest, null)
    assert.equal(parsePluginManifest('').manifest, null)
  })
})
