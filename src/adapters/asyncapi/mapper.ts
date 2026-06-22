import type { OperationInterface, MessageInterface, AsyncAPIDocumentInterface } from '@asyncapi/parser'
import type { Node, Edge, Diagnostic } from '../../schema/index.js'
import type { AdapterPackConfig } from '../index.js'
import type { AsyncAPIImportEntry, FieldStrategy } from '../../import/config.js'

export interface MapResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

export function extractValue(
  strategy: FieldStrategy,
  operation: OperationInterface,
  message: MessageInterface,
): string | undefined {
  switch (strategy.strategy) {
    case 'channel-segment': {
      const address = operation.channels().all()[0]?.address() ?? ''
      const parts = address.split(strategy.separator).filter(s => s.length > 0)
      const idx = strategy.segment < 0 ? parts.length + strategy.segment : strategy.segment
      return parts[idx]
    }
    case 'channel-pattern': {
      const address = operation.channels().all()[0]?.address() ?? ''
      const match = address.match(strategy.pattern)
      return match?.[1] ?? match?.[0]
    }
    case 'name-segment': {
      const source = message.name() ?? message.id()
      if (!source) return undefined
      const parts = source.split(strategy.separator).filter(s => s.length > 0)
      const idx = strategy.segment < 0 ? parts.length + strategy.segment : strategy.segment
      return parts[idx]
    }
    case 'name-pattern': {
      const source = message.name() ?? message.id()
      if (!source) return undefined
      const match = source.match(strategy.pattern)
      return match?.[1] ?? match?.[0]
    }
    case 'tag': {
      const msgTags = message.tags().all()
      if (msgTags.length > 0) return msgTags[0].name()
      const opTagsFn = (operation as unknown as { tags?: () => { all: () => Array<{ name(): string }> } }).tags
      const opTags = opTagsFn?.()?.all?.() ?? []
      return opTags[0]?.name()
    }
    case 'hardcoded':
      return strategy.value
  }
}

export function deriveScalarType(
  type: string,
  format: string | undefined,
  scalarTypes: Record<string, string>,
): string | undefined {
  if (format && scalarTypes[`${type}/${format}`]) return scalarTypes[`${type}/${format}`]
  return scalarTypes[type]
}

// Placeholder — completed in Task 7
export function mapDocument(
  _document: AsyncAPIDocumentInterface,
  _entry: AsyncAPIImportEntry,
  _packConfig: AdapterPackConfig,
): MapResult {
  return { nodes: [], edges: [], diagnostics: [] }
}
