import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { addProposalMarkdown } from './proposal-markdown.mjs'

test('the proposal index publishes Markdown copies with local documentation links', () => {
  const output = mkdtempSync(join(tmpdir(), 'vibe-proposal-markdown-'))
  try {
    const index = join(output, 'llms.txt')
    writeFileSync(index, '# VibeLang\n')
    const docs = fileURLToPath(new URL('../../docs', import.meta.url))
    const source = fileURLToPath(new URL('../src/pages/proposals.mdx', import.meta.url))
    addProposalMarkdown(output, docs, source)
    const llms = readFileSync(index, 'utf8')
    assert.match(llms, /## Improvement proposals/)
    for (const path of ['proposals.md', 'vips/index.md', 'vips/0001-effect-and-async-functions.md']) {
      assert.ok(llms.includes('https://vibelang.sh/' + path))
      assert.ok(existsSync(join(output, path)))
    }
    const vip = readFileSync(join(output, 'vips/0019-for-concurrent.md'), 'utf8')
    assert.match(vip, /https:\/\/vibelang\.sh\/spec\/[^)]+\.md/)
    assert.doesNotMatch(vip, /github\.com\/smithersai\/vibelang\/blob\/main\/docs\/design\/src\//)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})

test('the proposal overview points readers to shipped JSX and current platform boundaries', () => {
  const source = readFileSync(new URL('../src/pages/proposals.mdx', import.meta.url), 'utf8')
  assert.match(source, /Shipped as `\.vibex`/)
  assert.doesNotMatch(source, /\bbehind a hatch\b|\btrusted contracts?\b|\basync hatches?\b/)
})
