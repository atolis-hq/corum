import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadNavModule(): { buildNavTree: Function; buildOverlayIndicatorIds: Function } {
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
      { id: 'orders.DomainModel.Order', template: 'DomainModel', component: 'orders', state: 'proposed', stability: 'unstable' },
      { id: 'orders.DomainModel.Order.schemas.Order', template: 'Schema', component: 'orders', state: 'proposed', stability: 'unstable', parentId: 'orders.DomainModel.Order', ownedSection: 'schemas' },
      { id: 'orders.DomainModel.Order.operations.Place', template: 'DomainOperation', component: 'orders', state: 'proposed', stability: 'unstable', parentId: 'orders.DomainModel.Order', ownedSection: 'operations' },
    ]

    const tree = buildNavTree(nodes, templates)
    const entries = tree.get('orders')
    const templateEntry = entries.find((e: any) => e.templateName === 'DomainModel')
    const orderNode = templateEntry.nodes.find((n: any) => n.id === 'orders.DomainModel.Order')
    const groupLabels: string[] = Array.from((orderNode.navChildren ?? []).map((g: any) => String(g.label)))

    assert.deepStrictEqual(groupLabels, ['Operations', 'Schemas'])
  })
})
