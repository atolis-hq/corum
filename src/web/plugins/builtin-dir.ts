import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Directory of the built-in plugins shipped with Corum (`web/builtin`). */
export const BUILTIN_PLUGIN_DIR = path.join(here, '..', '..', '..', '..', 'web', 'builtin')
