import { parseWriteSmokeCliArgs, runWriteSmokeCli } from '../dist/src/mcp/write-smoke.js'

await runWriteSmokeCli(parseWriteSmokeCliArgs(process.argv.slice(2)))
