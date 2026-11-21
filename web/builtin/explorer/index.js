/* Explorer plugin entry: the namespace tree (sidebar), the landing page and the namespace overview page. */
import { mountReact } from 'corum:ui/react'
import { html } from 'corum:ui'
import { ExplorerTree } from './tree.js'
import { NamespacePage } from './namespace-page.js'

function ExplorerHome() {
  return html`<div className="content"><h1>Explorer</h1></div>`
}

export const mountExplorerHome = mountReact(ExplorerHome)
export const mountExplorerTree = mountReact(ExplorerTree)
export const mountNamespace = mountReact(NamespacePage)
