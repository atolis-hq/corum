#!/usr/bin/env node
// Publish before/after PR screenshots to the `pr-assets` branch and print/update the PR markdown.
// Usage: npm run screenshots:publish -- --pr <n> [--dir tmp/screenshots] [--remote origin]
//        [--repo owner/name] [--update-pr]
import { parseArgs } from 'node:util'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildMarkdown,
  readScreenshotDir,
  repoFromUrl,
  replaceSection,
  unpairedStems,
} from './lib/screenshots.mjs'

const BRANCH = 'pr-assets'

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

function git(cwd, args) {
  return run('git', args, { cwd })
}

function gitOrThrow(cwd, args) {
  const r = git(cwd, args)
  if (!r.ok) throw new Error(`git ${args.join(' ')} failed: ${r.err}`)
  return r.out
}

const { values } = parseArgs({
  options: {
    pr: { type: 'string' },
    dir: { type: 'string', default: 'tmp/screenshots' },
    remote: { type: 'string', default: 'origin' },
    repo: { type: 'string' },
    'update-pr': { type: 'boolean', default: false },
  },
})

if (!values.pr || !/^[1-9][0-9]*$/.test(values.pr)) fail('--pr <number> is required')
const pr = values.pr

let files
try {
  files = readScreenshotDir(values.dir)
} catch (e) {
  fail(e.message)
}

let remoteUrl = values.remote
const resolved = run('git', ['remote', 'get-url', values.remote])
if (resolved.ok) remoteUrl = resolved.out
const repo = values.repo ?? repoFromUrl(remoteUrl)
if (!repo) fail(`Cannot work out owner/repo from "${remoteUrl}". Pass --repo owner/name.`)

const names = files.map((f) => f.name)
for (const r of unpairedStems(names)) {
  console.error(`warning: "${r.stem}" has only a ${r.before ? 'before' : 'after'} image`)
}

const tmp = mkdtempSync(join(tmpdir(), 'pr-assets-'))
let sha
try {
  const clone = join(tmp, 'clone')
  mkdirSync(clone)
  gitOrThrow(clone, ['init', '-q'])
  gitOrThrow(clone, ['remote', 'add', 'origin', remoteUrl])
  const identity = [
    '-c',
    'user.name=corum-screenshots',
    '-c',
    'user.email=screenshots@users.noreply.invalid',
    '-c',
    'commit.gpgsign=false',
  ]

  const build = () => {
    const fetched = git(clone, [
      'fetch',
      '-q',
      'origin',
      `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`,
    ])
    if (fetched.ok) gitOrThrow(clone, ['checkout', '-q', '-f', '-B', BRANCH, `origin/${BRANCH}`])
    else if (!git(clone, ['rev-parse', '--verify', 'HEAD']).ok) {
      gitOrThrow(clone, ['checkout', '-q', '--orphan', BRANCH])
    }
    const dest = join(clone, `pr-${pr}`)
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest)
    for (const f of files) cpSync(f.path, join(dest, f.name))
    gitOrThrow(clone, ['add', '-A'])
    const dirty = git(clone, ['status', '--porcelain']).out
    if (dirty) gitOrThrow(clone, [...identity, 'commit', '-q', '-m', `Screenshots for PR #${pr}`])
    return { sha: gitOrThrow(clone, ['rev-parse', 'HEAD']), changed: Boolean(dirty), remoteHas: fetched.ok }
  }

  let built = build()
  if (built.changed || !built.remoteHas) {
    const pushArgs = ['push', 'origin', `HEAD:refs/heads/${BRANCH}`]
    let push = git(clone, pushArgs)
    if (!push.ok && /non-fast-forward|fetch first|rejected/i.test(push.err)) {
      built = build()
      push = git(clone, pushArgs)
    }
    if (!push.ok) {
      throw new Error(
        `Push to ${BRANCH} on ${remoteUrl} failed:\n${push.err}\n` +
          `Check remote access and auth, that the remote is correct, and that ${BRANCH} is not protected.`,
      )
    }
  }
  sha = built.sha
} catch (e) {
  rmSync(tmp, { recursive: true, force: true })
  fail(e.message)
}
rmSync(tmp, { recursive: true, force: true })

const markdown = buildMarkdown({ repo, sha, pr, names })
console.log(`Published to ${BRANCH} at ${sha}\n`)
console.log(markdown)

if (values['update-pr']) {
  const view = run('gh', ['pr', 'view', pr, '--json', 'body', '--jq', '.body'])
  if (!view.ok) fail(`gh pr view failed: ${view.err}\nImages are published (${sha}); rerun is safe.`)
  const bodyDir = mkdtempSync(join(tmpdir(), 'pr-body-'))
  const bodyFile = join(bodyDir, 'body.md')
  writeFileSync(bodyFile, replaceSection(view.out, markdown))
  const edit = run('gh', ['pr', 'edit', pr, '--body-file', bodyFile])
  rmSync(bodyDir, { recursive: true, force: true })
  if (!edit.ok) fail(`gh pr edit failed: ${edit.err}\nImages are published (${sha}); rerun is safe.`)
  console.error(`Updated PR #${pr} body.`)
}
