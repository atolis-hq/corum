import { html, getDisplayName } from 'corum:ui'
import { mountReact, useCtx, NodeLinks } from 'corum:ui/react'

function Page() {
  const id = useCtx().params.get('id')
  return html`
    <div className="content">
      <h1 data-testid="plugin-claim-a">claim-a page</h1>
      ${id && html`
        <div data-testid="plugin-claim-a-node" style=${{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style=${{ margin: 0 }} data-testid="plugin-claim-a-name">${getDisplayName(id)}</h2>
          <${NodeLinks} nodeId=${id} surface="header" />
        </div>
      `}
    </div>
  `
}

export const mount = mountReact(Page)
