import type express from 'express'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))

// Package "exports" maps hide the UMD files from require.resolve, so locate them by walking up node_modules.
function resolveVendorFile(specifier: string): string | null {
  let dir = HERE
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...specifier.split('/'))
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** URL name (under /vendor/) -> module specifier resolved from node_modules. */
const VENDOR_FILES: Record<string, { specifier: string, contentType: string }> = {
  'react.umd.js': { specifier: 'react/umd/react.production.min.js', contentType: 'text/javascript; charset=utf-8' },
  'react-dom.umd.js': { specifier: 'react-dom/umd/react-dom.production.min.js', contentType: 'text/javascript; charset=utf-8' },
  'reactflow.umd.js': { specifier: 'reactflow/dist/umd/index.js', contentType: 'text/javascript; charset=utf-8' },
  'reactflow.css': { specifier: 'reactflow/dist/style.css', contentType: 'text/css; charset=utf-8' },
  'elk.bundled.js': { specifier: 'elkjs/lib/elk.bundled.js', contentType: 'text/javascript; charset=utf-8' },
  'htm.module.js': { specifier: 'htm/dist/htm.module.js', contentType: 'text/javascript; charset=utf-8' },
  'babel.min.js': { specifier: '@babel/standalone/babel.min.js', contentType: 'text/javascript; charset=utf-8' },
}

// Named exports the reactflow shim offers (the UMD global is not enumerable at generation time).
const REACTFLOW_EXPORTS = [
  'ReactFlow', 'ReactFlowProvider', 'MiniMap', 'Background', 'BackgroundVariant', 'Controls', 'ControlButton',
  'Handle', 'Position', 'MarkerType', 'ConnectionMode', 'ConnectionLineType', 'PanOnScrollMode',
  'SelectionMode', 'Panel', 'EdgeLabelRenderer', 'EdgeText', 'BaseEdge', 'BezierEdge', 'SimpleBezierEdge',
  'SmoothStepEdge', 'StepEdge', 'StraightEdge', 'NodeResizer', 'NodeResizeControl', 'NodeToolbar',
  'useNodesState', 'useEdgesState', 'useReactFlow', 'useStore', 'useStoreApi', 'useNodes', 'useEdges',
  'useViewport', 'useNodesInitialized', 'useOnSelectionChange', 'useOnViewportChange', 'useKeyPress',
  'useUpdateNodeInternals', 'useNodeId', 'useHandleConnections', 'useNodesData',
  'applyNodeChanges', 'applyEdgeChanges', 'addEdge', 'updateEdge', 'getBezierPath', 'getSmoothStepPath',
  'getStraightPath', 'getSimpleBezierPath', 'getRectOfNodes', 'getTransformForBounds', 'getConnectedEdges',
  'getIncomers', 'getOutgoers', 'isNode', 'isEdge', 'internalsSymbol',
]

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function reexport(globalExpr: string, names: string[]): string {
  const lines = [`const g = ${globalExpr}`]
  for (const name of names.filter(n => IDENT.test(n) && n !== 'default')) {
    lines.push(`export const ${name} = g.${name}`)
  }
  lines.push('export default g')
  return lines.join('\n') + '\n'
}

function buildShims(): Record<string, string> {
  const reactNames = Object.keys(require('react') as object)
  const reactDomNames = Object.keys(require('react-dom') as object)
  const reactDomClientNames = Object.keys(require('react-dom/client') as object)
  return {
    'react.js': reexport('window.React', reactNames),
    'react-dom.js': reexport('window.ReactDOM', reactDomNames),
    'react-dom-client.js': reexport('window.ReactDOM', reactDomClientNames),
    'react-jsx-runtime.js': [
      'const { createElement, Fragment: F } = window.React',
      'export const Fragment = F',
      'export function jsx(type, props, key) {',
      '  const { children, ...rest } = props || {}',
      '  if (key !== undefined) rest.key = key',
      '  return children === undefined ? createElement(type, rest) : createElement(type, rest, children)',
      '}',
      'export function jsxs(type, props, key) {',
      '  const { children, ...rest } = props || {}',
      '  if (key !== undefined) rest.key = key',
      '  return createElement(type, rest, ...(Array.isArray(children) ? children : [children]))',
      '}',
      '',
    ].join('\n'),
    'reactflow.js': reexport('window.ReactFlow', REACTFLOW_EXPORTS)
      .replace('export default g', 'export default g.ReactFlow || g.default'),
    'elkjs.js': 'export default window.ELK\n',
  }
}

export function registerVendorRoutes(app: express.Express): void {
  const shims = buildShims()
  const resolved = new Map<string, string>()

  app.get('/vendor/shims/:name', (req, res, next) => {
    const body = Object.hasOwn(shims, req.params.name) ? shims[req.params.name] : undefined
    if (body === undefined) {
      next()
      return
    }
    res.setHeader('Cache-Control', 'no-cache')
    res.type('text/javascript; charset=utf-8').send(body)
  })

  app.get('/vendor/:name', (req, res, next) => {
    const entry = Object.hasOwn(VENDOR_FILES, req.params.name) ? VENDOR_FILES[req.params.name] : undefined
    if (!entry) {
      next()
      return
    }
    let file = resolved.get(req.params.name)
    if (!file) {
      const found = resolveVendorFile(entry.specifier)
      if (!found) {
        next()
        return
      }
      file = found
      resolved.set(req.params.name, file)
    }
    res.setHeader('Cache-Control', 'no-cache')
    res.type(entry.contentType).sendFile(file)
  })

  // Anything else under /vendor must never fall through to static serving.
  app.use('/vendor', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })
}
