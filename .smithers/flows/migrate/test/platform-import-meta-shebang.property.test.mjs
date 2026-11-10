import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { prepareState, applyState } from "../lib/codemod-state.mjs"
import { splitPlatform } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-import-meta-shebang.json", import.meta.url), "utf8"))

function validTypeScript(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  assert.deepEqual(source.parseDiagnostics.map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") })), [], text)
}

function checkSplit(source, file = corpus.file) {
  const result = splitPlatform(source, file, ts)
  assert.ok(result && !result.refused, JSON.stringify(result))
  const shebang = source.match(/^#![^\r\n]*/)[0]
  assert.ok(result.module.startsWith(shebang + "\n") || result.module.startsWith(shebang + "\r\n"), result.module)
  assert.equal(result.module.split(shebang).length - 1, 1, result.module)
  assert.doesNotMatch(result.platform, /^#!/m)
  validTypeScript(file, result.module)
  validTypeScript(file.replace(/\.(?:m?ts|tsx)$/, ".platform.ts"), result.platform)
  return result
}

test("t3code import-meta companion keeps the executable shebang in its entry only", () => {
  checkSplit(corpus.source)
})

test("prepareState and applyState keep a private script shebang out of its companion", () => {
  const root = mkdtempSync(join(tmpdir(), "platform-shebang-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", private: true }))
    writeFileSync(join(root, "run.ts"), corpus.source)
    const state = prepareState(root, ["run.ts"], ["run.ts"], { ts, moduleBodies: true })
    assert.equal(state.platform.splits.length, 1, JSON.stringify(state.platform))
    assert.deepEqual(state.platform.refused, [])
    applyState(root, state)
    const entry = readFileSync(join(root, "run.vibe"), "utf8")
    const companion = readFileSync(join(root, "run.platform.ts"), "utf8")
    assert.ok(entry.startsWith("#!/usr/bin/env node\n"), entry)
    assert.doesNotMatch(companion, /^#!/m)
    validTypeScript("run.platform.ts", companion)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("script headers and metadata members never make a companion executable", () => {
  fc.assert(fc.property(
    fc.constantFrom("#!/usr/bin/env node", "#!/usr/bin/env -S node --enable-source-maps", "#!/bin/node"),
    fc.constantFrom("\n", "\r\n"),
    fc.constantFrom("", "// License\n", "/** Script documentation. */\n", "/** Script documentation. */\n\n"),
    fc.constantFrom("import.meta.dirname", "import.meta.filename", 'import.meta.resolve("./input")'),
    fc.boolean(),
    (shebang, newline, header, metadata, blank) => {
      const source = (shebang + "\n" + (blank ? "\n" : "") + header +
        'import * as FS from "node:fs";\n' +
        (metadata === "import.meta.filename"
          ? 'const read = () => ' + metadata + ';\n'
          : 'const read = () => FS.readFileSync(' + metadata + ', "utf8");\n') +
        'export const program = () => read();\n').replaceAll("\n", newline)
      checkSplit(source, "run.ts")
    }), { seed: 4402196, numRuns: 100 })
})

test("a shebang without metadata also stays before generated imports", () => {
  checkSplit('#!/usr/bin/env node\nimport * as FS from "node:fs";\nconst read = () => FS.readFileSync("input", "utf8");\nexport const program = () => read();\n', "run.ts")
})
