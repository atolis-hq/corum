import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadNavModule(): { buildNavTree: Function; buildOverlayIndicatorIds: Function; groupNamespacesByKind: Function } {
  const navJs = readFileSync(join(__dirname, '../../web/nav.js'), 'utf8')
  const context = vm.createContext({ window: {} as Record<string, unknown> })
  vm.runInContext(navJs, context)
  return (context.window as Record<string, unknown>).CorumNav as any
}

describe('buildNavTree', () => {
  it('sorts navChildren groups alphabetically by label', () => {
    const { buildNavTree } = loadNavModule()

    const templates = [
      {
        name: 'DomainModel',
        info: { version: '1' },
        ui: {
          nav: {
            nestOwned: [
              { section: 'schemas', label: 'Schemas' },
              { section: 'operations', label: 'Operations' },
            ],
          },
        },
      },
      { name: 'Schema', info: { version: '1' } },
      { name: 'DomainOperation', info: { version: '1' } },
    ]

    // Schemas node appears before Operations in the array — insertion order would produce ['Schemas', 'Operations']
    // The fix should sort to ['Operations', 'Schemas']
    const nodes = [
      { id: 'orders.DomainModel.Order', template: 'DomainModel', namespace: 'orders', state: 'proposed', stability: 'unstable' },
      { id: 'orders.DomainModel.Order.schemas.Order', template: 'Schema', namespace: 'orders', state: 'proposed', stability: 'unstable', parentId: 'orders.DomainModel.Order', ownedSection: 'schemas' },
      { id: 'orders.DomainModel.Order.operations.Place', template: 'DomainOperation', namespace: 'orders', state: 'proposed', stability: 'unstable', parentId: 'orders.DomainModel.Order', ownedSection: 'operations' },
    ]

    const tree = buildNavTree(nodes, templates)
    const entries = tree.get('orders')
    const templateEntry = entries.find((e: any) => e.templateName === 'DomainModel')
    const orderNode = templateEntry.nodes.find((n: any) => n.id === 'orders.DomainModel.Order')
    const groupLabels: string[] = Array.from((orderNode.navChildren ?? []).map((g: any) => String(g.label)))

    assert.deepStrictEqual(groupLabels, ['Operations', 'Schemas'])
  })
})

describe('groupNamespacesByKind', () => {
  const registry = [
    { id: 'component', label: 'Component' },
    { id: 'journey', label: 'Journey' },
  ]
  const nodes = [
    { id: 'shared.A.a', namespace: 'shared', kind: 'component' },
    { id: 'billing.A.a', namespace: 'billing', kind: 'component' },
    { id: 'signup.J.j', namespace: 'signup', kind: 'journey' },
    { id: 'signup.J.k', namespace: 'signup', kind: 'journey' },
    { id: 'pay.X.x', namespace: 'pay', kind: 'mystery' },
  ]

  it('creates one section per kind, labelled from the registry, default kind first', () => {
    const { groupNamespacesByKind } = loadNavModule()
    const sections = groupNamespacesByKind(nodes, registry)
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(sections)),
      [
        { kind: 'component', label: 'Component', namespaces: ['billing', 'shared'] },
        { kind: 'journey', label: 'Journey', namespaces: ['signup'] },
        { kind: 'mystery', label: 'mystery', namespaces: ['pay'] },
      ],
    )
  })

  it('treats nodes without a kind as the default component kind', () => {
    const { groupNamespacesByKind } = loadNavModule()
    const sections = groupNamespacesByKind([{ id: 'a.T.x', namespace: 'a' }], [])
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sections.map((s: any) => [s.kind, s.label]))), [['component', 'component']])
  })
})
