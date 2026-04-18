import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const env = Object.fromEntries(
  Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
)

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/src/mcp/index.js'],
  cwd: process.cwd(),
  env: {
    ...env,
    CORUM_GRAPH_PATH: process.env.CORUM_GRAPH_PATH ?? 'fixtures/sample-graph',
  },
  stderr: 'pipe',
})

const client = new Client({ name: 'corum-smoke-test', version: '0.1.0' })

function textContent(result) {
  const first = result.content?.[0]
  if (!first || first.type !== 'text') {
    throw new Error(`Expected text content, got ${JSON.stringify(result)}`)
  }
  return first.text
}

async function callJson(name, args = {}) {
  const result = await client.callTool({ name, arguments: { ...args, format: 'json' } })
  if (result.isError) {
    throw new Error(`${name} failed: ${textContent(result)}`)
  }
  return JSON.parse(textContent(result))
}

try {
  await client.connect(transport)

  const tools = await client.listTools()
  console.log('MCP tools exposed by corum:')
  for (const tool of tools.tools) {
    console.log(`- ${tool.name}: ${tool.description}`)
  }

  const allNodes = await callJson('list_nodes')
  console.log(`\nlist_nodes returned ${allNodes.length} nodes`)
  console.log(JSON.stringify(allNodes.slice(0, 5), null, 2))

  const apiNodes = await callJson('list_nodes', { template: 'APIEndpoint' })
  console.log(`\nlist_nodes({ template: "APIEndpoint" }) returned ${apiNodes.length} node(s)`)
  console.log(JSON.stringify(apiNodes, null, 2))

  const cluster = await callJson('get_cluster', { node_id: 'orders.DomainModel.order' })
  const edgeTypeCounts = cluster.edges.reduce((counts, edge) => {
    counts[edge.type] = (counts[edge.type] ?? 0) + 1
    return counts
  }, {})
  console.log('\nget_cluster({ node_id: "orders.DomainModel.order" })')
  console.log(JSON.stringify({
    root: cluster.root.id,
    childCount: cluster.children.length,
    edgeCount: cluster.edges.length,
    edgeTypeCounts,
    firstFiveChildren: cluster.children.slice(0, 5).map((node) => node.id),
  }, null, 2))

  const linked = await callJson('get_linked_fields', { node_id: 'orders.DomainModel.order' })
  console.log('\nget_linked_fields({ node_id: "orders.DomainModel.order" })')
  console.log(JSON.stringify({
    edgeCount: linked.edges.length,
    nodeCount: linked.nodes.length,
    edges: linked.edges.map((edge) => ({
      from: edge.from,
      type: edge.type,
      to: edge.to,
    })),
  }, null, 2))
} finally {
  await transport.close()
}
