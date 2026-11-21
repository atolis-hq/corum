import { message } from './lib/message.js'

export function mount(el, ctx) {
  const heading = document.createElement('h1')
  heading.textContent = message
  const selected = document.createElement('p')
  selected.dataset.testid = 'pack-demo-selected'
  selected.textContent = ctx.params.get('id') ?? 'No node selected'
  el.append(heading, selected)
  return () => el.replaceChildren()
}
