import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const generator = fileURLToPath(new URL("./bench/gen-synthetic.mjs", import.meta.url))
const imports = text => [...text.matchAll(/^import \{ ([^}]+) \} from "\.\/(m\d+\.[^"]+)"$/gm)]
  .map(match => ({ names: match[1].split(", "), file: match[2] }))

for (const shape of ["chain", "dense", "single"]) {
  for (const count of [1, 6]) {
    test("synthetic imports match in both languages: " + shape + ", " + count + " modules", t => {
      const root = mkdtempSync(join(tmpdir(), "vibelang synthetic imports-"))
      t.after(() => rmSync(root, { recursive: true, force: true }))
      const result = spawnSync(process.execPath, [generator, root, String(count), shape], { encoding: "utf8" })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      for (const [language, extension] of [["vibelang", ".vibe"], ["effect-ts", ".ts"]]) {
        const src = join(root, language, "src")
        if (shape === "single") {
          assert.deepEqual(readdirSync(src), ["all" + extension])
          assert.deepEqual(imports(readFileSync(join(src, "all" + extension), "utf8")), [])
          continue
        }
        assert.deepEqual(readdirSync(src).sort(), [
          ...Array.from({ length: count }, (_, i) => "m" + i + extension), "main" + extension
        ].sort())
        for (let i = 0; i < count; i++) {
          const expected = []
          if (i > 0) expected.push({
            names: ["run" + (i - 1), "plain" + (i - 1), ...(shape === "dense" ? ["deep" + (i - 1)] : [])],
            file: "m" + (i - 1) + extension
          })
          if (shape === "dense") {
            for (let j = i - 1; j >= Math.max(0, i - 4); j--) expected.push({ names: ["load" + j], file: "m" + j + extension })
          }
          const text = readFileSync(join(src, "m" + i + extension), "utf8")
          assert.deepEqual(imports(text), expected, language + " m" + i)
        }
        assert.deepEqual(imports(readFileSync(join(src, "main" + extension), "utf8")), [
          { names: ["run" + (count - 1)], file: "m" + (count - 1) + extension }
        ])
      }
    })
  }
}
