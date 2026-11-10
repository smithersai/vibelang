// opencode client script project: the runtime preparation step writes each
// project's loader record and checks it at once. The record's compile is the
// first to write a module's native declaration x.d.ts beside x.vibe, after
// the record has listed the directory, so the check failed with "gained or
// lost a file" until a second run. The record holds, as its compile is a
// complete compile of that tree.
import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { checkLoaderRecord, writeLoaderRecord } from "../project.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const skip = !existsSync(native) && `run typescript/vibelang/smoke.sh first; missing ${native}`

for (const layout of [{ name: "beside the source" }, { name: "under vibe.sidecarDir", vibe: { sidecarDir: "types" } }]) {
  test("a loader record holds after its compile writes the first native declaration " + layout.name, { skip }, async (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-loader-native-")))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", private: true, type: "module" }))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { module: "nodenext", strict: true, skipLibCheck: true, types: [] },
      include: ["src"], ...(layout.vibe ? { vibe: layout.vibe } : {})
    }))
    writeFileSync(join(root, "src/generate.vibe"), "export const answer: number = 42\n")
    writeFileSync(join(root, "src/plain.ts"), "export const plain = 1\n")
    await sleep(1500) // past the record's margin, as a checked-out tree is
    const project = join(root, "tsconfig.json")
    const written = writeLoaderRecord({ project, root, compiler: native })
    assert.equal(written.modules, 1, JSON.stringify(written))
    const forwarder = layout.vibe ? join(root, "types/generate.d.ts") : join(root, "src/generate.d.ts")
    assert.ok(existsSync(forwarder), "the record's compile wrote the native declaration")
    assert.deepEqual(checkLoaderRecord({ project, root, compiler: native }), { modules: 1 })
    writeFileSync(join(root, "src/added.ts"), "export const added = 2\n")
    assert.match(checkLoaderRecord({ project, root, compiler: native }).miss, /gained or lost a file/)
  })
}
