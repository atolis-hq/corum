import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const navSource = readFileSync(path.join(repoRoot, 'web', 'nav.js'), 'utf-8')

type NavNode = { id: string; template: string; component: string; parentId?: string; ownedSection?: string }
type NavTemplate = { name: string; ui?: { nav?: { nestOwned?: Array<{ section: string; label?: string }> } } }
type NavTree = Map<string, Map<string, Array<NavNode & { navChildren: Array<{ label: string; nodes: NavNode[] }> }>>>

function loadNav(): { buildNavTree: (nodes: NavNode[], templates: NavTemplate[]) => NavTree } {
  const ctx = vm.createContext({ window: {} as Record<string, unknown> })
  vm.runInContext(navSource, ctx)
  return ctx.window.CorumNav as ReturnType<typeof loadNav>
}

describe('buildNavTree', () => {
  let buildNavTree: ReturnType<typeof loadNav>['buildNavTree']

  before(() => {
    buildNavTree = loadNav().buildNavTree
  })

  it('groups top-level nodes by component and template', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Order', template: 'DomainModel', component: 'orders' },
      { id: 'billing.Invoice', template: 'DomainModel', component: 'billing' },
    ]
    const templates: NavTemplate[] = [{ name: 'DomainModel' }]
    const tree = buildNavTree(nodes, templates)

    assert.ok(tree.has('orders'))
    assert.ok(tree.has('billing'))
    assert.equal(tree.get('orders')!.get('DomainModel')!.length, 1)
    assert.equal(tree.get('billing')!.get('DomainModel')!.length, 1)
  })

  it('excludes nestOwned nodes from the top level', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Order', template: 'DomainModel', component: 'orders' },
      { id: 'orders.Order.operations.cancel', template: 'DomainOperation', component: 'orders', parentId: 'orders.Order', ownedSection: 'operations' },
    ]
    const templates: NavTemplate[] = [
      { name: 'DomainModel', ui: { nav: { nestOwned: [{ section: 'operations', label: 'Operations' }] } } },
      { name: 'DomainOperation' },
    ]
    const tree = buildNavTree(nodes, templates)

    assert.ok(!tree.get('orders')!.has('DomainOperation'), 'DomainOperation should not appear at top level')
  })

  it('attaches nestOwned nodes as navChildren on the parent', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Order', template: 'DomainModel', component: 'orders' },
      { id: 'orders.Order.operations.cancel', template: 'DomainOperation', component: 'orders', parentId: 'orders.Order', ownedSection: 'operations' },
    ]
    const templates: NavTemplate[] = [
      { name: 'DomainModel', ui: { nav: { nestOwned: [{ section: 'operations', label: 'Operations' }] } } },
      { name: 'DomainOperation' },
    ]
    const tree = buildNavTree(nodes, templates)

    const orderNode = tree.get('orders')!.get('DomainModel')![0]
    assert.equal(orderNode.navChildren.length, 1)
    assert.equal(orderNode.navChildren[0].label, 'Operations')
    assert.equal(orderNode.navChildren[0].nodes[0].id, 'orders.Order.operations.cancel')
  })

  it('uses section name as label when nestOwned rule has no label', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Order', template: 'DomainModel', component: 'orders' },
      { id: 'orders.Order.operations.cancel', template: 'DomainOperation', component: 'orders', parentId: 'orders.Order', ownedSection: 'operations' },
    ]
    const templates: NavTemplate[] = [
      { name: 'DomainModel', ui: { nav: { nestOwned: [{ section: 'operations' }] } } },
      { name: 'DomainOperation' },
    ]
    const tree = buildNavTree(nodes, templates)

    const orderNode = tree.get('orders')!.get('DomainModel')![0]
    assert.equal(orderNode.navChildren[0].label, 'operations')
  })

  it('does not nest nodes whose parent template has no nestOwned rule for their section', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Order', template: 'DomainModel', component: 'orders' },
      { id: 'orders.Order.operations.cancel', template: 'DomainOperation', component: 'orders', parentId: 'orders.Order', ownedSection: 'operations' },
    ]
    const templates: NavTemplate[] = [
      { name: 'DomainModel' },
      { name: 'DomainOperation' },
    ]
    const tree = buildNavTree(nodes, templates)

    assert.ok(tree.get('orders')!.has('DomainOperation'), 'should appear at top level when no nestOwned rule')
    assert.equal(tree.get('orders')!.get('DomainModel')![0].navChildren.length, 0)
  })

  it('sorts top-level nodes within a template group alphabetically', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Z', template: 'DomainModel', component: 'orders' },
      { id: 'orders.A', template: 'DomainModel', component: 'orders' },
    ]
    const templates: NavTemplate[] = [{ name: 'DomainModel' }]
    const tree = buildNavTree(nodes, templates)

    const group = tree.get('orders')!.get('DomainModel')!
    assert.equal(group[0].id, 'orders.A')
    assert.equal(group[1].id, 'orders.Z')
  })

  it('returns empty tree for empty node list', () => {
    const tree = buildNavTree([], [])
    assert.equal(tree.size, 0)
  })
})
