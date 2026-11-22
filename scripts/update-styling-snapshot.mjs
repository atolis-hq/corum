#!/usr/bin/env node
/* Rewrites test/fixtures/styling-contract.snapshot.json from the current tokens.json and classes.json.
   Run `npm run styling:snapshot` in the same change as an intentional contract change (docs/styling.md). */
import fs from 'node:fs'
import path from 'node:path'
import { SNAPSHOT_PATH, snapshotOf } from './lib/contract-snapshot.mjs'
import { readTokensJson } from './lib/tokens-css.mjs'

const root = process.cwd()
const classes = JSON.parse(fs.readFileSync(path.join(root, 'web', 'sdk', 'classes.json'), 'utf8'))
fs.writeFileSync(path.join(root, SNAPSHOT_PATH), `${JSON.stringify(snapshotOf(readTokensJson(root), classes), null, 2)}\n`)
console.log(`wrote ${SNAPSHOT_PATH}`)
