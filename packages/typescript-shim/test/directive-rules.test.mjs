import assert from "node:assert/strict"
import { test } from "node:test"
import { createShimmedProject, runTsc, skipReason } from "./_helpers.mjs"

test("line 1 // @vibe with trailing whitespace activates Vibe mode", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/ws.ts": "// @vibe   \t  \nexport error E\nexport effect function ok() { return 1 }\n",
  })
  const res = runTsc(root, ["--noEmit"])
  assert.equal(res.status, 0, res.stdout + res.stderr)
})

test("UTF-8 BOM followed by // @vibe activates Vibe mode", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/bom.ts": "\uFEFF// @vibe\nexport error BomErr\nexport effect function ok() { return 2 }\n",
  })
  const res = runTsc(root, ["--noEmit"])
  assert.equal(res.status, 0, res.stdout + res.stderr)
})

test("shebang line followed by // @vibe activates Vibe mode", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/cli.ts": "#!/usr/bin/env node\n// @vibe\nexport effect function ok() { return 3 }\n",
  })
  const res = runTsc(root, ["--noEmit"])
  assert.equal(res.status, 0, res.stdout + res.stderr)
})

test("trailing text or line-2 placement keeps the file in stock TypeScript mode", { skip: skipReason }, (t) => {
  for (const [name, source] of [
    ["trailing-text.ts", "// @vibe extra\nexport effect function f() { return 1 }\n"],
    ["block-comment.ts", "/* @vibe */\nexport effect function f() { return 1 }\n"],
    ["line-two.ts", "export const before = 1\n// @vibe\nexport effect function f() { return 1 }\n"],
  ]) {
    const root = createShimmedProject(t, { [`src/${name}`]: source })
    const res = runTsc(root, ["--noEmit", "--pretty", "false"])
    assert.equal(res.status, 2, `${name}: expected TS syntax failure`)
    assert.match(res.stdout, /error TS\d+/, `${name}: expected TS error`)
    assert.doesNotMatch(res.stdout, /error EK\d+/, `${name}: must not emit EK diagnostics in plain TS mode`)
  }
})

test("marked .mts and .cts files compile with Vibe rules", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/a.mts": "// @vibe\nexport effect function m() { return 'mts' }\n",
    "src/b.cts": "// @vibe\nexport effect function c() { return 'cts' }\n",
  })
  const res = runTsc(root, ["--noEmit"])
  assert.equal(res.status, 0, res.stdout + res.stderr)
})

test("inline module declarations inside // @vibe .ts files report TS1540 per VIP-42", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/mod.ts": "// @vibe\nmodule helper { export const x = 1 }\n",
  })
  const res = runTsc(root, ["--noEmit", "--pretty", "false"])
  assert.equal(res.status, 2)
  assert.match(res.stdout, /TS1540/)
})
