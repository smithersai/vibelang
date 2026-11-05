import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

function render(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'vibelang-user-docs-'))
  try {
    cpSync(new URL('.', import.meta.url), join(root, 'site/scripts'), { recursive: true })
    mkdirSync(join(root, 'site/src/pages'), { recursive: true })
    mkdirSync(join(root, 'docs/user/src'), { recursive: true })
    writeFileSync(join(root, 'docs/user/inventory.md'), '## V4 sidebar in order\n### Guides\n- [Example](src/example.md)\n')
    writeFileSync(join(root, 'docs/user/src/example.md'), markdown)
    const result = spawnSync(process.execPath, [join(root, 'site/scripts/sync-user-docs.mjs'), join(root, 'docs/user')], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return readFileSync(join(root, 'site/src/pages/example.mdx'), 'utf8')
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test('rendered user docs hide harness directives in paired and single examples, preserving output and code', () => {
  const page = render([
    '# Example', '', 'A runnable example.', '',
    '```ts effect', '// run: console.log(value)', 'const value = 1', '// Output: 1', '```', '',
    '```vibe', '// run: Console.log(value)', 'const value = 1', '// Output: 1', '```', '',
    '  ~~~ts', '  // run: console.log(text)', '  const text = "// run: literal"', '  // Output: text', '  ~~~', '',
    'The prose marker // run: is ordinary text.', ''
  ].join('\n'))
  assert.doesNotMatch(page, /^\s*\/\/ run:/m)
  assert.match(page, /:::code-group/)
  assert.match(page, /\/\/ Output: 1/)
  assert.match(page, /\/\/ Output: text/)
  assert.match(page, /const text = "\/\/ run: literal"/)
  assert.match(page, /The prose marker \/\/ run: is ordinary text/)
})

test('user prose drops decision annotations without damaging diagnostics, proposal links, or code', () => {
  const page = render([
    '# Example', '', 'Examples (D126).',
    '**Classes** (D278, D304). Block params (block params, D188).',
    'A warning (`EK4402`, D108). Range (D284-D290).',
    '**Throw** (D186, [proposal](https://example.com/throw)).',
    'Keep inline `D126` and version D3D12.', '',
    '```ts', 'const D126 = "(D126)"', '// Output: D126', '```', ''
  ].join('\n'))
  assert.match(page, /Examples\./)
  assert.match(page, /\*\*Classes\*\*\./)
  assert.match(page, /\(block params\)/)
  assert.match(page, /\(`EK4402`\)/)
  assert.match(page, /Range\./)
  assert.match(page, /\[proposal\]\(https:\/\/example.com\/throw\)/)
  assert.match(page, /Keep inline `D126` and version D3D12/)
  assert.match(page, /const D126 = "\(D126\)"/)
  assert.doesNotMatch(page, /D278|D304|D188|D108|D284|D290|D186/)
})

test('descriptions skip complete fenced blocks before the first prose paragraph', () => {
  for (const marker of ['```', '~~~~', '  ~~~']) {
    const page = render([
      '# Example', '', marker + 'sh', 'bun create vibelang my-app',
      ...(marker.trim() === '```' ? [] : ['```']), 'cd my-app', marker.trim(), '',
      'The native `compiler` supports [apps](https://example.com).',
      'Install it with your package manager.', '', 'A later paragraph.', '',
    ].join('\n'))
    assert.match(page, /description: "The native compiler supports apps\. Install it with your package manager\."/)
    assert.match(page, /bun create vibelang my-app/)
  }
})

test('a code-only page has no description and code ends an existing paragraph', () => {
  assert.doesNotMatch(render('# Example\n\n```sh\ncommand\n```\n'), /^description:/m)
  assert.match(render('# Example\n\nFirst prose.\n```sh\ncommand\n```\nLater prose.\n'), /description: "First prose\."/)
})

test('a video line becomes a captioned HTML5 player, keeps the description, and stays inside prose only', () => {
  const page = render([
    '# Example', '', 'The intro paragraph.', '', '![Tests in {.vibe} <b>](/videos/clip-1.mp4)', '',
    '```md', '![kept](/videos/clip-1.mp4)', '```', ''
  ].join('\n'))
  assert.match(page, /<video controls preload="metadata" playsInline poster="\/videos\/clip-1\.jpg"><source src="\/videos\/clip-1\.mp4" type="video\/mp4" \/><\/video>/)
  assert.match(page, /<figcaption>Tests in &#123;\.vibe&#125; &lt;b&gt;<\/figcaption>/)
  assert.doesNotMatch(page, /autoPlay|autoplay/)
  assert.match(page, /description: "The intro paragraph\."/)
  assert.match(page, /```md\n!\[kept\]\(\/videos\/clip-1\.mp4\)\n```/)
})

test('Markdown copies drop video lines but keep them inside code fences', async () => {
  const { stripVideos } = await import('./user-docs.mjs')
  const text = ['Intro.', '', '![Caption](/videos/a-1.mp4)', '', '```md', '![Caption](/videos/a-1.mp4)', '```', '![Image](/images/a.png)'].join('\n')
  assert.equal(stripVideos(text), ['Intro.', '', '', '```md', '![Caption](/videos/a-1.mp4)', '```', '![Image](/images/a.png)'].join('\n'))
})
