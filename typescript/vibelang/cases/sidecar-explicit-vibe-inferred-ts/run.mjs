import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const stock = resolve(process.env.EFFECT_NODE_MODULES ?? fileURLToPath(new URL("../../../../experiments/node_modules", import.meta.url)), "typescript/bin/tsc")
const actual = (await import("./out/main.js")).value.tag
const temp = mkdtempSync(join(tmpdir(), "sidecar-consumer-"))
try {
  const failures = []
  for (const entry of ["main.vibe", "out/main.js"]) {
    const specifier = resolve(here, entry)
    writeFileSync(join(temp, "consumer.ts"), `import { value } from ${JSON.stringify(specifier)}
const correct: ${JSON.stringify(actual)} = value.tag
// @ts-expect-error The API must reject an unrelated sibling's literal, including any.
const wrong: "unrelated" = value.tag
`)
    try {
      execFileSync(process.execPath, [stock, "--noEmit", "--strict", "--skipLibCheck", "false", "--allowArbitraryExtensions", "--allowImportingTsExtensions", "--module", "esnext", "--moduleResolution", "bundler", "--target", "es2022", join(temp, "consumer.ts")], { encoding: "utf8", stdio: "pipe" })
    } catch (error) {
      failures.push(`${entry}: ${error.stdout}
${error.stderr}`)
    }
  }
  assert.equal(failures.length, 0, failures.join("\n"))
} finally {
  rmSync(temp, { recursive: true, force: true })
}
assert.equal(actual, "vibe")
console.log(actual)
