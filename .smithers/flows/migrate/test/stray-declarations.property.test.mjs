// opencode-22: a declaration emit writes x.d.ts beside a source outside the
// project's rootDir. emitDeclarations removes what it created there and puts
// back what existed, so setup and verify never change a tracked file.
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { emitDeclarations, listDeclarations } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const quote = "removes only the files it created and puts back the ones that existed."
const notes = new URL("../../../../docs/user/src/setup/release-notes.md", import.meta.url)

// A stand-in compiler: writes a.d.ts into --outDir and each listed stray file, and lists them all.
function fakeCompiler(root, strays, text) {
  const compiler = join(root, ".bin/vibelang")
  mkdirSync(dirname(compiler), { recursive: true })
  const writes = strays.map((file) => `mkdir -p '${dirname(join(root, file))}' && printf '%s' '${text}' > '${join(root, file)}' && echo "TSFILE: ${join(root, file)}"`)
  writeFileSync(compiler, `#!/bin/sh
while [ $# -gt 0 ]; do [ "$1" = "--outDir" ] && out="$2"; shift; done
echo "export {};" > "$out/a.d.ts"
echo "TSFILE: $out/a.d.ts"
${writes.join("\n")}
echo "error TS6059: File is not under rootDir."
exit 2
`)
  chmodSync(compiler, 0o755)
  return compiler
}

// Every file under root but .bin and out, with its contents.
function tree(root) {
  const files = {}
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) { if (![".bin", "out"].includes(relative(root, child))) walk(child) }
      else files[relative(root, child)] = readFileSync(child, "utf8")
    }
  }
  walk(root)
  return files
}

function write(root, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}

test("opencode-22: the emit keeps the tracked declarations it rewrote and removes the ones it created", async () => {
  assert.ok(readFileSync(notes, "utf8").includes(quote), "update the quoted release note")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-tracked-stray-declarations.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "migrate-stray-dts-"))
  try {
    write(root, { "packages/app/tsconfig.json": "{}\n", ...corpus.tracked })
    const before = tree(root)
    const compiler = fakeCompiler(root, [...Object.keys(corpus.tracked), ...corpus.created], corpus.emitted)
    const emitted = await emitDeclarations({ compiler, tsconfig: "tsconfig.json", cwd: join(root, "packages/app"), outDir: join(root, "out"), root })
    assert.deepEqual([emitted.code, emitted.files], [2, 1])
    assert.deepEqual(tree(root), before)
    assert.deepEqual(listDeclarations(join(root, "out")), ["a.d.ts"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const directory = fc.constantFrom("packages/stories/playwright", "packages/tui/src", "src", "lib/deep/er", "packages/ai/src/protocols")
const name = fc.constantFrom("config", "story", "theme", "index", "fal-queue")
const extension = fc.constantFrom(".d.ts", ".d.mts", ".d.cts", ".d.vibe.ts")
const file = fc.tuple(directory, name, extension).map(([d, n, e]) => `${d}/${n}${e}`)

test("stray-declarations: an emit leaves the repository's files as they were", async () => {
  await fc.assert(fc.asyncProperty(
    fc.uniqueArray(file, { maxLength: 6 }), fc.uniqueArray(file, { maxLength: 6 }), fc.boolean(),
    async (tracked, strays, fromPackage) => {
      const root = mkdtempSync(join(tmpdir(), "migrate-stray-dts-"))
      try {
        write(root, { "packages/app/tsconfig.json": "{}\n", "src/keep.ts": "export const keep = 1\n",
          ...Object.fromEntries(tracked.map((f, i) => [f, `// tracked ${i}\nexport declare const v${i}: number;\n`])) })
        const before = tree(root)
        const compiler = fakeCompiler(root, strays, "export {};")
        const cwd = fromPackage ? join(root, "packages/app") : root
        await emitDeclarations({ compiler, tsconfig: "tsconfig.json", cwd, outDir: join(root, "out"), root })
        assert.deepEqual(tree(root), before)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }), { seed: 22022, numRuns: 60 })
})
