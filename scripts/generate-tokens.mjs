#!/usr/bin/env node
/* Writes web/tokens.css from web/sdk/tokens.json. Run after editing the tokens: `npm run tokens`. */
import fs from 'node:fs'
import path from 'node:path'
import { TOKENS_CSS, generateTokensCss, readTokensJson } from './lib/tokens-css.mjs'

const root = process.cwd()
fs.writeFileSync(path.join(root, TOKENS_CSS), generateTokensCss(readTokensJson(root)))
console.log(`wrote ${TOKENS_CSS}`)
