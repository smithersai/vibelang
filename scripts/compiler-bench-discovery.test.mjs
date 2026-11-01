import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const source = process.env.VIBELANG_COMPILER_BENCH_ROOT ?? fileURLToPath(new URL("../", import.meta.url))

function fixture(t, status, marker) {
  const root = mkdtempSync(join(tmpdir(), "vibelang corpus discovery-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, text, executable = false) => {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
    if (executable) chmodSync(target, 0o755)
  }
  for (const name of ["compiler.sh", "measure.py", "modules.sh", "gen-synthetic.mjs"]) {
    const target = join(root, "scripts/bench", name)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(source, "scripts/bench", name), target)
  }
  put("packages/runtime/dist/index.js", "")
  put("packages/runtime/node_modules/effect/package.json", '{"name":"effect"}')
  put("packages/compiler/native/vibelang", '#!/bin/sh\nif [ "$1" = --version ]; then echo fixture; else echo "Files: 1"; fi\n', true)
  put("corpus/page/tsconfig.json", '{"files":["main.vibe"]}')
  put("corpus/page/main.vibe", "export const value = 1")
  put("bin/bun", `#!/bin/sh
echo "corpus stdout witness"
echo "corpus stderr witness" >&2
if [ "$CORPUS_MARKER" = 1 ]; then echo "Temporary projects: $CORPUS_DIRECTORY"; fi
exit "$CORPUS_STATUS"
`, true)
  const output = join(root, "output")
  const result = spawnSync("sh", [
    join(root, "scripts/bench/compiler.sh"), "--modules", "2", "--runs", "1", "--scale", "", "--out", output
  ], {
    encoding: "utf8", timeout: 60000,
    env: { ...process.env, VIBELANG: join(root, "packages/compiler/native/vibelang"),
      PATH: join(root, "bin") + delimiter + process.env.PATH,
      CORPUS_STATUS: String(status), CORPUS_MARKER: marker ? "1" : "0", CORPUS_DIRECTORY: join(root, "corpus") }
  })
  assert.ifError(result.error)
  return { root, outputDir: output, ...result }
}

const statuses = new Set([1, 2, 7, 126, 127, 128, 129, 137, 143, 255])
let seed = 6301
for (let i = 0; i < 8; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  statuses.add(1 + (seed % 255))
}
for (const status of statuses) {
  for (const marker of [false, true]) {
    test(`compiler benchmark stops after docs generation exits ${status}, marker=${marker}`, t => {
      const result = fixture(t, status, marker)
      assert.equal(result.status, status, result.stdout + result.stderr)
      assert.match(result.stderr, /corpus stdout witness/)
      assert.match(result.stderr, /corpus stderr witness/)
      assert.match(result.stderr, /compiler.sh: docs corpus generation failed/)
      assert.doesNotMatch(result.stdout, /working directory:|docs corpus as one program/)
      assert.match(readFileSync(join(result.outputDir, "docs-corpus.log"), "utf8"), /corpus stdout witness/)
      assert.match(readFileSync(join(result.outputDir, "docs-corpus.stderr.log"), "utf8"), /corpus stderr witness/)
      assert.equal(readFileSync(join(result.root, "corpus/page/main.vibe"), "utf8"), "export const value = 1")
    })
  }
}

for (const marker of [false, true]) {
  test("successful docs discovery preserves benchmark rendering, marker=" + marker, t => {
    const result = fixture(t, 0, marker)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /working directory:/)
    assert.equal(result.stdout.includes("docs corpus as one program"), marker)
    assert.match(result.stderr, /corpus stderr witness/)
  })
}
