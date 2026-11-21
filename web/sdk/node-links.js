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
  const triggerRef = React.useRef(null)
  const initialFocus = React.useRef(0)
  const menuId = React.useId()
  const items = () => [...wrapRef.current.querySelectorAll('[role="menuitem"]')]
  const close = () => setOpen(false)
  const restoreFocus = () => {
    close()
    triggerRef.current.focus()
  }
  const openAt = index => {
    initialFocus.current = index
    if (open) items().at(index)?.focus()
    else setOpen(true)
  }

  React.useLayoutEffect(() => {
    if (open) items().at(initialFocus.current)?.focus()
  }, [open])

  React.useEffect(() => {
    if (!open) return undefined
    const onDown = event => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false)
    }
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        restoreFocus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onMenuKey = event => {
    const entries = items()
    const index = entries.indexOf(document.activeElement)
    let next
    if (event.key === 'ArrowDown') next = (index + 1) % entries.length
    else if (event.key === 'ArrowUp') next = (index - 1 + entries.length) % entries.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = entries.length - 1
    else if (event.key === 'Tab') {
      // Start native tab traversal at the trigger, outside the popup's items.
      restoreFocus()
      event.stopPropagation()
      return
    } else return
    event.preventDefault()
    event.stopPropagation()
    entries[next]?.focus()
  }
  const item = (key, href, label) => html`
    <a key=${key} className="open-in-item" role="menuitem" tabIndex=${-1} href=${href} onClick=${close}>${label}</a>
  `
  return html`
    <div className="open-in" data-testid="open-in" ref=${wrapRef} onClick=${stop}>
      <button
        type="button"
        className="open-in-trigger"
        ref=${triggerRef}
        id=${menuId + '-trigger'}
        aria-controls=${open ? menuId : undefined}
        aria-haspopup="menu"
        aria-expanded=${open}
        aria-label="Open in"
        title="Open in"
        onClick=${() => open ? restoreFocus() : openAt(0)}
        onKeyDown=${event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            openAt(event.key === 'ArrowUp' ? -1 : 0)
          }
        }}
      >
        <${Icon} name="arrow-up-right-from-square" size=${12} />
      </button>
      ${open && html`
        <div className="open-in-menu" role="menu" id=${menuId} aria-labelledby=${menuId + '-trigger'} onKeyDown=${onMenuKey}>
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
