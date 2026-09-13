import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { checkDocs, localLinks } from './check-docs.mjs'

test('extracts relative destinations and ignores external links and anchors', () => {
  assert.deepEqual(localLinks('[A](../a.md#section) [B](<my file.md>) ![C](image.png) [D](a%20b.md?x=1) [Web](https://example.com) [Anchor](#x)'),
    ['../a.md', 'my file.md', 'image.png', 'a b.md'])
})

test('does not validate example links inside fenced code', () => {
  assert.deepEqual(localLinks('```md\n[example](missing.md)\n```\n[real](real.md)'), ['real.md'])
})

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'angle-docs-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const root = join(directory, 'anglesite')
  function write(file, content = '') {
    const target = join(root, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const names = ['system-overview', 'development', 'release-checklist', 'documentation-policy', 'verification-log', 'product-completion-plan', 'account-access']
  write('README.md')
  write('docs/README.md', names.map((name) => `[${name}](${name}.md)`).join('\n'))
  write('docs/archive/README.md')
  for (const name of names) write(`docs/${name}.md`)
  return { root, write }
}

test('finds broken links and unindexed documentation', (t) => {
  const { root, write } = fixture(t)
  assert.deepEqual(checkDocs({ root }).errors, [])
  write('docs/orphan.md')
  write('docs/system-overview.md', '[broken](absent.md)')
  const result = checkDocs({ root })
  assert.equal(result.errors.length, 2)
  assert.match(result.errors.join('\n'), /missing absent.md/)
  assert.match(result.errors.join('\n'), /Not classified.*orphan.md/)
})

test('reports skipped sibling links and can require Kassa', (t) => {
  const { root, write } = fixture(t)
  write('README.md', '[Kassa](../kassa/docs/README.md)')
  assert.equal(checkDocs({ root }).skipped, 1)
  assert.deepEqual(checkDocs({ root }).errors, [])
  assert.match(checkDocs({ root, requireKassa: true }).errors[0], /Required sibling/)
})

test('checks sibling index, rules and document coverage when present', (t) => {
  const { root, write } = fixture(t)
  write('../kassa/README.md', '[docs](docs/README.md)')
  write('../kassa/AGENTS.md')
  write('../kassa/docs/README.md', '[architecture](architecture.md) [billing](billing.md)')
  write('../kassa/docs/architecture.md')
  write('../kassa/docs/billing.md')
  assert.deepEqual(checkDocs({ root, requireKassa: true }).errors, [])
  write('../kassa/docs/unlisted.md')
  assert.match(checkDocs({ root }).errors[0], /Not classified.*unlisted.md/)
})

test('checks the current billing runbook links as well as its index', (t) => {
  const { root, write } = fixture(t)
  write('../kassa/README.md'); write('../kassa/AGENTS.md')
  write('../kassa/docs/README.md', '[billing](billing.md)')
  write('../kassa/docs/billing.md', '[lab](../../anglesite/scripts/missing-lab.mjs)')
  assert.match(checkDocs({ root }).errors.join('\n'), /billing\.md.*missing.*missing-lab/)
})

test('a present sibling with a missing index fails instead of being skipped', (t) => {
  const { root, write } = fixture(t)
  write('../kassa/README.md')
  write('../kassa/AGENTS.md')
  const result = checkDocs({ root })
  assert.equal(result.skipped, 0)
  assert.match(result.errors[0], /Missing working document.*kassa\/docs\/README.md/)
})
