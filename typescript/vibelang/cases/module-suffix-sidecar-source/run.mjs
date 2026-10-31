import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const dir = fileURLToPath(new URL(".", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
// Put stale declarations under out/, so an always-emitting compiler cannot
// rewrite tracked case inputs. Each invocation recreates the stale witness.
for (const native of [false, true]) {
  for (const specifier of ["./runtime", "./runtime.js"]) {
    const fixture = join(dir, "out", (native ? "native-" : "") + (specifier.endsWith(".js") ? "js" : "extensionless"))
    mkdirSync(fixture, { recursive: true })
    const suffix = native ? ".native" : ""
    writeFileSync(join(fixture, "runtime" + suffix + ".vibe"), 'export const value: string = "fresh"\n')
    writeFileSync(join(fixture, "runtime" + suffix + ".d.vibe.ts"), "export declare const value: 0\n")
    writeFileSync(join(fixture, "main.ts"), "import { value } from " + JSON.stringify(specifier) + "\nexport const checked: string = value\n")
    writeFileSync(join(fixture, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
        strict: true, skipLibCheck: true, types: [], noEmit: true,
        moduleSuffixes: native ? [".native", "", ".native.d.vibe", ".d.vibe"] : ["", ".d.vibe"]
      },
      vibe: { effectGlobals: false, effectModules: false }, include: ["*.ts", "*.vibe"]
    }))
    const result = spawnSync(compiler, ["-p", fixture, "--traceResolution", "--pretty", "false"], {
      encoding: "utf8", timeout: 20000
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.ok(result.stdout.includes("successfully resolved to '" + join(fixture, "runtime" + suffix + ".vibe").replaceAll("\\", "/") + "'"), result.stdout)
  }
}
console.log("source priority preserved")
