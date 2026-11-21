import { html } from './html.js'
import { useCtx } from './ctx-context.js'

// Shared references use the surrounding host or plugin context's routing policy.
export function NodeReference({ nodeId, onNavigate, children, title }) {
  const ctx = useCtx()
  const href = ctx?.hrefForNode(nodeId)
  const onClick = event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (onNavigate) {
      event.preventDefault()
      onNavigate(nodeId)
    } else if (href && ctx) {
      event.preventDefault()
      ctx.navigate(href)
    }
  }
  return html`<a className="node-ref-link" href=${href} onClick=${onClick} title=${title}>${children}</a>`
}
