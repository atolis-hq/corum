// @ts-check
import { html, StateTag } from 'corum:ui'
import { mountReact, useApi, useCtx } from 'corum:ui/react'

/** @type {import('corum:ui').PluginManifest} */
export const manifest = {
  id: 'sample',
  version: '1.0.0',
  engines: { corum: '^0.1.0' },
  main: 'index.js',
  contributes: { pages: [{ id: 'list', title: 'List', mount: 'mountList' }] },
}

function Page() {
  const ctx = useCtx()
  const { data, loading } = useApi('nodes', { template: 'DomainModel' })
  const id = ctx.params.get('id') ?? 'none'
  return html`<section><p>${id} ${loading ? '…' : String(data)}</p><a href=${ctx.hrefForNode(id)}>open</a><${StateTag} state="proposed" /></section>`
}

export const mountList = mountReact(Page)

/** @type {import('corum:ui').PluginMount} */
export function mountPlain(el, ctx) {
  const unsubscribe = ctx.subscribe(() => { el.textContent = String(ctx.revision) })
  ctx.api.get('templates').catch(ctx.onError)
  return unsubscribe
}
