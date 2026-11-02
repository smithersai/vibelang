import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { splitPlatform } from "../lib/platform.mjs"

// codemod-gap:platform-split-file-pragmas (drive-t3code-apps 2026-11-02T02:42Z):
// t3code Desktop's ActiveWindow.ts and LinuxSnapShot.ts open with
// `// @effect-diagnostics nodeBuiltinImport:off -- ...` and a blank line. The
// platform split kept that header on the .vibe module only, so the sibling that
// now imports node:child_process reported EK3877 nodeBuiltinImport.

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const compiler = process.env.VIBELANG_BINARY

const activeWindow = readFileSync(new URL("./corpus/t3code-platform-file-directives.ts", import.meta.url), "utf8")
const linux = `// @effect-diagnostics globalTimers:off -- D-Bus deadlines run at a native async boundary.
// @effect-diagnostics nodeBuiltinImport:off -- Read the portal file through one bounded file descriptor at the native adapter boundary.

import * as NodeCrypto from "node:crypto";

export function token(): string {
  return NodeCrypto.randomUUID();
}
`

test("t3code Desktop: the platform sibling keeps the file's @effect-diagnostics directives", () => {
  const one = splitPlatform(activeWindow, "apps/desktop/src/snapShot/ActiveWindow.ts", ts)
  assert.ok(one.platform.startsWith("// @effect-diagnostics nodeBuiltinImport:off -- This platform boundary asks the OS for its foreground window with Node.\n\n// The platform code of ActiveWindow.vibe"), one.platform)
  assert.ok(one.module.startsWith("// @effect-diagnostics nodeBuiltinImport:off"), one.module)
  const two = splitPlatform(linux, "apps/desktop/src/snapShot/LinuxSnapShot.ts", ts)
  assert.equal(two.platform.split("\n\n")[0], linux.split("\n\n")[0])
})

test("t3code Desktop: the split compiles natively under the target's nodeBuiltinImport error setting", { skip: !compiler && "set VIBELANG_BINARY" }, () => {
  const root = mkdtempSync(join(tmpdir(), "platform-directives-"))
  try {
    const { module, platform } = splitPlatform(activeWindow, "ActiveWindow.ts", ts)
    writeFileSync(join(root, "ActiveWindow.vibe"), module)
    writeFileSync(join(root, "ActiveWindow.platform.ts"), platform)
    writeFileSync(join(root, "node.d.ts"), 'declare module "node:child_process" { export function execFileSync(file: string, args: string[]): string }\n')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler", noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true,
      plugins: [{ name: "@effect/language-service", diagnosticSeverity: { nodeBuiltinImport: "error" } }] }, files: ["node.d.ts", "ActiveWindow.vibe", "ActiveWindow.platform.ts"] }))
    const result = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    // The setting is live: the same sibling without the directive reports EK3877, as on main.
    writeFileSync(join(root, "ActiveWindow.platform.ts"), platform.replace(/^\/\/ @effect-diagnostics[^\n]*\n\n/, ""))
    const bare = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.match(bare.stdout, /EK3877: nodeBuiltinImport/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const directive = fc.constantFrom(
  "// @effect-diagnostics nodeBuiltinImport:off -- boundary",
  "// @effect-diagnostics globalTimers:off",
  "/* @effect-diagnostics nodeBuiltinImport:off */",
  "// @ts-nocheck",
  "/* eslint-disable no-console */",
  "// oxlint-disable no-restricted-imports",
  "// biome-ignore-all lint/style: boundary",
  '/// <reference types="node" />',
)
const ordinary = fc.constantFrom(
  "// Copyright the authors.",
  "/** Reads the host. */",
  "// @effect-diagnostics-next-line nodeBuiltinImport:off",
  "// eslint-disable-next-line no-console",
  "// oxlint-disable-line no-console",
)
const header = fc.array(fc.oneof(directive.map((text) => ({ text, directive: true })), ordinary.map((text) => ({ text, directive: false }))), { minLength: 1, maxLength: 4 })
const body = 'import { readFileSync } from "node:fs";\n\nexport function read(path: string): string {\n  return readFileSync(path);\n}\n'

test("the sibling starts with every file-wide directive of the header, once and in order, and the module is unchanged", () => {
  let directives = 0
  fc.assert(fc.property(header, fc.boolean(), (lines, attached) => {
    const text = lines.map((l) => l.text).join("\n") + (attached ? "\n" : "\n\n") + body
    const split = splitPlatform(text, "src/Read.ts", ts)
    const expected = lines.filter((l) => l.directive).map((l) => l.text)
    directives += expected.length
    const top = split.platform.slice(0, split.platform.indexOf("// The platform code of Read.vibe"))
    const copied = top.split("\n").filter(Boolean)
    // Each directive once per occurrence: a comment attached to a moved import already travels with it.
    const count = (hay, needle) => hay.split(needle).length - 1
    for (const d of new Set(expected)) assert.equal(count(split.platform, d), expected.filter((e) => e === d).length, split.platform)
    if (!attached) assert.deepEqual(copied, expected)
    for (const l of lines.filter((l) => !l.directive)) assert.ok(!top.includes(l.text), top)
    // The .vibe module keeps the whole header, as before.
    if (!attached) assert.ok(split.module.startsWith(lines.map((l) => l.text).join("\n") + "\n\n"), split.module)
    assert.equal(ts.transpileModule(split.platform, { reportDiagnostics: true }).diagnostics.length, 0)
  }), { seed: 2026110207, numRuns: 300 })
  assert.ok(directives > 100)
})
