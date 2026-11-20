/* Corum UI SDK: the plugin-facing module behind the `corum:ui` import-map specifier. */
import React from 'react'
import htm from 'htm'

export const html = htm.bind(React.createElement)

export { navigate, BrandMark, Icon, StateTag, StabilityTag, Chip, TemplateBadge } from './ui.js'
export { PropertyValue, PropertiesTable } from './properties.js'
export { SchemaCard } from './schema-card.js'
export { createRegistry } from './registry.js'
export { resolveNodeTarget, hrefForNode } from './resolve-node.js'
export { matchKeysFor } from './match-keys.js'
