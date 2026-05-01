import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as git from 'isomorphic-git'
import { SourceError } from './index.js'

const CACHE_BASE = path.join(os.homedir(), '.config', 'corum', 'cache')

export class GitCacheManager {
  cacheDir(remoteUrl: string): string {
    const hash = createHash('sha256').update(remoteUrl).digest('hex').slice(0, 16)
    return path.join(CACHE_BASE, hash)
  }

  async ensureCloned(
    remoteUrl: string,
    onAuth?: () => { username: string; password: string },
  ): Promise<string> {
    const dir = this.cacheDir(remoteUrl)
    mkdirSync(dir, { recursive: true })

    if (!existsSync(path.join(dir, '.git'))) {
      await clone(remoteUrl, dir, onAuth)
      return dir
    }

    try {
      await git.fetch({
        fs,
        http: (await import('isomorphic-git/http/node')).default,
        dir,
        remote: 'origin',
        singleBranch: false,
        onAuth,
      })
    } catch {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      await clone(remoteUrl, dir, onAuth, 'failed to recover cache')
    }

    return dir
  }
}

async function clone(
  remoteUrl: string,
  dir: string,
  onAuth?: () => { username: string; password: string },
  message = 'failed to clone',
): Promise<void> {
  try {
    await git.clone({
      fs,
      http: (await import('isomorphic-git/http/node')).default,
      dir,
      url: remoteUrl,
      noCheckout: true,
      singleBranch: false,
      onAuth,
    })
  } catch (err) {
    throw new SourceError(`${message} ${remoteUrl}`, err)
  }
}
