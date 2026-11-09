import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const binary = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-agent-foreign-typeof-alias.json", import.meta.url), "utf8"))

function witness({ form, parameter, exported, module }) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-callable-alias-"))
  try {
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "foreign.ts"), "export const describe = (value: " + parameter + ") => String(value);\n")
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        strict: true, skipLibCheck: true, target: "ESNext", module,
        moduleResolution: module === "NodeNext" ? "NodeNext" : "Bundler",
        allowImportingTsExtensions: true, noEmit: true, types: []
      },
      files: ["main.vibe", "foreign.ts"]
    }))
    const prefix = 'import { describe as foreign } from "./foreign.ts"\n'
    const declaration = exported ? "export const " : "const "
    const source = form === "type-alias" ?
      "type Callable = typeof foreign;\n" + declaration + "describe: Callable = foreign" :
      form === "second-alias" ?
        "const first: typeof foreign = foreign;\n" + declaration + "describe: typeof first = first" :
        declaration + "describe: typeof foreign = foreign"
    const run = (body) => {
      writeFileSync(join(root, "main.vibe"), prefix + body + "\n")
      return spawnSync(binary, ["-p", "tsconfig.json", "--singleThreaded", "--pretty", "false"], {
        cwd: root, encoding: "utf8", timeout: 15000
      })
    }
    const own = run(source)
    assert.equal(own.status, 0, own.stdout + own.stderr)
    const handwritten = run(declaration + "describe: (value: " + parameter + ") => string = foreign")
    assert.equal(handwritten.status, 2, handwritten.stdout + handwritten.stderr)
    assert.equal((handwritten.stdout.match(/error EK0402:/g) ?? []).length, 1, handwritten.stdout + handwritten.stderr)
    assert.doesNotMatch(handwritten.stdout, /error (?:TS|EK(?!0402))/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("a renamed foreign callable retains its own typeof contract at an alias", () => witness(corpus))
test("foreign typeof aliases preserve their contract across alias chains and module modes", () => {
  fc.assert(fc.property(fc.record({
    form: fc.constantFrom("direct", "type-alias", "second-alias"),
    parameter: fc.constantFrom("unknown", "string", "number"),
    exported: fc.boolean(),
    module: fc.constantFrom("NodeNext", "Preserve")
  }), witness), { seed: 20261109, numRuns: 30 })
})
