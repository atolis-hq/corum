import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parsePluginManifest } from '../web/plugins/manifest.js'

export type ScaffoldResult = { ok: true; dir: string; files: string[] } | { ok: false; errors: string[] }

/** `>=X.Y.0 <X.(Y+1).0` for the running Corum version. */
export function enginesRangeFor(corumVersion: string): string {
  const match = /^(\d+)\.(\d+)\./.exec(`${corumVersion}.`)
  if (!match) return '*'
  return `>=${match[1]}.${match[2]}.0 <${match[1]}.${Number(match[2]) + 1}.0`
}

export function manifestTemplate(id: string, corumVersion: string): string {
  return `id: ${id}
version: "0.1.0"
engines:
  corum: "${enginesRangeFor(corumVersion)}"
main: ./index.js
contributes:
  pages:
    - id: home
      title: ${id}
      icon: list
      order: 30
      mount: mountHome
  nodeActions:
    - id: open-home
      label: Open ${id}
      appliesTo: ["*"]
      page: home
`
}

export function entryTemplate(id: string): string {
  return `export function mountHome(el, ctx) {
  const content = document.createElement('section')
  content.setAttribute('data-testid', 'plugin-${id}')
  const title = document.createElement('h1')
  title.textContent = '${id}'
  const focus = document.createElement('p')
  const list = document.createElement('ul')
  content.append(title, focus, list)
  el.replaceChildren(content)

  let disposed = false
  let request = 0

  async function render() {
    const current = ++request
    focus.textContent = ctx.params.get('id')
      ? \`Opened for: \${ctx.params.get('id')}\`
      : 'Choose a node to open its view.'
    try {
      const nodes = await ctx.api.get('nodes')
      if (disposed || current !== request) return
      list.replaceChildren()
      for (const node of nodes) {
        const item = document.createElement('li')
        const link = document.createElement('a')
        link.href = ctx.hrefForNode(node.id)
        link.textContent = node.id
        item.append(link)
        list.append(item)
      }
    } catch (error) {
      if (!disposed && current === request) ctx.onError(error)
    }
  }

  const unsubscribe = ctx.subscribe(() => { void render() })
  void render()
  return () => {
    disposed = true
    unsubscribe()
    el.replaceChildren()
  }
}
`
}

/** Write a working plugin into `dir`. Writes nothing when the id is invalid or the directory is not empty. */
export function scaffoldPlugin(id: string, dir: string, corumVersion: string): ScaffoldResult {
  const manifest = manifestTemplate(id, corumVersion)
  const { errors } = parsePluginManifest(manifest)
  if (errors.length > 0 || !/^[a-z0-9-]+$/.test(id)) {
    return { ok: false, errors: errors.length > 0 ? errors : [`id "${id}" must match ^[a-z0-9-]+$`] }
  }
  const target = path.resolve(dir)
  if (existsSync(target) && readdirSync(target).length > 0) {
    return { ok: false, errors: [`${target} already exists and is not empty; nothing was written`] }
  }
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, 'plugin.yaml'), manifest, { flag: 'wx' })
  writeFileSync(path.join(target, 'index.js'), entryTemplate(id), { flag: 'wx' })
  return { ok: true, dir: target, files: ['plugin.yaml', 'index.js'] }
}
