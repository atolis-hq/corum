import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Tests run from the repo root (`npm test`); the script lives outside the TS rootDir.
const root = process.cwd()
const lib: any = await import(pathToFileURL(join(root, 'scripts/lib/screenshots.mjs')).href)
const script = join(root, 'scripts/publish-screenshots.mjs')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

test('parseName accepts free-form stems with an exact suffix', () => {
  assert.deepEqual(lib.parseName('orders-card-mobile-dark-after.png'), {
    stem: 'orders-card-mobile-dark',
    side: 'after',
  })
  assert.deepEqual(lib.parseName('a-before.png'), { stem: 'a', side: 'before' })
})

test('parseName rejects bad names', () => {
  for (const n of ['a.png', 'a-After.png', 'a-after.PNG', 'a-after.jpg', '-after.png', 'a b-after.png', 'é-after.png']) {
    assert.equal(lib.parseName(n), null, n)
  }
})

test('validateFile checks signature and the 600 KB boundary', () => {
  const ok = Buffer.concat([PNG, Buffer.alloc(lib.MAX_BYTES - PNG.length)])
  assert.equal(ok.length, lib.MAX_BYTES)
  assert.deepEqual(lib.validateFile('a-after.png', ok), [])
  assert.equal(lib.validateFile('a-after.png', Buffer.concat([ok, Buffer.alloc(1)])).length, 1)
  assert.equal(lib.validateFile('a-after.png', Buffer.from('not a png')).length, 1)
})

test('buildMarkdown groups rows and marks unpaired cells', () => {
  const md = lib.buildMarkdown({
    repo: 'o/r',
    sha: 'abc',
    pr: '7',
    names: ['x-dark-after.png', 'x-dark-before.png', 'new-after.png'],
  })
  assert.match(md, /^## Screenshots\n/)
  assert.match(md, /\| new \| — \| !\[new after\]\(https:\/\/raw\.githubusercontent\.com\/o\/r\/abc\/pr-7\/new-after\.png\) \|/)
  assert.match(md, /\| x-dark \| !\[x dark before\]\(.*pr-7\/x-dark-before\.png\) \| !\[x dark after\]/)
  assert.deepEqual(lib.unpairedStems(['new-after.png', 'x-before.png', 'x-after.png']).map((r: any) => r.stem), ['new'])
})

test('replaceSection appends, replaces, stops at next heading, ignores fences, is idempotent', () => {
  const sec = '## Screenshots\n\nNEW\n'
  assert.equal(lib.replaceSection('', sec), sec)
  assert.equal(lib.replaceSection('intro', sec), 'intro\n\n## Screenshots\n\nNEW\n')
  const mid = 'intro\n\n## Screenshots\n\nOLD\n\n## Test plan\n\n- x\n'
  assert.equal(lib.replaceSection(mid, sec), 'intro\n\n## Screenshots\n\nNEW\n\n## Test plan\n\n- x\n')
  assert.equal(lib.replaceSection('intro\n\n## Screenshots\n\nOLD', sec), 'intro\n\n## Screenshots\n\nNEW\n')
  const fenced = 'a\n\n```md\n## Screenshots\nkeep\n```\n'
  const out = lib.replaceSection(fenced, sec)
  assert.ok(out.startsWith(fenced.trimEnd()))
  assert.ok(out.endsWith('## Screenshots\n\nNEW\n'))
  const once = lib.replaceSection(mid, sec)
  assert.equal(lib.replaceSection(once, sec), once)
})

test('repoFromUrl handles https and ssh', () => {
  assert.equal(lib.repoFromUrl('https://github.com/a/b.git'), 'a/b')
  assert.equal(lib.repoFromUrl('git@github.com:a/b.git'), 'a/b')
  assert.equal(lib.repoFromUrl('/tmp/x.git'), null)
})

function sh(cwd: string, cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

function publish(dir: string, remote: string, pr = '9') {
  return sh(root, process.execPath, [script, '--pr', pr, '--dir', dir, '--remote', remote, '--repo', 'o/r'])
}

test('publish script against a local bare remote', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pubshots-'))
  try {
    const bare = join(tmp, 'remote.git')
    sh(tmp, 'git', ['init', '-q', '--bare', bare])
    const dir = join(tmp, 'shots')
    mkdirSync(dir)
    writeFileSync(join(dir, 'p-before.png'), PNG)
    writeFileSync(join(dir, 'p-after.png'), PNG)

    const r1 = publish(dir, bare)
    assert.equal(r1.status, 0, r1.err)
    const sha1 = /at ([0-9a-f]{40})/.exec(r1.out)![1]
    assert.match(r1.out, new RegExp(`o/r/${sha1}/pr-9/p-after\\.png`))
    assert.equal(sh(bare, 'git', ['rev-parse', 'pr-assets']).out, sha1)
    assert.equal(sh(bare, 'git', ['rev-list', '--max-parents=0', 'pr-assets']).out, sha1)

    // unchanged rerun reuses the SHA
    const r2 = publish(dir, bare)
    assert.equal(/at ([0-9a-f]{40})/.exec(r2.out)![1], sha1)

    // replacing: old files removed, new ones present, history kept
    rmSync(join(dir, 'p-before.png'))
    writeFileSync(join(dir, 'q-after.png'), PNG)
    const r3 = publish(dir, bare)
    assert.equal(r3.status, 0, r3.err)
    const sha3 = /at ([0-9a-f]{40})/.exec(r3.out)![1]
    assert.notEqual(sha3, sha1)
    assert.deepEqual(sh(bare, 'git', ['ls-tree', '--name-only', '-r', 'pr-assets']).out.split('\n'), [
      'pr-9/p-after.png',
      'pr-9/q-after.png',
    ])
    assert.equal(sh(bare, 'git', ['cat-file', '-t', sha1]).out, 'commit')

    // another PR's directory is untouched
    const r4 = publish(dir, bare, '10')
    assert.equal(r4.status, 0, r4.err)
    assert.equal(sh(bare, 'git', ['ls-tree', '--name-only', '-r', 'pr-assets']).out.split('\n').length, 4)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('publish script refuses bad files and reports push failure', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pubshots-'))
  try {
    const bare = join(tmp, 'remote.git')
    sh(tmp, 'git', ['init', '-q', '--bare', bare])
    const dir = join(tmp, 'shots')
    mkdirSync(dir)
    writeFileSync(join(dir, 'p-after.png'), PNG)
    writeFileSync(join(dir, 'notes.txt'), 'x')
    const bad = publish(dir, bare)
    assert.notEqual(bad.status, 0)
    assert.match(bad.err, /notes\.txt/)
    assert.deepEqual(readdirSync(join(bare, 'refs/heads')), [])

    rmSync(join(dir, 'notes.txt'))
    const gone = publish(dir, join(tmp, 'missing.git'))
    assert.notEqual(gone.status, 0)
    assert.match(gone.err, /Check remote access/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
