import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function findTests(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) results.push(...findTests(p))
    else if (entry.endsWith('.test.js')) results.push(p)
  }
  return results
}

// Run web unit tests (they use their own assertion framework, not Node --test)
const webResult = spawnSync(process.execPath, [join('web', 'graph-utils.test.js')], { stdio: 'inherit' })
if ((webResult.status ?? 1) !== 0) process.exit(webResult.status ?? 1)

const files = findTests('dist/test')
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
