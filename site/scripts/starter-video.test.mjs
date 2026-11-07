import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = path => fileURLToPath(new URL(path, import.meta.url))
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
test('the starter-test recording is tied to its tested source and encoded assets', () => {
  const source = file('../videos/starter-test/greeting.test.vibe')
  const proof = JSON.parse(readFileSync(file('../videos/starter-test/recording.json'), 'utf8'))
  assert.equal(proof.schema, 1)
  assert.equal(proof.sourceSha256, hash(source))
  assert.equal(proof.videoSha256, hash(file('../public/videos/term-test.mp4')))
  assert.equal(proof.posterSha256, hash(file('../public/videos/term-test.jpg')))
  assert.match(readFileSync(source, 'utf8'), /try Effect\.try\(/)
  assert.doesNotMatch(readFileSync(source, 'utf8'), /\btry\s*\{/)
  assert.equal(proof.commands.length, 1)
  assert.equal(proof.commands[0].command, 'bun run test')
  assert.equal(proof.commands[0].exitCode, 0)
  assert.match(proof.commands[0].output, /Tests\s+2 passed/)
  assert.doesNotMatch(proof.commands[0].output, /vibelang-starter-video-/)
})
