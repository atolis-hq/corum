import React from 'react'
import { html } from './html.js'

export function PropertyValue({ value, onNavigate }) {
  if (value === null || value === undefined) return html`<span className="prop-empty">-</span>`
  if (typeof value === 'object' && 'display' in value && 'nodeId' in value) {
    return html`<a className="node-ref-link" onClick=${() => onNavigate && onNavigate(value.nodeId)}>${value.display}</a>`
  }
  if (typeof value === 'object' && 'display' in value) {
    return html`<span>${value.display}</span>`
  }
  if (Array.isArray(value)) {
    return html`<span>${value.length === 1 ? '1 item' : `${value.length} items`}</span>`
  }
  if (typeof value === 'object') {
    return html`<span className="prop-empty">-</span>`
  }
  return html`<span>${String(value)}</span>`
}

export function InlineObjectValue({ value }) {
  if (!value || typeof value !== 'object') return html`<${PropertyValue} value=${value} />`
  const parts = Object.entries(value).filter(([, v]) => v !== null && v !== undefined)
  if (parts.length === 0) return html`<span className="prop-empty">-</span>`
  return html`
    <span>
      ${parts.map(([k, v], i) => html`
        <${React.Fragment} key=${k}>
          ${i > 0 && html`<span style=${{ margin: '0 6px', opacity: 0.4 }}>|</span>`}
          <span className="prop-key-label prop-key-label--inline mono">${k}:</span>${' '}${String(v)}
        <//>
      `)}
    </span>
  `
}

export function buildPropertyRows(entries, onNavigate, depth = 0, parentPath = '', propertyHints = {}) {
  return entries.flatMap(([key, value], index) => {
    const rowPath = parentPath ? `${parentPath}.${key}` : key;
    const rowKey = `${rowPath}:${index}`;
    const hint = depth === 0 ? propertyHints[key] : null;
    if (Array.isArray(value)) {
      const rows = [{
        key: rowKey,
        label: key,
        depth,
        value: html`<${PropertyValue} value=${value} onNavigate=${onNavigate} />`
      }];
      value.forEach((item, itemIndex) => {
        const itemPath = `${rowPath}[${itemIndex}]`;
        if (item && typeof item === 'object' && !('display' in item) && !Array.isArray(item)) {
          rows.push({
            key: `${itemPath}:group`,
            label: `[${itemIndex}]`,
            depth: depth + 1,
            value: html`<span className="prop-empty">-</span>`
          });
          rows.push(...buildPropertyRows(Object.entries(item), onNavigate, depth + 2, itemPath, propertyHints));
        } else {
          rows.push({
            key: `${itemPath}:value`,
            label: `[${itemIndex}]`,
            depth: depth + 1,
            value: html`<${PropertyValue} value=${item} onNavigate=${onNavigate} />`
          });
        }
      });
      return rows;
    }
    if (value && typeof value === 'object' && !('display' in value)) {
      if (hint?.as === 'inline') {
        return [{
          key: rowKey,
          label: key,
          depth,
          value: html`<span className="prop-empty">-</span>`
        }, ...Object.entries(value).map(([childKey, childValue], childIndex) => ({
          key: `${rowPath}.${childKey}:${childIndex}`,
          label: childKey,
          depth: depth + 1,
          value: html`<${InlineObjectValue} value=${childValue} />`
        }))];
      }
      return [{
        key: rowKey,
        label: key,
        depth,
        value: html`<span className="prop-empty">-</span>`
      }, ...buildPropertyRows(Object.entries(value), onNavigate, depth + 1, rowPath, propertyHints)];
    }
    return [{
      key: rowKey,
      label: key,
      depth,
      value: html`<${PropertyValue} value=${value} onNavigate=${onNavigate} />`
    }];
  });
}
export function TableScroll({ children, className = '' }) {
  return html`<div className="table-scroll"><div className=${className}>${children}</div></div>`
}

export function PropertiesTable({ properties, onNavigate, propertyHints = {} }) {
  const entries = Object.entries(properties ?? {})
  const rows = buildPropertyRows(entries, onNavigate, 0, '', propertyHints)
  if (entries.length === 0) {
    return html`<p className="label-sm" style=${{ padding: '10px 14px' }}>No properties.</p>`
  }
  return html`
    <${TableScroll}>
      <table className="prop-table">
        <tbody>
          ${rows.map(row => html`
            <tr key=${row.key} className=${`prop-row${row.depth > 0 ? ' nested' : ''}`}>
              <td className="mono prop-key-cell">
                <span className="prop-key-label" style=${{ '--prop-depth': row.depth }}>${row.label}</span>
              </td>
              <td>${row.value}</td>
            </tr>
          `)}
        </tbody>
      </table>
    <//>
  `
}
