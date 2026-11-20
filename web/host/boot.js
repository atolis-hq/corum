/* Host bootstrap: exposes the SDK and plugin registry to the Babel-compiled host shell. */
import * as sdk from 'corum:ui'

window.CorumHost = { sdk, registry: sdk.createRegistry() }
