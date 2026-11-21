/* Node quick links and the "Open in" menu, driven by ctx.nodeLinks(). Styling hooks: .quick-links, .quick-link, .open-in*. */
import React from 'react'
import { html } from './html.js'
import { Icon } from './ui.js'
import { useCtx } from './ctx-context.js'

const stop = event => event.stopPropagation()

function QuickIcons({ links }) {
  return links.map(link => html`
    <a
      key=${link.key}
      className="quick-link"
      href=${link.href}
      title=${link.label}
      aria-label=${link.label}
      onClick=${stop}
    >
      <${Icon} name=${link.icon ?? 'link'} size=${12} />
    </a>
  `)
}

function hasMenuEntries(menu) {
  return menu.destinations.length > 0 || menu.actions.length > 0
}

function MenuButton({ menu }) {
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef(null)

  React.useEffect(() => {
    if (!open) return undefined
    const onDown = event => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false)
    }
    const onKey = event => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => setOpen(false)
  const item = (key, href, label) => html`
    <a key=${key} className="open-in-item" role="menuitem" href=${href} onClick=${close}>${label}</a>
  `
  return html`
    <div className="open-in" data-testid="open-in" ref=${wrapRef} onClick=${stop}>
      <button
        type="button"
        className="open-in-trigger"
        aria-haspopup="menu"
        aria-expanded=${open}
        aria-label="Open in"
        title="Open in"
        onClick=${() => setOpen(value => !value)}
      >
        <${Icon} name="arrow-up-right-from-square" size=${12} />
      </button>
      ${open && html`
        <div className="open-in-menu" role="menu">
          ${menu.explorerHref && item('explorer', menu.explorerHref, 'Explorer view')}
          ${menu.destinations.map(link => item(link.key, link.href, link.label))}
          ${menu.destinations.length > 0 && menu.actions.length > 0 && html`<div className="open-in-sep" role="separator" />`}
          ${menu.actions.map(link => item(link.key, link.href, link.label))}
        </div>
      `}
    </div>
  `
}

/* Icon links for the node actions that opt into `surface` ('header' or 'relations'). */
export function QuickLinks({ nodeId, surface }) {
  const ctx = useCtx()
  const links = ctx ? ctx.nodeLinks(nodeId).quick[surface] ?? [] : []
  if (links.length === 0) return null
  return html`<span className="quick-links"><${QuickIcons} links=${links} /></span>`
}

/* The "Open in" menu: Explorer view, claimant pages and node actions. Renders nothing when it would be empty. */
export function OpenInMenu({ nodeId }) {
  const ctx = useCtx()
  const menu = ctx ? ctx.nodeLinks(nodeId).menu : null
  if (!menu || !hasMenuEntries(menu)) return null
  return html`<${MenuButton} menu=${menu} />`
}

/* Quick icons for `surface` followed by the menu trigger. */
export function NodeLinks({ nodeId, surface }) {
  const ctx = useCtx()
  if (!ctx) return null
  const links = ctx.nodeLinks(nodeId)
  const quick = links.quick[surface] ?? []
  const menu = hasMenuEntries(links.menu)
  if (quick.length === 0 && !menu) return null
  return html`
    <span className="quick-links">
      <${QuickIcons} links=${quick} />
      ${menu && html`<${MenuButton} menu=${links.menu} />`}
    </span>
  `
}
