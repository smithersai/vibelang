import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { posix } from "node:path"
import { test } from "node:test"
import { checkConvertedPaths, packageContext } from "../lib/converted-paths.mjs"
import { rewriteSourceLiterals } from "../lib/source-paths.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")

const modules = ["packages/a/src/Local.ts", "packages/a/src/deep/Worker.ts", "packages/a/src/View.ts", "packages/b/src/Remote.ts", "scripts/tool.ts"]
const callers = ["packages/a/src/caller.ts", "packages/a/src/deep/caller.ts", "packages/b/src/caller.ts", "scripts/caller.ts", "packages/a/caller.mjs"]
const manifests = { "package.json": '{"name":"root"}', "packages/a/package.json": '{"name":"@acme/a"}', "packages/b/package.json": '{"name":"@acme/b"}' }
const relativeTo = (file, module) => {
  const path = posix.relative(posix.dirname(file), module)
  return path.startsWith(".") ? path : "./" + path
}
const stem = path => path.replace(/\.ts$/, "")

// Every shape can spell a path to the module. A static one is the codemod's to rewrite.
const shapes = {
  literal: path => 'const p = "' + path + '"',
  url: path => 'const p = new URL("' + path + '", import.meta.url)',
  resolve: path => 'const p = import.meta.resolve("' + path + '")',
  entry: path => 'export const c = { main: "' + path + '" }',
  dynamic: path => 'const p = () => import("' + path + '")',
  worker: path => 'const p = new Worker(new URL("' + path + '", import.meta.url))',
  template: path => "const p = import.meta.resolve(`" + stem(path) + "${moduleExtension(import.meta.url)}`)",
  unbound: path => "const p = new URL(`" + stem(path) + "${ext}`, import.meta.url)",
  concat: path => 'const p = new URL("' + stem(path) + '" + (dev ? ".ts" : ".js"), import.meta.url)',
  spawn: path => 'spawn("bun", ["' + path + '"])',
  command: path => 'execSync("bun ' + path + '")',
  helper: path => "const p = (n) => import.meta.resolve(`${n}${ext}`)\np('" + stem(path) + "')"
}

test("property: a reference to a converted module is rewritten or refused; a reference to anything else is untouched", () => {
  fc.assert(fc.property(
    fc.constantFrom(...callers), fc.constantFrom(...modules), fc.subarray(modules), fc.constantFrom(...Object.keys(shapes)),
    fc.constantFrom('"', "'", "`"),
    (caller, module, chosen, shape, quote) => {
      const converted = new Set(chosen)
      const literalQuote = text => quote === '"' ? text : text.replaceAll('"' + relativeTo(caller, module) + '"', quote + relativeTo(caller, module) + quote)
      const source = literalQuote(shapes[shape](relativeTo(caller, module))) + "\n"
      const tracked = [...Object.keys(manifests), caller, ...modules.map(m => converted.has(m) ? m.replace(/\.ts$/, ".vibe") : m)]
      const renames = chosen.map(from => ({ from, to: from.replace(/\.ts$/, ".vibe") }))
      const inventory = [...tracked, ...chosen]
      const packages = packageContext(inventory, file => manifests[file] ?? "{}")
      const result = rewriteSourceLiterals(ts, source, caller, renames, { inventory, packages, selectors: false })
      const files = new Map([[caller, result.text]])
      const read = file => files.get(file) ?? manifests[file] ?? "export {}\n"
      const { refusals } = checkConvertedPaths({ ts, tracked, read })
      const refused = refusals.some(r => r.module === module && r.file === caller)
      if (converted.has(module)) {
        const moved = result.edits.some(e => e.module === module.replace(/\.ts$/, ".vibe"))
        assert.ok(moved !== refused, shape + ": exactly one of rewritten and refused: " + result.text + JSON.stringify(refusals))
        if (moved) assert.ok(result.text.includes(stem(relativeTo(caller, module)) + ".vibe"), result.text)
      } else {
        assert.equal(result.text, source, shape + ": an unconverted module's reference keeps its bytes")
        assert.deepEqual(refusals, [], shape)
      }
    }), { seed: 560057, numRuns: 400 })
})

const controls = {
  comment: path => "// " + path,
  docComment: path => "/** {@link import(\"" + path + "\")} */\nexport {}",
  remote: path => 'const a = "https://example.com/' + path + '"',
  remoteUrl: path => 'const a = new URL("' + path + '", "https://cdn.example.com/")',
  prose: path => 'const a = "See ' + path + ' for details"',
  message: path => "const a = `Cannot load ${name} from " + path + "`",
  output: path => 'const a = new URL("../dist/' + posix.basename(path) + '", import.meta.url)',
  type: path => 'type A = "' + path + '"',
  assertion: path => 'assert.equal(a, "' + path + '")',
  testName: path => 'test("' + path + '", () => {})',
  otherExtension: path => 'const a = new URL("' + stem(path) + '.tsx", import.meta.url)',
  declaration: path => 'const a = new URL("' + stem(path) + '.d.ts", import.meta.url)'
}

test("property: comments, URLs, prose, outputs and expectations keep their bytes and never fail a batch", () => {
  fc.assert(fc.property(
    fc.constantFrom(...callers), fc.constantFrom(...modules), fc.constantFrom(...Object.keys(controls)),
    (caller, module, control) => {
      const source = controls[control](relativeTo(caller, module)) + "\n"
      const to = module.replace(/\.ts$/, ".vibe")
      const tracked = [...Object.keys(manifests), caller, to]
      const inventory = [...tracked, module]
      const packages = packageContext(inventory, file => manifests[file] ?? "{}")
      const result = rewriteSourceLiterals(ts, source, caller, [{ from: module, to }], { inventory, packages, selectors: false })
      assert.equal(result.text, source, control)
      const read = file => file === caller ? source : manifests[file] ?? "export {}\n"
      assert.deepEqual(checkConvertedPaths({ ts, tracked, read }).refusals, [], control)
    }), { seed: 560058, numRuns: 400 })
})

test("property: a generated glob selector fails only when it picked the .ts spelling and not the .vibe one", () => {
  fc.assert(fc.property(
    fc.constantFrom("src/**/*", "src/*", "**/*"), fc.constantFrom(".ts", ".{ts,tsx}", ".{js,ts}", ".js", ".tsx"), fc.boolean(),
    (head, tail, widened) => {
      const glob = head + tail, list = widened ? [glob, head + ".vibe"] : [glob]
      const file = "packages/a/vite.config.ts", source = "export default { include: " + JSON.stringify(list) + " }\n"
      const tracked = [...Object.keys(manifests), file, "packages/a/src/Local.vibe"]
      const read = path => path === file ? source : manifests[path] ?? "export {}\n"
      const { refusals } = checkConvertedPaths({ ts, tracked, read })
      const picksTs = /\bts\b/.test(tail)
      assert.equal(refusals.length, picksTs && !widened ? 1 : 0, source + JSON.stringify(refusals))
    }), { seed: 560059, numRuns: 200 })
})
