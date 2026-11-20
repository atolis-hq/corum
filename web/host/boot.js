/* Host bootstrap: exposes the SDK and plugin registry to the Babel-compiled host shell. */
import * as sdk from 'corum:ui'
import { loadPlugins } from './plugin-loader.js'

const registry = sdk.createRegistry()

const ready = loadPlugins({
  fetchPlugins: () => fetch('/api/plugins').then(response => response.ok ? response.json() : Promise.reject(new Error(`/api/plugins ${response.status}`))),
  importModule: url => import(url),
  registry,
})

window.CorumHost = { sdk, registry, ready }
