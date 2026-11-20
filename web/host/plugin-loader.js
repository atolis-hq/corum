/* Host plugin loader: registers server-reported plugins and lazily imports their entry module. */

function assetUrl(id, main) {
  return `/plugins/${encodeURIComponent(id)}/${String(main).replace(/^(\.\/)+/, '')}`
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

export async function loadPlugins({ fetchPlugins, importModule, registry }) {
  let statuses
  try {
    statuses = await fetchPlugins()
  } catch (error) {
    console.error('Failed to load plugin list', error)
    return
  }
  if (!Array.isArray(statuses)) return

  for (const status of statuses) {
    let promise = null
    const entry = {
      ...status,
      load() {
        if (!promise) {
          promise = Promise.resolve()
            .then(() => importModule(assetUrl(status.id, status.manifest.main)))
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
}
