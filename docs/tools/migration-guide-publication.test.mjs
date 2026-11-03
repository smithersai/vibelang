import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import fc from 'fast-check'

const source = process.env.MIGRATION_GUIDE_SOURCE || new URL('../user/src/setup/migrating-retired-forms.md', import.meta.url)
const guide = readFileSync(source, 'utf8')

function render(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'vibelang-migration-guide-'))
  try {
    cpSync(new URL('../../site/scripts/', import.meta.url), join(root, 'site/scripts'), { recursive: true })
    mkdirSync(join(root, 'site/src/pages'), { recursive: true })
    mkdirSync(join(root, 'docs/user/src/setup'), { recursive: true })
    writeFileSync(join(root, 'docs/user/inventory.md'), '## V4 sidebar in order\n### Setup\n- [Migration](src/setup/migrating-retired-forms.md)\n')
    writeFileSync(join(root, 'docs/user/src/setup/migrating-retired-forms.md'), markdown)
    const result = spawnSync(process.execPath, [join(root, 'site/scripts/sync-user-docs.mjs'), join(root, 'docs/user')], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return readFileSync(join(root, 'site/src/pages/setup/migrating-retired-forms.mdx'), 'utf8')
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test('the retired-forms migration guide publishes with its specification links intact', () => {
    const page = render(guide)
    assert.match(page, /https:\/\/vibelang\.sh\/vips\/0026-top-level-and-main#decision/)
    assert.match(page, /https:\/\/vibelang\.sh\/spec\/007-tooling#legacy-entry-dispatch-migration/)
    assert.match(page, /https:\/\/vibelang\.sh\/spec\/001-functions#api-identity/)
})

// The source page is the corpus: exercise each spec/VIP link with varying labels.
test('migration guide links survive label mutations during publication', () => {
  const links = [...guide.matchAll(/\[[^\]]+\]\((https:\/\/vibelang\.sh\/(?:spec|vips)\/[^)]+)\)/g)]
  assert.ok(links.length > 0)
  fc.assert(fc.property(
    fc.integer({ min: 0, max: links.length - 1 }),
    fc.array(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'), { minLength: 1, maxLength: 16 }),
    (index, letters) => {
      const link = links[index]
      const replacement = `[${letters.join('')}](${link[1]})`
      assert.ok(render(guide.replace(link[0], replacement)).includes(replacement))
    }
  ), { numRuns: 20, seed: 20261103 })
})
