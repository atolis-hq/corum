export function mount(el, ctx) {
  el.innerHTML = '<div class="content"><h1 data-testid="plugin-ok">OK plugin page</h1><p data-testid="plugin-ok-id"></p></div>'
  el.querySelector('[data-testid="plugin-ok-id"]').textContent = ctx.params.get('id') ?? ''
  return () => { el.innerHTML = '' }
}
