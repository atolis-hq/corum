import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)
const { version } = _require('../../package.json') as { version: string }

const CORAL = '\x1b[38;2;232;97;74m'
const RESET = '\x1b[0m'

export type BannerEntry = { key: string; value: string }
export type BannerService = { name: string; url: string }

export function printBanner(options: {
  config: BannerEntry[]
  services: BannerService[]
  logger?: (line: string) => void
}): void {
  const { config, services, logger = console.error } = options
  const c = process.env.NO_COLOR ? '' : CORAL
  const r = process.env.NO_COLOR ? '' : RESET

  logger(`  ${c}· ·   ⡎⠑ ⡎⢱ ⣏⡱ ⡇⢸ ⡷⢾${r}`)
  logger(` ${c}· ◉ ·  ⠣⠔ ⠣⠜ ⠇⠱ ⠣⠜ ⠇⠸${r}`)
  logger(`  · ·   v${version}`)

  const keyWidth = config.length > 0 ? Math.max(...config.map(e => e.key.length)) : 0
  const minWidth = 44
  const contentWidth = Math.max(minWidth, ...config.map(e => e.key.length + 2 + e.value.length))
  logger('  ' + '─'.repeat(contentWidth))

  for (const { key, value } of config) {
    logger(`  ${key.padEnd(keyWidth)}  ${value}`)
  }

  if (services.length > 0) {
    logger('')
    for (const { name, url } of services) {
      logger(`  ${c}●${r} ${name}   ${c}${url}${r}`)
    }
  }
}
