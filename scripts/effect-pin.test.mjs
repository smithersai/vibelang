import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { RUNTIME, SOURCES, drift, rewrite, write } from "./effect-pin.mjs"

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// The 4.1.0 bump left 27 compiler cases on 4.0.5 and 4.0.6: a case copied
// from an older one keeps its pin, and nothing compared them.
test("every manifest and version literal pins the runtime's Effect version", () => {
  const found = drift(repo).map((d) => `${d.file}: ${d.section} ${d.name} ${d.pin}`)
  assert.deepEqual(found, [], "run: node scripts/effect-pin.mjs --write")
})

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "effect-pin-"))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  return root
}

test("--write moves every pin and keeps each manifest's formatting", (t) => {
  const root = fixture({
    [RUNTIME]: JSON.stringify({ name: "vibelang-runtime", peerDependencies: { effect: "4.1.0" }, devDependencies: { effect: "4.1.0", "@effect/platform-node": "4.1.0" } }, null, 2) + "\n",
    [SOURCES[0][0]]: 'export const PINNED_EFFECT_VERSION = "4.1.0"\n',
    [SOURCES[2][0]]: 'package vibelang\n\nconst supportedEffectVersion = "4.0.6"\n',
    "cases/a/package.json": '{"private":true,"type":"module","dependencies":{"effect":"4.0.6","vibelang-runtime":"0.0.1"}}',
    "cases/b/package.json": '{ "type": "module", "dependencies": { "effect": "4.1.0", "@effect/platform-node": "4.0.5", "@effect/language-service": "0.9.0" } }\n',
    "examples/app/package.json": '{\n  "dependencies": {\n    "effect": "4.1.0"\n  }\n}\n',
    "examples/app/bun.lock": "{}\n",
    ".smithers/package.json": '{"dependencies":{"effect":"4.0.6"}}',
    "examples/app/node_modules/effect/package.json": '{"name":"effect","version":"3.0.0"}',
    // A run's output, ignored by the repository, keeps the pin of its day.
    "cases/a/out/rewrite-evidence/package.json": '{"dependencies":{"@effect/platform-node":"4.0.6"}}'
  })
  t.after(() => rmSync(root, { recursive: true, force: true }))

  assert.deepEqual(drift(root).map((d) => [d.file, d.name, d.pin]), [
    ["cases/a/package.json", "effect", "4.0.6"],
    ["cases/b/package.json", "@effect/platform-node", "4.0.5"],
    [SOURCES[2][0], "literal", "4.0.6"]
  ])
  assert.deepEqual(write(root), { version: "4.1.0", changed: ["cases/a/package.json", "cases/b/package.json", SOURCES[2][0]], installs: [] })
  assert.equal(readFileSync(path.join(root, "cases/a/package.json"), "utf8"), '{"private":true,"type":"module","dependencies":{"effect":"4.1.0","vibelang-runtime":"0.0.1"}}')
  assert.equal(readFileSync(path.join(root, "cases/b/package.json"), "utf8"), '{ "type": "module", "dependencies": { "effect": "4.1.0", "@effect/platform-node": "4.1.0", "@effect/language-service": "0.9.0" } }\n')
  assert.deepEqual(drift(root), [])

  const moved = write(root, "4.2.0")
  assert.equal(moved.version, "4.2.0")
  assert.deepEqual(moved.installs, ["examples/app"])
  assert.equal(JSON.parse(readFileSync(path.join(root, RUNTIME), "utf8")).peerDependencies.effect, "4.2.0")
  assert.equal(readFileSync(path.join(root, SOURCES[0][0]), "utf8"), 'export const PINNED_EFFECT_VERSION = "4.2.0"\n')
  assert.equal(readFileSync(path.join(root, SOURCES[2][0]), "utf8"), 'package vibelang\n\nconst supportedEffectVersion = "4.2.0"\n')
  assert.equal(readFileSync(path.join(root, "examples/app/package.json"), "utf8"), '{\n  "dependencies": {\n    "effect": "4.2.0"\n  }\n}\n')
  assert.equal(readFileSync(path.join(root, ".smithers/package.json"), "utf8"), '{"dependencies":{"effect":"4.0.6"}}', "a tool's own Effect stays")
  assert.deepEqual(drift(root), [])
})

// packages/vite's tests copy the runtime's manifest under an ignored .fixtures,
// so a workspace whose copy predates a pin move read as drift.
test("a test's ignored fixture copy is not a pin", (t) => {
  const root = fixture({
    [RUNTIME]: JSON.stringify({ peerDependencies: { effect: "4.1.1" } }),
    "packages/vite/test/.fixtures/vibelang-runtime/package.json": '{"dependencies":{"effect":"4.1.0"}}'
  })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(drift(root), [])
})

test("rewrite refuses an edit that reaches beyond the pins", () => {
  assert.throws(() => rewrite('{"scripts":{"effect":"node effect.mjs"},"dependencies":{"effect":"4.0.6"}}', ["effect"], "4.1.0"), /more than their pins/)
})
