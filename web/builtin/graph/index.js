/* Graph plugin entry: the three-level component / interior / focus graph page. */
import { mountReact } from 'corum:ui/react'
import { GraphView } from './view.js'

export const mountGraph = mountReact(GraphView)
