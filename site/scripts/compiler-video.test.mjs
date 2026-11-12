import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = path => fileURLToPath(new URL(path, import.meta.url))
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
test('the compiler-feedback recording contains an observed diagnostic and passing correction', () => {
  const proof = JSON.parse(readFileSync(file('../videos/compiler-feedback/recording.json'), 'utf8'))
  assert.equal(proof.schema, 1)
  assert.equal(proof.sourceSha256, hash(file('../videos/compiler-feedback/before.vibe')))
  assert.equal(proof.correctedSourceSha256, hash(file('../videos/compiler-feedback/after.vibe')))
  assert.equal(proof.videoSha256, hash(file('../public/videos/agent-loop.mp4')))
  assert.equal(proof.posterSha256, hash(file('../public/videos/agent-loop.jpg')))
  assert.equal(proof.commands.length, 2)
  assert.equal(proof.commands[0].command, 'bun run build')
  assert.equal(proof.commands[0].exitCode, 1)
  assert.match(proof.commands[0].output, /error EK3801: floatingEffect:/)
  assert.equal(proof.commands[1].command, 'bun run start')
  assert.equal(proof.commands[1].exitCode, 0)
  assert.match(proof.commands[1].output, /Hello, Ada!/)
  assert.doesNotMatch(JSON.stringify(proof), /vibelang-compiler-video-/)
})
