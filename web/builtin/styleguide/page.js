/* The style guide page (ADR-011 section 7). Every sample is written with literal class names from the standard
   contract (or this plugin's styleguide-* namespace), so the contract tests can prove each one is styled and used.
   Token and class lists come from ./contract.js, generated from web/sdk/tokens.json and classes.json. */
import React, { useEffect, useState } from 'react'
import { html, Icon, EmptyState, StateTag, StabilityTag, Chip, TemplateBadge, edgeTypeStyle, templateColourStyle } from 'corum:ui'
import { useApi } from 'corum:ui/react'
import { CLASSES, CONTRACT_VERSION, TOKENS } from './contract.js'

const STATES = ['draft', 'proposed', 'agreed', 'implemented', 'future', 'removed']
const STABILITIES = ['stable', 'unstable', 'deprecated']
const KIND_TOKENS = TOKENS.filter(token => /^--kind-\d+$/.test(token.name))
const MAX_PACK_SAMPLES = 6

/* The page's own stylesheet; ready once the file has loaded so the first paint (and screenshot) is styled. */
function useStylesheet() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = new URL('./style.css', import.meta.url).href
    link.addEventListener('load', () => setReady(true))
    link.addEventListener('error', () => setReady(true))
    document.head.appendChild(link)
    return () => link.remove()
  }, [])
  return ready
}

/* Computed token values are read from the document, so they always reflect the active theme. They are re-read when
   the theme changes (the host swaps the data-theme attribute and its theme stylesheet). */
function useThemeVersion() {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => requestAnimationFrame(() => setVersion(v => v + 1))
    const observer = new MutationObserver(bump)
    observer.observe(document.documentElement, { attributes: true })
    observer.observe(document.head, { childList: true, subtree: true, attributes: true })
    return () => observer.disconnect()
  }, [])
  return version
}

const computed = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '(unset)'

function Section({ id, title, intro, children }) {
  return html`
    <section className="styleguide-section" id=${id} data-testid=${`styleguide-${id}`}>
      <h2>${title}</h2>
      ${intro && html`<p className="label-sm">${intro}</p>`}
      ${children}
    </section>
  `
}

function Swatch({ token }) {
  return html`<span className="styleguide-swatch" style=${{ '--swatch': `var(${token})` }} aria-hidden="true"></span>`
}

function TokenCard({ token }) {
  return html`
    <div className="styleguide-token" data-token=${token.name}>
      <${Swatch} token=${token.name} />
      <div>
        <div className="mono weight-medium">${token.name}</div>
        <div className="mono-meta styleguide-value" data-testid="token-value">${computed(token.name)}</div>
        <div className="label-sm">${token.description}</div>
        <div className="label-xs">${token.scope} · since ${token.since}</div>
      </div>
    </div>
  `
}

function ColourTokens() {
  const colours = TOKENS.filter(token => token.type === 'color')
  return html`
    <${Section} id="colours" title="Colour tokens" intro=${`${colours.length} colour tokens of contract version ${CONTRACT_VERSION}, with their value in the active theme.`}>
      <div className="styleguide-grid">
        ${colours.map(token => html`<${TokenCard} key=${token.name} token=${token} />`)}
      </div>
    <//>
  `
}

function Typography() {
  const mono = TOKENS.find(token => token.name === '--font-mono')
  return html`
    <${Section} id="typography" title="Typography" intro="Headings, body text and the standard text classes.">
      <div className="card">
        <div className="card-head">Text</div>
        <div className="card-body content">
          <h1>Heading 1</h1>
          <h2>Heading 2</h2>
          <h3>Heading 3</h3>
          <p>Body text in the foreground colour. <span className="weight-medium">Medium weight.</span></p>
          <p className="label-sm">label-sm: small muted text.</p>
          <p className="label-xs">label-xs: small uppercase caption</p>
          <p className="mono">mono: monospace text</p>
          <p className="mono-meta">mono-meta: small monospace metadata</p>
          <p className="text-warning">text-warning: text in the warning colour.</p>
          ${mono && html`<p className="label-sm">${mono.name}: <span className="mono">${computed(mono.name)}</span></p>`}
        </div>
      </div>
    <//>
  `
}

function RadiiAndShadows() {
  const radii = TOKENS.filter(token => token.type === 'dimension')
  const shadows = TOKENS.filter(token => token.type === 'shadow')
  return html`
    <${Section} id="shape" title="Radii and shadows">
      <div className="styleguide-grid">
        ${radii.map(token => html`
          <div className="styleguide-token" key=${token.name}>
            <span className="styleguide-radius" style=${{ '--sample': `var(${token.name})` }} aria-hidden="true"></span>
            <div>
              <div className="mono weight-medium">${token.name}</div>
              <div className="mono-meta" data-testid="token-value">${computed(token.name)}</div>
            </div>
          </div>
        `)}
        ${shadows.map(token => html`
          <div className="styleguide-token" key=${token.name}>
            <span className="styleguide-shadow" style=${{ '--sample': `var(${token.name})` }} aria-hidden="true"></span>
            <div>
              <div className="mono weight-medium">${token.name}</div>
              <div className="label-sm">${token.description}</div>
            </div>
          </div>
        `)}
      </div>
    <//>
  `
}

function Palettes() {
  const { data: edgeTypes } = useApi('/api/edge-types')
  const { data: templates } = useApi('/api/templates')
  const coloured = (templates ?? []).filter(template => template?.ui?.colour)
  const edges = (edgeTypes ?? []).filter(def => def.colour)
  return html`
    <${Section} id="palettes" title="Kind, edge-type and pack palettes" intro="Pack colours are data: they reach the page as --node-colour and --edge-colour, and the tint, border and text colours are derived per theme.">
      <div className="card">
        <div className="card-head">Kind palette</div>
        <div className="card-body content">
          <div className="styleguide-grid">
            ${KIND_TOKENS.map(token => html`
              <div className="styleguide-token" key=${token.name}>
                <${Swatch} token=${token.name} />
                <div className="mono weight-medium">${token.name}</div>
              </div>
            `)}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">Edge types</div>
        <div className="card-body content">
          <div className="meta-strip">
            ${(edgeTypes ?? []).map(def => html`
              <span key=${def.name} className="tag edge-type-tag edge-coloured" style=${edgeTypeStyle(def.name)}>${def.name}</span>
            `)}
          </div>
          ${(edgeTypes ?? []).length === 0 && html`<${EmptyState}>No edge types loaded.<//>`}
        </div>
      </div>
      <div className="card">
        <div className="card-head">Template colours</div>
        <div className="card-body content">
          <div className="meta-strip">
            ${(templates ?? []).map(template => html`<${TemplateBadge} key=${template.name} name=${template.name} template=${template.name} />`)}
          </div>
          ${(templates ?? []).length === 0 && html`<${EmptyState}>No templates loaded.<//>`}
        </div>
      </div>
      <div className="card" data-testid="pack-derivations">
        <div className="card-head">Pack-colour derivations</div>
        <div className="card-body content">
          ${coloured.slice(0, MAX_PACK_SAMPLES).map(template => html`
            <div className="styleguide-row" key=${template.name}>
              <span className="styleguide-row-label mono-meta">${template.name}</span>
              <div className="styleguide-derivation node-coloured" style=${templateColourStyle(template.name)}>
                <${Derivation} base="--node-colour" />
                <${Derivation} base="--node-tint" />
                <${Derivation} base="--node-border" />
                <${Derivation} base="--node-on-tint" />
              </div>
            </div>
          `)}
          ${edges.slice(0, MAX_PACK_SAMPLES).map(def => html`
            <div className="styleguide-row" key=${def.name}>
              <span className="styleguide-row-label mono-meta">${def.name}</span>
              <div className="styleguide-derivation edge-coloured" style=${edgeTypeStyle(def.name)}>
                <${Derivation} base="--edge-colour" />
                <${Derivation} base="--edge-tint" />
                <${Derivation} base="--edge-border" />
                <${Derivation} base="--edge-on-tint" />
              </div>
            </div>
          `)}
          ${coloured.length === 0 && edges.length === 0 && html`<${EmptyState}>The loaded packs define no colours.<//>`}
        </div>
      </div>
    <//>
  `
}

function Derivation({ base }) {
  return html`
    <span className="styleguide-chain">
      <${Swatch} token=${base} />
      <span className="mono-meta">${base}</span>
    </span>
  `
}

function Components() {
  return html`
    <${Section} id="components" title="Components" intro="Each standard component, written with its documented classes.">
      <div className="card">
        <div className="card-head">card-head</div>
        <div className="card-body content">
          <p>card-body inside content. <span className="node-owner-meta">node-owner-meta</span></p>
          <div className="meta-strip">
            <${StateTag} state="agreed" />
            <${StabilityTag} stability="stable" />
            <span className="chip">chip</span>
            <${TemplateBadge} name="template-badge" template="Unknown" />
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">Tags</div>
        <div className="card-body content">
          <div className="styleguide-row">
            <span className="tag state-draft">draft</span>
            <span className="tag state-proposed">proposed</span>
            <span className="tag state-agreed">agreed</span>
            <span className="tag state-implemented">implemented</span>
            <span className="tag state-future">future</span>
            <span className="tag state-removed">removed</span>
            <span className="tag state-disabled">disabled</span>
            <span className="tag state-error">error</span>
          </div>
          <div className="styleguide-row">
            <span className="tag stability-stable">stable</span>
            <span className="tag stability-unstable">unstable</span>
            <span className="tag stability-deprecated">deprecated</span>
            <span className="tag edge-type-tag edge-coloured" style=${edgeTypeStyle('calls')}>edge-type-tag</span>
            <span className="template-badge node-coloured" style=${templateColourStyle('Unknown')}>template-badge</span>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">Properties and tables</div>
        <div className="card-body content">
          <table className="prop-table">
            <tbody>
              <tr><td className="prop-key-cell"><span className="prop-key-label mono">name</span></td><td>orders</td></tr>
              <tr><td className="prop-key-cell"><span className="prop-key-label mono">owner</span></td><td><a className="node-ref-link" href="#/p/styleguide/home">node-ref-link</a></td></tr>
              <tr><td className="prop-key-cell"><span className="prop-key-label mono">unset</span></td><td><span className="prop-empty">-</span></td></tr>
            </tbody>
          </table>
          <div className="table-scroll">
            <table className="prop-table">
              <tbody>
                <tr><td>table-scroll</td><td>Wide tables scroll horizontally inside this wrapper.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">Icons, links and empty state</div>
        <div className="card-body content">
          <div className="styleguide-row">
            <span className="quick-links">
              <a className="quick-link" href="#/p/styleguide/home" title="Quick link" aria-label="Quick link"><${Icon} name="link" size=${12} /></a>
              <a className="quick-link" href="#/p/styleguide/home" title="Graph" aria-label="Graph"><${Icon} name="diagram-project" size=${12} /></a>
            </span>
            <i className="fa-solid fa-gear icon-sized icon-fixed" style=${{ '--icon-size': '14px' }} aria-hidden="true"></i>
            <span className="label-sm">icon-sized, icon-fixed</span>
          </div>
          <div className="empty-state">empty-state: nothing to show.</div>
        </div>
      </div>
    <//>
  `
}

function StateRow({ label, children }) {
  return html`
    <div className="styleguide-row" data-testid=${`state-${label.toLowerCase()}`}>
      <span className="styleguide-row-label label-xs">${label}</span>
      ${children}
    </div>
  `
}

/* Hover and focus cannot be forced by a class, so those samples are live and carry data-state for the browser spec,
   which hovers and focuses them before the contrast and visual checks. */
function States() {
  const trigger = (label, extra, attrs) => html`
    <span className="open-in"><button type="button" className=${extra ? `open-in-trigger ${extra}` : 'open-in-trigger'} aria-label=${`Open in (${label})`} ...${attrs}><${Icon} name="arrow-up-right-from-square" size=${12} /></button></span>
  `
  return html`
    <${Section} id="states" title="States" intro="Default, hover, focus, active, disabled and error. Hover and focus are live: point at or tab to the sample.">
      <div className="card">
        <div className="card-head">Open in trigger</div>
        <div className="card-body content">
          <${StateRow} label="Default">${trigger('default', '', {})}<//>
          <${StateRow} label="Hover">${trigger('hover', '', { 'data-state': 'hover' })}<span className="label-sm">hover me</span><//>
          <${StateRow} label="Focus">${trigger('focus', '', { 'data-state': 'focus' })}<span className="label-sm">tab to me</span><//>
          <${StateRow} label="Active">${trigger('active', 'active', { 'aria-expanded': 'true' })}<//>
          <${StateRow} label="Disabled">${trigger('disabled', 'state-disabled', { disabled: true })}<//>
          <${StateRow} label="Error">${trigger('error', 'state-error', {})}<//>
        </div>
      </div>
      <div className="card">
        <div className="card-head">Menu item</div>
        <div className="card-body content">
          <${StateRow} label="Default"><button type="button" className="settings-menu-item">Menu item</button><//>
          <${StateRow} label="Hover"><button type="button" className="settings-menu-item" data-state="hover">Menu item</button><span className="label-sm">hover me</span><//>
          <${StateRow} label="Focus"><button type="button" className="settings-menu-item" data-state="focus">Menu item</button><span className="label-sm">tab to me</span><//>
          <${StateRow} label="Active"><button type="button" className="settings-menu-item selected">Selected item</button><//>
          <${StateRow} label="Disabled"><button type="button" className="settings-menu-item state-disabled" disabled>Disabled item</button><//>
          <${StateRow} label="Error"><button type="button" className="settings-menu-item state-error">Error item</button><//>
        </div>
      </div>
      <div className="card">
        <div className="card-head">Quick link</div>
        <div className="card-body content">
          <${StateRow} label="Default"><a className="quick-link" href="#/p/styleguide/home" aria-label="Quick link (default)"><${Icon} name="link" size=${12} /></a><//>
          <${StateRow} label="Hover"><a className="quick-link" href="#/p/styleguide/home" aria-label="Quick link (hover)" data-state="hover"><${Icon} name="link" size=${12} /></a><span className="label-sm">hover me</span><//>
          <${StateRow} label="Focus"><a className="quick-link" href="#/p/styleguide/home" aria-label="Quick link (focus)" data-state="focus"><${Icon} name="link" size=${12} /></a><span className="label-sm">tab to me</span><//>
          <${StateRow} label="Active"><a className="quick-link active" href="#/p/styleguide/home" aria-label="Quick link (active)"><${Icon} name="link" size=${12} /></a><//>
          <${StateRow} label="Disabled"><a className="quick-link state-disabled" aria-disabled="true" aria-label="Quick link (disabled)"><${Icon} name="link" size=${12} /></a><//>
          <${StateRow} label="Error"><a className="quick-link state-error" href="#/p/styleguide/home" aria-label="Quick link (error)"><${Icon} name="link" size=${12} /></a><//>
        </div>
      </div>
      <div className="card">
        <div className="card-head">Node reference link</div>
        <div className="card-body content">
          <${StateRow} label="Default"><a className="node-ref-link" href="#/p/styleguide/home">orders.DomainModel.order</a><//>
          <${StateRow} label="Hover"><a className="node-ref-link" href="#/p/styleguide/home" data-state="hover">orders.DomainModel.order</a><span className="label-sm">hover me</span><//>
          <${StateRow} label="Focus"><a className="node-ref-link" href="#/p/styleguide/home" data-state="focus">orders.DomainModel.order</a><span className="label-sm">tab to me</span><//>
          <${StateRow} label="Active"><a className="node-ref-link active" href="#/p/styleguide/home">orders.DomainModel.order</a><//>
          <${StateRow} label="Disabled"><a className="node-ref-link state-disabled" aria-disabled="true">orders.DomainModel.order</a><//>
          <${StateRow} label="Error"><a className="node-ref-link state-error" href="#/p/styleguide/home">orders.DomainModel.order</a><//>
        </div>
      </div>
    <//>
  `
}

function Menus() {
  return html`
    <${Section} id="menus" title="Menus" intro="The Settings menu and the node-link (Open in) menu, shown open.">
      <div className="styleguide-menu-demo">
        <div className="settings-menu" role="menu" aria-label="Settings menu" data-testid="demo-settings-menu">
          <div className="settings-menu-label label-xs" role="presentation">Theme</div>
          <div role="group" aria-label="Theme choices">
            <button type="button" className="settings-menu-item" role="menuitemradio" aria-checked="true" tabIndex=${-1}><span className="settings-menu-mark" aria-hidden="true"></span>Light</button>
            <button type="button" className="settings-menu-item" role="menuitemradio" aria-checked="false" tabIndex=${-1}><span className="settings-menu-mark" aria-hidden="true"></span>Dark</button>
          </div>
          <div className="settings-menu-sep" role="separator"></div>
          <div className="settings-menu-label label-xs" role="presentation">Layout</div>
          <div role="group" aria-label="Layout choices">
            <button type="button" className="settings-menu-item" role="menuitemradio" aria-checked="true" tabIndex=${-1}><span className="settings-menu-mark" aria-hidden="true"></span>Default</button>
            <button type="button" className="settings-menu-item" role="menuitemradio" aria-checked="false" tabIndex=${-1}><span className="settings-menu-mark" aria-hidden="true"></span>Compact</button>
          </div>
          <div className="settings-menu-sep" role="separator"></div>
          <button type="button" className="settings-menu-item" role="menuitemcheckbox" aria-checked="true" tabIndex=${-1}><span className="settings-menu-switch" aria-hidden="true"></span>Debug mode</button>
          <div className="settings-menu-sep" role="separator"></div>
          <button type="button" className="settings-menu-item" role="menuitem" tabIndex=${-1}>Style guide</button>
        </div>
        <div className="open-in" data-testid="demo-open-in">
          <button type="button" className="open-in-trigger" aria-haspopup="menu" aria-expanded="true" aria-label="Open in" title="Open in"><${Icon} name="arrow-up-right-from-square" size=${12} /></button>
          <div className="open-in-menu" role="menu" aria-label="Open in menu">
            <a className="open-in-item" role="menuitem" tabIndex=${-1} href="#/p/styleguide/home">Explorer view</a>
            <a className="open-in-item selected" role="menuitem" tabIndex=${-1} href="#/p/styleguide/home">Graph</a>
            <div className="open-in-sep" role="separator"></div>
            <a className="open-in-item" role="menuitem" tabIndex=${-1} href="#/p/styleguide/home">View in graph</a>
          </div>
        </div>
      </div>
    <//>
  `
}

/* Layouts (ADR-011 section 6) are CSS-only and apply to the whole shell, so the guide lists every registered layout and
   the layout tokens as the active layout sets them, rather than previewing one inside the page. */
const LAYOUT_TOKENS = TOKENS.filter(token => token.scope === 'layout')

function Layouts() {
  const { data: plugins } = useApi('/api/plugins')
  const active = document.documentElement.getAttribute('data-layout') || 'default'
  const contributed = (Array.isArray(plugins) ? plugins : [])
    .filter(plugin => plugin?.status === 'enabled')
    .flatMap(plugin => (plugin.manifest?.contributes?.layouts ?? []).map(layout => ({ ...layout, pluginId: plugin.id })))
  const layouts = [{ id: 'default', label: 'Default', pluginId: 'host' }, ...contributed.filter(layout => layout.id !== 'default')]
  return html`
    <${Section} id="layouts" title="Layouts" intro="A layout sets only the layout tokens, independent of the theme. Switch layout from Settings; the values below are those of the active layout.">
      <div className="card">
        <div className="card-head">Registered layouts</div>
        <div className="card-body content">
          <table className="prop-table">
            <tbody>
              ${layouts.map(layout => html`
                <tr key=${layout.id} data-layout-id=${layout.id}>
                  <td className="prop-key-cell"><span className="prop-key-label mono">${layout.id}</span></td>
                  <td>${layout.label} <span className="label-xs">${layout.pluginId}${layout.id === active ? ' · active' : ''}</span></td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-head">Layout tokens</div>
        <div className="card-body content">
          <div className="styleguide-grid">
            ${LAYOUT_TOKENS.map(token => html`<${TokenCard} key=${token.name} token=${token} />`)}
          </div>
        </div>
      </div>
    <//>
  `
}

function Vocabulary() {
  return html`
    <${Section} id="vocabulary" title="Standard classes" intro=${`${CLASSES.length} classes of contract version ${CONTRACT_VERSION}, from web/sdk/classes.json.`}>
      <div className="card">
        <div className="card-body content">
          <table className="prop-table">
            <tbody>
              ${CLASSES.map(def => html`
                <tr key=${def.name} data-class=${def.name}>
                  <td className="prop-key-cell"><span className="prop-key-label mono">${def.name}</span></td>
                  <td>${def.description} <span className="label-xs">since ${def.since}</span></td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </div>
    <//>
  `
}

export function StyleGuidePage() {
  const ready = useStylesheet()
  useThemeVersion()
  if (!ready) return html`<div className="content"><p className="label-sm">Loading…</p></div>`
  return html`
    <div className="content" data-testid="styleguide">
      <h1>Style guide</h1>
      <p className="label-sm">The styling contract (ADR-011) rendered in the active theme. Switch theme from Settings.</p>
      <${ColourTokens} />
      <${Typography} />
      <${RadiiAndShadows} />
      <${Palettes} />
      <${Components} />
      <${States} />
      <${Menus} />
      <${Layouts} />
      <${Vocabulary} />
    </div>
  `
}
