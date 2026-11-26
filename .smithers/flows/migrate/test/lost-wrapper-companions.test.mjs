import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { bodyCompanionsOf, companionClosureOf, lostWrapperCheck } from "../lib/lost-wrapper.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const cli = fileURLToPath(new URL("../lost-wrappers.mjs", import.meta.url))
const put = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

test("#395: companionClosureOf resolves encoded $call$ts and uppercase companions plus transitive imports", () => {
  const root = mkdtempSync(join(tmpdir(), "lost-wrapper-encoded-companion-"))
  try {
    const main = join(root, "mod.js")
    const callCompanion = join(root, "mod.vibe.-24-call-24-ts.js")
    const upperCompanion = join(root, "mod.vibe.-50-latform.js")
    const mainText = 'import { runCall } from "./mod.vibe.-24-call-24-ts.js";\nexport { runCall };\n'
    const callText = 'import { helper } from "./mod.vibe.-50-latform.js";\nexport const runCall = () => helper();\n'
    const upperText = 'import * as Effect from "effect/Effect";\nexport const helper = () => Effect.succeed(1);\n'
    put(root, "mod.js", mainText)
    put(root, "mod.vibe.-24-call-24-ts.js", callText)
    put(root, "mod.vibe.-50-latform.js", upperText)

    const closure = companionClosureOf("src/mod.vibe", { path: main, text: mainText })
    assert.deepEqual(closure.missing, [])
    assert.deepEqual(closure.companions.map(c => c.path).sort(), [callCompanion, upperCompanion].sort())
    assert.deepEqual(bodyCompanionsOf("src/mod.vibe", { path: main, text: mainText }).map(c => c.path).sort(), [callCompanion, upperCompanion].sort())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#395: missing referenced $call$ts companion marks the module unchecked instead of passing silently", () => {
  const original = `import { Effect } from "effect"\nexport const runCall = () => Effect.succeed(1)\n`
  const emitted = `import { runCall } from "./mod.vibe.-24-call-24-ts.js";\nexport { runCall };\n`
  const result = lostWrapperCheck({
    ts,
    files: ["src/mod.vibe"],
    original: () => ({ path: "src/mod.ts", text: original }),
    emitted: () => ({ path: "/virtual/mod.js", text: emitted }),
    read: () => null
  })
  assert.equal(result.unchecked.length, 1, JSON.stringify(result))
  assert.equal(result.unchecked[0].file, "src/mod.vibe")
  assert.match(result.unchecked[0].reason, /mod\.vibe\.-24-call-24-ts\.js/)
})

test("#395: present $call$ts companion participates in lost-wrapper flagging", () => {
  const original = `import { Effect } from "effect"\nexport const runCall = () => Effect.succeed(1)\n`
  const emitted = `import { runCall } from "./mod.vibe.-24-call-24-ts.js";\nexport { runCall };\n`
  const companionPath = "/virtual/mod.vibe.-24-call-24-ts.js"
  const badCompanion = `export const runCall = () => 1;\n`
  const result = lostWrapperCheck({
    ts,
    files: ["src/mod.vibe"],
    original: () => ({ path: "src/mod.ts", text: original }),
    emitted: () => ({ path: "/virtual/mod.js", text: emitted }),
    read: path => (path === companionPath ? badCompanion : null)
  })
  assert.equal(result.unchecked.length, 0)
  assert.deepEqual(result.blocking.map(f => [f.file, f.function]), [["src/mod.vibe", "/runCall"]])
})

test("#395: lost-wrappers CLI refuses zero compared pairs and pairs .mts originals", () => {
  const root = mkdtempSync(join(tmpdir(), "lost-wrappers-cli-"))
  try {
    const orig = join(root, "orig")
    const conv = join(root, "conv")
    const js = join(root, "js")
    mkdirSync(orig, { recursive: true })
    mkdirSync(conv, { recursive: true })
    mkdirSync(js, { recursive: true })

    // Zero pairs compared MUST exit non-zero (never yield a pass).
    const zeroRun = spawnSync(process.execPath, [cli, "--orig", orig, "--conv", conv, "--js", js, "--ts", join(fileURLToPath(new URL("../../../../packages/runtime", import.meta.url)))], { encoding: "utf8" })
    assert.notEqual(zeroRun.status, 0, "comparing zero pairs must fail: " + zeroRun.stdout + zeroRun.stderr)

    // .mts original pairs with .vibe and passes when emitted JS preserves Effect.
    put(orig, "src/a.mts", 'import { Effect } from "effect"\nexport const f = () => Effect.succeed(1)\n')
    put(conv, "src/a.vibe", 'export effect function f() { return 1 }\n')
    put(js, "src/a.js", 'import * as Effect from "effect/Effect";\nexport const f = Effect.fnUntraced(function* () { return 1; });\n')
    const okRun = spawnSync(process.execPath, [cli, "--orig", orig, "--conv", conv, "--js", js, "--ts", join(fileURLToPath(new URL("../../../../packages/runtime", import.meta.url)))], { encoding: "utf8" })
    assert.equal(okRun.status, 0, okRun.stdout + okRun.stderr)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
