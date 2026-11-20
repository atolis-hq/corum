/* Host bootstrap: exposes the SDK and plugin registry to the Babel-compiled host shell. */
import * as sdk from 'corum:ui'
import { loadPlugins, pluginsChanged } from './plugin-loader.js'
import { createPluginContext } from './context.js'

const registry = sdk.createRegistry()

const fetchPlugins = () => fetch('/api/plugins', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : Promise.reject(new Error(`/api/plugins ${response.status}`)))

let loadedStatuses = null

const ready = loadPlugins({
  fetchPlugins,
  importModule: url => import(url),
  registry,
}).then(statuses => {
  loadedStatuses = statuses
  host.pluginsFailed = statuses === null
})

/* After a graph reload: true when the server's plugin list differs from what this page booted with. */
async function pluginsChangedOnServer() {
  try {
    return pluginsChanged(loadedStatuses, await fetchPlugins())
  } catch {
    return false
  }
}

/* Build the ctx for one page mount: `identity` is { pluginId, pageId }; state is the host's current view. */
function createContext(identity, state, onError) {
  return createPluginContext({
    ...identity,
    registry,
    hrefForNode: sdk.hrefForNode,
    owningRoot: sdk.owningRoot,
    matchKeysFor: sdk.matchKeysFor,
    navigate: sdk.navigate,
    buildRoute: window.CorumRouter.buildRoute,
  }, state, onError)
}

const host = { sdk, registry, ready, createContext, pluginsChangedOnServer, pluginsFailed: false }
window.CorumHost = host
