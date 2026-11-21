/* Host plugin loader: registers server-reported plugins and lazily imports their entry module. */

function assetUrl(base, id, main) {
  return `${base}${encodeURIComponent(id)}/${String(main).replace(/^(\.\/)+/, '')}`
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function signatureOf(statuses) {
  return JSON.stringify(
    statuses
      .map(item => [item.id, item.status, item.version ?? item.manifest?.version ?? '', item.revision ?? ''])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  )
}

/** True when the plugin list (ids, statuses, versions, development revisions) differs; a failed re-fetch (null) is not a change. */
export function pluginsChanged(previous, next) {
  if (!Array.isArray(next)) return false
  if (!Array.isArray(previous)) return true
  return signatureOf(previous) !== signatureOf(next)
}

/** Registers the server-reported plugins; resolves to the status list, or null if it could not be loaded. */
export async function loadPlugins({ fetchPlugins, importModule, registry, base = '/plugins/' }) {
  let statuses
  try {
    statuses = await fetchPlugins()
  } catch (error) {
    console.error('Failed to load plugin list', error)
    return null
  }
  if (!Array.isArray(statuses)) return null

  for (const status of statuses) {
    let promise = null
    const entry = {
      ...status,
      load() {
        if (!promise) {
          promise = Promise.resolve()
            .then(() => importModule(assetUrl(base, status.id, status.manifest.main)))
            .catch(error => {
              entry.status = 'unavailable'
              entry.reason = `Failed to load: ${messageOf(error)}`
              throw error
            })
        }
        return promise
      },
    }
    registry.registerPlugin(entry)
  }
  return statuses
}
