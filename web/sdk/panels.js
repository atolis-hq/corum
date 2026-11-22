/* Shared state panels: error, loading and empty. Wording is supplied by the caller. */
import { html } from './html.js'

export function ErrorPanel({ title, message, testId, className = 'content', style }) {
  return html`
    <div className=${className} style=${style} data-testid=${testId}>
      ${title ? html`<h1>${title}</h1>` : null}
      <p className="text-warning">${message}</p>
    </div>`
}

export function LoadingPanel({ message = 'Loading…', className = 'content', style, innerStyle }) {
  return html`<div className=${className} style=${style}><p className="label-sm" style=${innerStyle}>${message}</p></div>`
}

export function EmptyState({ className, children }) {
  return html`<div className=${className ? `empty-state ${className}` : 'empty-state'}>${children}</div>`
}
