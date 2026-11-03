import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const modules = resolve(process.env.EFFECT_NODE_MODULES ?? fileURLToPath(new URL("../../../../experiments/node_modules", import.meta.url)))
const stock = join(modules, "typescript/bin/tsc")
const temp = mkdtempSync(join(tmpdir(), "module-block-reexport-any-"))
const consumer = specifier => `import { eol } from "${specifier}";
const good: string = eol("q");
const bad: number = eol("q");
eol(1);
`
function codes() {
  const result = spawnSync(process.execPath, [stock, "-p", "consumer.json", "--pretty", "false"], {
    cwd: temp, encoding: "utf8", timeout: 60000
  })
  assert.ifError(result.error)
  assert.ok(result.status === 0 || result.status === 2, result.stdout + result.stderr)
  return [...result.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1]).sort()
}
try {
  writeFileSync(join(temp, "package.json"), '{"type":"module"}')
  writeFileSync(join(temp, "consumer.json"), JSON.stringify({
    compilerOptions: {
      strict: true, noEmit: true, skipLibCheck: true, types: [],
      allowArbitraryExtensions: true, module: "esnext", moduleResolution: "bundler", target: "es2022"
    }, files: ["consumer.ts"]
  }))
  // TypeScript twin: VIP-40 copies the module body to a sibling .ts module.
  writeFileSync(join(temp, "platform.ts"), 'export const eol = (text: string): string => text + "\\n";\n')
  writeFileSync(join(temp, "twin.ts"), 'export { eol } from "./platform.js";\n')
  writeFileSync(join(temp, "consumer.ts"), consumer("./twin.js"))
  const expected = codes()
  assert.deepEqual(expected, ["TS2322", "TS2345"], "stock TypeScript twin rejects the result and argument")

  for (const entry of ["main.vibe", "out/main.js"]) {
    writeFileSync(join(temp, "consumer.ts"), consumer(resolve(here, entry)))
    assert.deepEqual(codes(), expected, entry + " must preserve the TypeScript contract")
  }

  // Minimized opencode m14 pattern. With the body declaration missing,
  // skipLibCheck conceals its unresolved re-export and the API becomes any.
  writeFileSync(join(temp, "main.d.vibe.ts"), readFileSync(join(here, "main.d.vibe.ts")))
  writeFileSync(join(temp, "main.vibe.platform.d.ts"), readFileSync(join(here, "main.vibe.platform.d.ts")))
  writeFileSync(join(temp, "consumer.ts"), consumer("./main.vibe"))
  assert.deepEqual(codes(), expected)
  rmSync(join(temp, "main.vibe.platform.d.ts"))
  assert.deepEqual(codes(), [], "missing-declaration control must expose the original any leak")
} finally {
  rmSync(temp, { recursive: true, force: true })
}
console.log("module re-export types preserved")
