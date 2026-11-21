// @ts-check
import { html } from 'corum:ui'

/** @type {import('corum:ui').PluginMount} */
export function mountBad(el, ctx) {
  const missing = ctx.notAMember
  const wrong = ctx.params.get(1)
  el.textContent = String(html) + missing + wrong
  return () => {}
}
