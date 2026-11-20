import { html } from 'corum:ui'
import { mountReact, useCtx } from 'corum:ui/react'

function Counter() {
  const ctx = useCtx()
  return html`
    <div className="content">
      <h1 data-testid="counter-mounts">${window.__counterMounts}</h1>
      <p data-testid="counter-n">${ctx.params.get('n') ?? ''}</p>
      <a data-testid="counter-next" href=${ctx.hrefForPage({ n: '2' })}>next</a>
    </div>
  `
}

const inner = mountReact(Counter)

/* Counts how many times the host mounts the page, to prove params-only route changes do not remount. */
export function mountCounter(el, ctx) {
  window.__counterMounts = (window.__counterMounts ?? 0) + 1
  return inner(el, ctx)
}
