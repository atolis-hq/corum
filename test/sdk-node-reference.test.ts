import { it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const load = (file: string) => import(pathToFileURL(path.join(process.cwd(), file)).href)
const React = (await load('node_modules/react/index.js')).default
const { renderToStaticMarkup } = await load('node_modules/react-dom/server.node.js')
const { CtxProvider } = await load('web/sdk/ctx-context.js')
const { PropertyValue } = await load('web/sdk/properties.js')
const { SchemaFieldRows } = await load('web/sdk/schema-rows.js')
const { createRegistry } = await load('web/sdk/registry.js')
const { hrefForNode, hrefForExplorerView } = await load('web/sdk/resolve-node.js')

it('shared property and schema references use the supplied resolver with and without a branch', () => {
  const registry = createRegistry()
  const target = 'orders.DomainEvent.placed'
  const field = { id: 'orders.Schema.order.fields.id', properties: {}, state: 'proposed' }
  const model = { fieldsBySchema: new Map([['orders.Schema.order', [field]]]) }
  for (const branch of [undefined, 'feature/links']) {
    for (const explorer of [false, true]) {
      const calls: string[] = []
      const ctx = { hrefForNode: (id: string) => {
        calls.push(id)
        return explorer ? hrefForExplorerView(id, { branch }) : hrefForNode(registry, id, [], { branch })
      } }
      const render = (component: unknown, props: unknown) => renderToStaticMarkup(React.createElement(CtxProvider, { ctx }, React.createElement(component, props)))
      const expected = branch ? '#/feature%2Flinks/node?' : '#/node?'
      for (const markup of [
        render(PropertyValue, { value: { nodeId: target, display: 'Placed' } }),
        render(SchemaFieldRows, { schemaNodeId: 'orders.Schema.order', model, edges: [{ id: 'edge', from: field.id, to: target, type: 'maps-to' }] }),
      ]) {
        assert.ok(markup.includes(`href="${expected}id=${target}${explorer ? '&amp;view=explorer' : ''}"`), markup)
      }
      assert.deepEqual(calls, [target, target])
    }
  }
})
