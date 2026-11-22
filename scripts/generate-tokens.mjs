#!/usr/bin/env node
/* Writes web/tokens.css and the built-in light theme from web/sdk/tokens.json. Run after editing the tokens: `npm run tokens`. */
import fs from 'node:fs'
import path from 'node:path'
import { LIGHT_THEME_CSS, TOKENS_CSS, generateLightThemeCss, generateTokensCss, readTokensJson } from './lib/tokens-css.mjs'

const root = process.cwd()
const doc = readTokensJson(root)
fs.writeFileSync(path.join(root, TOKENS_CSS), generateTokensCss(doc))
console.log(`wrote ${TOKENS_CSS}`)
fs.writeFileSync(path.join(root, LIGHT_THEME_CSS), generateLightThemeCss(doc))
console.log(`wrote ${LIGHT_THEME_CSS}`)
