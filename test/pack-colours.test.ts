/* Pack colours (ADR-011 section 5): the `{ light, dark }` form next to the plain string, from schema to SDK helpers. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describePackColourProblem } from '../src/loader/colour.js'
import { loadEdgeTypes } from '../src/loader/edge-type-loader.js'
import { loadPacks } from '../src/loader/pack-loader.js'
import { lintGraph } from '../src/linter/index.js'
import type { Diagnostic, EdgeTypeDef, Graph, Template } from '../src/schema/index.js'
import type { ContentMap } from '../src/source/index.js'

const load = (...parts: string[]) => import(pathToFileURL(path.join(process.cwd(), 'web', ...parts)).href)
const { edgeTypeStyle, templateColourStyle, packColourCss } = await load('sdk', 'pack-colours.js')
const { kindColour } = await load('sdk', 'helpers.js')

const PAIR = { light: '#0f766e', dark: '#5eead4' }

describe('pack colour validation', () => {
  it('accepts a #rrggbb string and a { light, dark } pair', () => {
    assert.equal(describePackColourProblem('#0f766e'), undefined)
    assert.equal(describePackColourProblem(PAIR), undefined)
  })

  it('rejects malformed colours', () => {
    assert.match(describePackColourProblem('teal') ?? '', /#rrggbb/)
    assert.match(describePackColourProblem('#fff') ?? '', /#rrggbb/)
    assert.match(describePackColourProblem({ light: '#0f766e' }) ?? '', /colour\.dark/)
    assert.match(describePackColourProblem({ ...PAIR, extra: '#000000' }) ?? '', /unknown key 'extra'/)
    assert.match(describePackColourProblem(42) ?? '', /must be/)
    assert.match(describePackColourProblem(['#0f766e']) ?? '', /must be/)
  })
})

describe('edge type colours', () => {
  const yaml = (body: string): ContentMap => new Map([['p/edge-types.yaml', `edge-types:\n${body}`]])

  it('core edge types carry a colour, and derived-from a dash', () => {
    const types = loadEdgeTypes(new Map(), [])
    assert.equal(types.get('triggers')?.colour, '#b45309')
    assert.deepEqual(types.get('derived-from')?.line, { dash: '5 5' })
  })

  it('pack edge types accept the string form', () => {
    const diagnostics: Diagnostic[] = []
    const types = loadEdgeTypes(yaml('  publishes:\n    category: semantic\n    colour: "#112233"\n'), diagnostics)
    assert.deepEqual(diagnostics, [])
    assert.equal(types.get('publishes')?.colour, '#112233')
  })

  it('pack edge types accept the { light, dark } form and a dash', () => {
    const diagnostics: Diagnostic[] = []
    const types = loadEdgeTypes(
      yaml('  publishes:\n    category: semantic\n    colour: { light: "#0f766e", dark: "#5eead4" }\n    line: { dash: "2, 4" }\n'),
      diagnostics,
    )
    assert.deepEqual(diagnostics, [])
    assert.deepEqual(types.get('publishes')?.colour, PAIR)
    assert.deepEqual(types.get('publishes')?.line, { dash: '2, 4' })
  })

  it('drops an invalid colour or dash with a warning and keeps the edge type', () => {
    const diagnostics: Diagnostic[] = []
    const types = loadEdgeTypes(
      yaml('  publishes:\n    category: semantic\n    colour: teal\n    line: { dash: "url(x)" }\n'),
      diagnostics,
    )
    assert.ok(types.has('publishes'))
    assert.equal(types.get('publishes')?.colour, undefined)
    assert.equal(types.get('publishes')?.line, undefined)
    assert.deepEqual(diagnostics.map(d => d.severity), ['warning', 'warning'])
  })
})

describe('template colours', () => {
  const templateYaml = (colour: string) =>
    new Map([['pack/templates/Thing.yaml', `name: Thing\ninfo:\n  version: 1.0.0\nui:\n  colour: ${colour}\n`]]) as ContentMap

  it('loads the string form', () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(templateYaml('"#4a90e2"'), diagnostics)
    assert.deepEqual(diagnostics, [])
    assert.equal(templates.get('Thing')?.ui?.colour, '#4a90e2')
  })

  it('loads the { light, dark } form', () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(templateYaml('{ light: "#4a90e2", dark: "#9ec5f4" }'), diagnostics)
    assert.deepEqual(diagnostics, [])
    assert.deepEqual(templates.get('Thing')?.ui?.colour, { light: '#4a90e2', dark: '#9ec5f4' })
  })

  it('drops a malformed colour with a warning', () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(templateYaml('{ light: "#4a90e2" }'), diagnostics)
    assert.equal(templates.get('Thing')?.ui?.colour, undefined)
    assert.equal(diagnostics.filter(d => d.severity === 'warning' && /colour\.dark/.test(d.message)).length, 1)
  })

  it('the linter warns about a malformed template or edge-type colour on an in-memory graph', () => {
    const template: Template = { name: 'Thing', info: { version: '1.0.0' }, ui: { colour: 'teal' as never } }
    const edgeTypes = new Map<string, EdgeTypeDef>([['rel', { name: 'rel', category: 'semantic', colour: { light: 'x' } as never }]])
    const graph = {
      nodesById: new Map(), edgesByFrom: new Map(), edgesByTo: new Map(), edgesById: new Map(),
      templates: new Map([['Thing', template]]), edgeTypes,
    } as unknown as Graph
    const messages = lintGraph(graph).map(d => d.message)
    assert.ok(messages.some(m => /ui\.colour 'teal'/.test(m)), messages.join('\n'))
    assert.ok(messages.some(m => /colour\.light/.test(m)), messages.join('\n'))
  })
})

describe('SDK pack colour helpers', () => {
  it('edgeTypeStyle returns custom properties only, with fallbacks to the edge default', () => {
    const style = edgeTypeStyle('triggers')
    assert.deepEqual(Object.keys(style).sort(), ['--edge-colour', '--edge-dash'])
    assert.equal(style['--edge-colour'], 'var(--pack-edge-triggers,var(--edge-default))')
    assert.equal(style['--edge-dash'], 'var(--pack-edge-dash-triggers,none)')
  })

  it('templateColourStyle falls back through later templates to the neutral token', () => {
    assert.equal(templateColourStyle('DomainModel')['--node-colour'], 'var(--pack-node-domainmodel,var(--subtle-foreground))')
    assert.equal(
      templateColourStyle('Child', 'Group')['--node-colour'],
      'var(--pack-node-child,var(--pack-node-group,var(--subtle-foreground)))',
    )
    assert.equal(templateColourStyle(undefined)['--node-colour'], 'var(--subtle-foreground)')
  })

  it('kindColour is a stable --kind-N token reference, with component fixed to the first', () => {
    assert.equal(kindColour('component'), 'var(--kind-1)')
    assert.equal(kindColour(undefined), 'var(--kind-1)')
    assert.equal(kindColour('journey'), kindColour('journey'))
    for (const kind of ['journey', 'decision', 'x', 'service', 'a-b']) assert.match(kindColour(kind), /^var\(--kind-[2-8]\)$/)
  })

  it('packColourCss defines string colours directly and { light, dark } with light-dark()', () => {
    const css = packColourCss(
      [{ name: 'Plain', ui: { colour: '#112233' } }, { name: 'Themed', ui: { colour: PAIR } }, { name: 'None' }],
      [{ name: 'calls', colour: '#6d28d9' }, { name: 'derived-from', colour: '#6b7280', line: { dash: '5 5' } }],
    )
    assert.match(css, /--pack-node-plain: #112233;/)
    assert.match(css, /--pack-node-themed: light-dark\(#0f766e, #5eead4\);/)
    assert.match(css, /--pack-edge-calls: #6d28d9;/)
    assert.match(css, /--pack-edge-dash-derived-from: 5 5;/)
    assert.doesNotMatch(css, /--pack-node-none/)
  })

  it('packColourCss skips anything that is not a plain hex colour or dash pattern', () => {
    const css = packColourCss(
      [{ name: 'Evil', ui: { colour: 'red; background: url(x)' } }],
      [{ name: 'bad', colour: { light: '#000000', dark: 'x' }, line: { dash: '5; x' } }],
    )
    assert.doesNotMatch(css, /Evil|evil|--pack-edge-bad|--pack-edge-dash-bad|url/)
  })
})
