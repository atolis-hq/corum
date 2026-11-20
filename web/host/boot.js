/* Host bootstrap: exposes the SDK and plugin registry to the Babel-compiled host shell. */
import * as sdk from 'corum:ui'
import { loadPlugins } from './plugin-loader.js'
import { createPluginContext } from './context.js'

const registry = sdk.createRegistry()

const ready = loadPlugins({
  fetchPlugins: () => fetch('/api/plugins').then(response => response.ok ? response.json() : Promise.reject(new Error(`/api/plugins ${response.status}`))),
  importModule: url => import(url),
  registry,
})

/* Build the ctx for one page mount: `identity` is { pluginId, pageId }; state is the host's current view. */
function createContext(identity, state, onError) {
  return createPluginContext({
    ...identity,
    registry,
    hrefForNode: sdk.hrefForNode,
    matchKeysFor: sdk.matchKeysFor,
    navigate: sdk.navigate,
    buildRoute: window.CorumRouter.buildRoute,
  }, state, onError)
}

window.CorumHost = { sdk, registry, ready, createContext }
