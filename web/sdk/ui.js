import { html } from './html.js'

export function navigate(path) {
  window.location.hash = path
}

export function BrandMark({ size = 24, color = 'currentColor' }) {
  return html`
    <svg width=${size} height=${size} viewBox="0 0 110 110" aria-hidden="true">
      <g transform="translate(55 55)" stroke=${color} fill=${color} strokeLinecap="round">
        <path d="M43.8 3.8A44 44 0 0 1 38.1 22" fill="none" strokeWidth="7.5" opacity="0.55" />
        <path d="M38.1 22a44 44 0 1 1-19.5-61" fill="none" strokeWidth="7.5" />
        <circle r="3" opacity="0.3" />
        <circle r="1.8" />
        <path strokeWidth="3" d="M0 0v-26" /><circle cy="-26" r="4.5" opacity="0.85" />
        <path strokeWidth="3" d="m0 0 13-22" /><circle cx="13" cy="-22" r="3.5" opacity="0.78" />
        <path strokeWidth="3" d="m0 0 23-9" /><circle cx="23" cy="-9" r="4" opacity="0.72" />
        <path strokeWidth="2.5" opacity="0.7" d="m0 0 21 11" /><circle cx="21" cy="11" r="3" opacity="0.6" />
        <path strokeWidth="2.5" opacity="0.55" d="m0 0 9 23" /><circle cx="9" cy="23" r="3.5" opacity="0.5" />
        <path strokeWidth="2.5" opacity="0.55" d="m0 0-11 22" /><circle cx="-11" cy="22" r="3" opacity="0.48" />
        <path strokeWidth="3" d="m0 0-26 3" /><circle cx="-26" cy="3" r="4" opacity="0.75" />
        <path strokeWidth="3" d="m0 0-20-17" /><circle cx="-20" cy="-17" r="4.5" opacity="0.85" />
        <path strokeWidth="2" opacity="0.66" d="m0 0-8-23" /><circle cx="-8" cy="-23" r="3" opacity="0.62" />
      </g>
    </svg>
  `
}

export function Icon({ name, size }) {
  const style = size ? { fontSize: size } : undefined
  return html`<i className=${`fa-solid fa-${name}`} style=${style} aria-hidden="true"></i>`
}

export function StateTag({ state }) {
  return html`<span className=${`tag state-${state}`}>${state}</span>`
}

export function StabilityTag({ stability }) {
  return html`<span className=${`tag stability-${stability}`}>${stability}</span>`
}

export function Chip({ children, title }) {
  return html`<span className="chip" title=${title}>${children}</span>`
}

export function TemplateBadge({ name, colour }) {
  const style = colour ? { background: colour } : { background: 'var(--subtle-foreground)' }
  return html`<span className="template-badge" style=${style}>${name}</span>`
}
