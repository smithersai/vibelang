import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find(p => !existsSync(p))
const skip = missing && `build compiler/runtime first; missing ${missing}`

for (const [schema, empty, namespace, single] of [[false, false], [true, false], [false, true], [false, false, true], [false, false, false, true]]) {
  for (const scope of [[], ["--fix-migration-only"], ["--fix-vip-only"]]) {
    test(`inherited ${schema ? "schema error" : "error"} ${empty ? "from a fieldless base " : namespace ? "from namespace Schema " : single ? "with single quotes " : ""}preserves runtime and declarations with --fix ${scope.join(" ")}`, { skip }, t => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-inheritance-")))
      t.after(() => rmSync(dir, { recursive: true, force: true }))
      mkdirSync(join(dir, "node_modules"))
      symlinkSync(realpathSync(effect), join(dir, "node_modules/effect"))
      // Test the published package layout: Effect is a peer, with one copy
      // in the project. Linking the development install would add a second
      // nested Effect and cause unrelated declaration portability errors.
      const published = join(dir, "node_modules/vibelang-runtime")
      mkdirSync(published)
      cpSync(join(runtime, "package.json"), join(published, "package.json"))
      cpSync(join(runtime, "dist"), join(published, "dist"), { recursive:true })
      writeFileSync(join(dir, "package.json"), '{"type":"module"}')
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target:"es2022", module:"nodenext", strict:true, skipLibCheck:true, types:[], declaration:true, outDir:"out", noEmitOnError:false },
        files:["main.vibe"]
      }))
      const source = `import { ${namespace ? "Data" : "Data, Schema"} } from ${single ? "'effect'" : '"effect"'}
${namespace ? 'namespace Schema { export class Base extends Data.TaggedError("Base" as string)<{ readonly id: string }> {} }' : empty ? 'abstract error Base' : schema
 ? 'class Base extends Schema.TaggedError<Base>()("Base" as string, { id: Schema.String }) {}'
 : 'class Base extends Data.TaggedError("Base" as string)<{ readonly id: string }> {}'}
/** Child documentation. */
export ${schema ? "schema error" : "error"} Child extends ${namespace ? "Schema.Base" : "Base"} {
  ${empty ? "id: string" : ""}
  value?: number
  get label(): string { return this.id + ":" + this._tag }
}
export function observe() {
  const input = { id:"x", value:7${schema ? "" : ', _tag:"spoof", extra:9'} }
  const child = new Child(input)
  return { tag:child._tag, id:child.id, value:child.value, label:child.label, base:child instanceof ${namespace ? "Schema.Base" : "Base"}, extra:Object.hasOwn(child,"extra")${schema ? ', encoded:Schema.encodeSync(Child)(child)' : ''} }
}
`
      writeFileSync(join(dir, "main.vibe"), source)
      const compile = (...args) => spawnSync(native, ["--pretty","false",...args], { cwd:dir, encoding:"utf8", timeout:120000 })
      const before = compile()
      assert.equal(before.status, 2, before.stdout + before.stderr)
      assert.match(before.stdout + before.stderr, /EK2117/)
      // Emitting with noEmitOnError:false exercises the unchanged old lowering.
      const declaration = readFileSync(join(dir, "out/main.d.ts"), "utf8")
      const observe = () => {
        const result = spawnSync(process.execPath, ["--input-type=module","-e",'import { observe } from "./out/main.js"; console.log(JSON.stringify(observe()))'], { cwd:dir, encoding:"utf8", timeout:30000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
        return result.stdout
      }
      const value = observe()
      assert.equal(JSON.parse(value).tag, "Child")
      if (empty) assert.equal(JSON.parse(value).extra, false)
      const fixed = compile("--fix", ...scope)
      assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
      assert.equal(readFileSync(join(dir, "out/main.d.ts"), "utf8"), declaration)
      assert.equal(observe(), value)
      const text = readFileSync(join(dir, "main.vibe"), "utf8")
      assert.match(text, /export class Child extends/)
      assert.match(text, /Child documentation/)
      const again = compile("--fix", ...scope)
      assert.equal(again.status, 0, again.stdout + again.stderr)
      assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), text)
    })
  }
}
