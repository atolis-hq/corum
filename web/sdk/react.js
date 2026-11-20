/* React adapter: mount a React component under the framework-neutral mount contract. */
import React from 'react'
import { createRoot } from 'react-dom/client'

export function mountReact(Component) {
  return function mount(el, ctx) {
    const root = createRoot(el)
    root.render(React.createElement(Component, { ctx }))
    return () => root.unmount()
  }
}
