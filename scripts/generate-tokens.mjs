#!/usr/bin/env node
/* Writes web/tokens.css, the built-in light theme and the style guide's contract module from web/sdk/tokens.json and
   classes.json. Run after editing the contract: `npm run tokens`. */
import fs from 'node:fs'
import path from 'node:path'
import {
  LIGHT_THEME_CSS,
  STYLEGUIDE_CONTRACT_JS,
  TOKENS_CSS,
  generateLightThemeCss,
  generateStyleguideContractJs,
  generateTokensCss,
  readClassesJson,
  readTokensJson,
} from './lib/tokens-css.mjs'

const root = process.cwd()
const doc = readTokensJson(root)
fs.writeFileSync(path.join(root, TOKENS_CSS), generateTokensCss(doc))
console.log(`wrote ${TOKENS_CSS}`)
fs.writeFileSync(path.join(root, LIGHT_THEME_CSS), generateLightThemeCss(doc))
console.log(`wrote ${LIGHT_THEME_CSS}`)
fs.mkdirSync(path.dirname(path.join(root, STYLEGUIDE_CONTRACT_JS)), { recursive: true })
fs.writeFileSync(path.join(root, STYLEGUIDE_CONTRACT_JS), generateStyleguideContractJs(doc, readClassesJson(root)))
console.log(`wrote ${STYLEGUIDE_CONTRACT_JS}`)
