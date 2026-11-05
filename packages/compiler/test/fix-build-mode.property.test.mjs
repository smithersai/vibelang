import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const quote = "In `-b`, each project fixes its own files in build order."

test("build repair help agrees with the accepted project ownership rule", () => {
  const spec = readFileSync(join(repo, "docs/design/vips/0034-compiler-and-tooling.md"), "utf8")
  assert.ok(spec.includes(quote), quote)
  const help = spawnSync(native, ["--help", "--all"], { encoding: "utf8", timeout: 20000 })
  assert.equal(help.status, 0, help.stdout + help.stderr)
  assert.match(help.stdout, /to each project in --build order; incompatible with --watch/)
  assert.doesNotMatch(help.stdout, /incompatible with --build/)
})

test("build aliases repair once and preserve source line endings", async () => {
  await checkProperty(fc, {
    name: "build-repair-argument-order",
    rule: "docs/design/vips/0034-compiler-and-tooling.md: " + quote,
    command: "node --test packages/compiler/test/fix-build-mode.property.test.mjs",
    regressions: new URL("./property-regressions/", import.meta.url),
    numRuns: 12,
    arbitrary: fc.record({
      flag: fc.constantFrom("-b", "--b", "-build", "--build", "--BUILD"),
      fixFirst: fc.boolean(),
      crlf: fc.boolean()
    }),
    check(input) {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-build-repair-")))
      try {
        mkdirSync(join(root, "node_modules"))
        symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
        symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
        writeFileSync(join(root, "package.json"), '{"type":"module"}')
        writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
          compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, noEmit: true, types: [], skipLibCheck: true },
          include: ["*.vibe"]
        }))
        const ending = input.crlf ? "\r\n" : "\n"
        const source = ["// Preserve this authored contract.", "export type Held = Effect.Effect<number>", ""].join(ending)
        writeFileSync(join(root, "main.vibe"), source)
        const args = input.fixFirst ? ["--fix", input.flag] : [input.flag, "--fix"]
        const run = () => spawnSync(native, [...args, "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 60000 })
        const first = run()
        assert.equal(first.status, 0, JSON.stringify(input) + "\n" + first.stdout + first.stderr)
        const fixed = readFileSync(join(root, "main.vibe"), "utf8")
        assert.equal(fixed, ["// Preserve this authored contract.", "export type Held = number!!", ""].join(ending))
        const second = run()
        assert.equal(second.status, 0, second.stdout + second.stderr)
        assert.match(second.stdout, /0 fixes in 0 files/)
        assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), fixed)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
})
