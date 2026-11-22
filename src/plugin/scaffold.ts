import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BUILTIN_PLUGIN_DIR } from '../web/plugins/builtin-dir.js'
import { discoverPlugins } from '../web/plugins/discover.js'
import { parsePluginManifest } from '../web/plugins/manifest.js'

export type ScaffoldResult = { ok: true; dir: string; files: string[] } | { ok: false; errors: string[] }

/** `>=X.Y.0 <X.(Y+1).0` for the running Corum version. */
export function enginesRangeFor(corumVersion: string): string {
  const match = /^(\d+)\.(\d+)\./.exec(`${corumVersion}.`)
  if (!match) return '*'
  return `>=${match[1]}.${match[2]}.0 <${match[1]}.${Number(match[2]) + 1}.0`
}

export const THEME_FILE = 'theme.css'

/** A starting theme: a copy of the built-in light theme's documented tokens, with authoring notes. */
export function themeTemplate(): string {
  const light = readFileSync(path.join(BUILTIN_PLUGIN_DIR, 'themes', 'light.css'), 'utf8')
  const values = light.slice(light.indexOf(':root'))
  return `/* A Corum theme. Set documented tokens only (docs/styling.md): anything else is reported by \`corum plugin validate\`
   and ignored. Keep text on --background and --card at 4.5:1 or better. Corum scopes this file to
   html[data-theme="<id>"]; no selectors, @import or url() are allowed. Private primitives (--c-*) are fine. */
${values}`
}

export function manifestTemplate(id: string, corumVersion: string, theme = false): string {
  const themes = theme
    ? `  themes:
    - { id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)}, colorScheme: light, css: ./${THEME_FILE} }
`
    : ''
  return `id: ${JSON.stringify(id)}
version: "0.1.0"
engines:
  corum: "${enginesRangeFor(corumVersion)}"
main: ./index.js
contributes:
  pages:
    - id: home
      title: ${JSON.stringify(id)}
      icon: list
      order: 30
      mount: mountHome
  nodeActions:
    - id: open-home
      label: ${JSON.stringify(`Open ${id}`)}
      appliesTo: ["*"]
      page: home
${themes}`
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
export function scaffoldPlugin(id: string, dir: string, corumVersion: string, options: { theme?: boolean } = {}): ScaffoldResult {
  const manifest = manifestTemplate(id, corumVersion, options.theme === true)
  const { errors } = parsePluginManifest(manifest)
  if (errors.length > 0 || !/^[a-z0-9-]+$/.test(id)) {
    return { ok: false, errors: errors.length > 0 ? errors : [`id "${id}" must match ^[a-z0-9-]+$`] }
  }
  const builtin = discoverPlugins({
    builtinDir: BUILTIN_PLUGIN_DIR, graphDir: null, graphYaml: null, packPluginDirs: [],
  }).plugins.some(plugin => plugin.manifest.id === id)
  if (builtin) {
    return { ok: false, errors: [`id "${id}" belongs to a built-in plugin and cannot be replaced`] }
  }
  const target = path.resolve(dir)
  if (existsSync(target) && readdirSync(target).length > 0) {
    return { ok: false, errors: [`${target} already exists and is not empty; nothing was written`] }
  }
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, 'plugin.yaml'), manifest, { flag: 'wx' })
  writeFileSync(path.join(target, 'index.js'), entryTemplate(id), { flag: 'wx' })
  const files = ['plugin.yaml', 'index.js']
  if (options.theme === true) {
    writeFileSync(path.join(target, THEME_FILE), themeTemplate(), { flag: 'wx' })
    files.push(THEME_FILE)
  }
  return { ok: true, dir: target, files }
}
