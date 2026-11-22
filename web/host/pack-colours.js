/* Pack colour injection: writes the `--pack-*` custom properties for template and edge-type colours into one <style>
   element. The colours are pack data; this is the only place they enter the page, and components only ever see the
   `--node-colour` / `--edge-colour` custom properties the SDK helpers return. */
import { packColourCss } from '../sdk/pack-colours.js'

const STYLE_ID = 'corum-pack-colours'

export function applyPackColours(templates, edgeTypes, doc = document) {
  let el = doc.getElementById(STYLE_ID)
  if (!el) {
    el = doc.createElement('style')
    el.id = STYLE_ID
    doc.head.appendChild(el)
  }
  el.textContent = packColourCss(templates, edgeTypes)
}
