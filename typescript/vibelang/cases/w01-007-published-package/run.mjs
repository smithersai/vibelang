// run-seconds: 300
// rule-evidence: docs/design/src/007-tooling.md#declaration-import-spelling | A published package carries JavaScript and ordinary `.d.ts` files.
// rule-evidence: docs/design/src/007-tooling.md#declaration-import-spelling | Compatibility `*.d.vibe.ts` and `*.d.vibex.ts` sidecars serve source tools and do not ship; published type exports point at the build’s ordinary declarations.
//
// A VibeLang library with a .vibe and a .vibex module builds into build/,
// and npm packs what it publishes. The packed files are JavaScript and
// ordinary .d.ts declarations; the compatibility sidecars stay beside their
// sources for source tools. A stock TypeScript consumer of the unpacked
// package resolves the types export to build/index.d.ts and type-checks.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project, check, nativeCheck, run } from "../../tests/coverage-tooling.mjs"

const library = project(import.meta.url, "library", {
  "src/index.vibe": "export { greet } from \"./greet.vibe\"\nexport { Badge } from \"./Badge.vibex\"\n",
  "src/greet.vibe": "export function greet(name: string): string { return `hi ${name}` }\n",
  "src/Badge.vibex": "export const Badge = 1\n",
}, { compilerOptions: { noEmit: false, declaration: true, rewriteRelativeImportExtensions: true, rootDir: "src", jsx: "preserve" } })
const manifest = {
  name: "w01-library", version: "1.0.0", type: "module", files: ["build"],
  exports: { ".": { types: "./build/index.d.ts", default: "./build/index.js" } },
}
library.write("package.json", JSON.stringify(manifest))
const built = check(library)
assert.equal(built.status, 0, built.output)

const sidecars = ["src/index.d.vibe.ts", "src/greet.d.vibe.ts", "src/Badge.d.vibex.ts"]
for (const sidecar of sidecars) assert.ok(fs.existsSync(path.join(library.dir, sidecar)), sidecar + " was not written")

const packed = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], library.dir, { env: { ...process.env, npm_config_cache: path.join(library.dir, ".npm-cache") } })
assert.equal(packed.status, 0, packed.output)
const shipped = JSON.parse(packed.stdout)[0].files.map(f => f.path).sort()
console.log("packed", JSON.stringify(shipped))
assert.ok(shipped.every(f => f === "package.json" || /^build\/[^/]+\.(?:js|jsx|d\.ts)$/.test(f)), "unexpected packed file")
assert.ok(!shipped.some(f => /\.d\.vibex?\.ts$/.test(f)), "a sidecar ships")

// The consumer sees only the published files.
const consumer = project(import.meta.url, "consumer", {
  "use.ts": "import { greet, Badge } from \"w01-library\"\nexport const text: string = greet(\"a\")\nexport const badge = Badge\n",
}, { compilerOptions: { traceResolution: true } })
fs.unlinkSync(path.join(consumer.dir, "node_modules"))
const installed = path.join(consumer.dir, "node_modules", "w01-library")
for (const file of shipped) {
  fs.mkdirSync(path.dirname(path.join(installed, file)), { recursive: true })
  fs.copyFileSync(path.join(library.dir, file), path.join(installed, file))
}
const used = nativeCheck(consumer)
assert.equal(used.status, 0, used.output)
const resolved = used.output.match(/Module name 'w01-library' was successfully resolved to '([^']+)'/)
assert.ok(resolved, used.output)
console.log("types", path.relative(installed, resolved[1]))
