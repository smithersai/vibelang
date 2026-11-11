// opencode core script project (tsconfig include ["."]): the runtime
// preparation step writes each project's loader record and checks it at once.
// The record's compile writes each module body's declaration,
// x.vibe.<name>.d.ts, beside the sidecar after the record has listed the
// directory, so the check failed with "gained or lost a file" on every fresh
// checkout. A body's declaration is an output while its source declares that
// body (VIP-40), as the compiler's discovery treats it; a file of that shape
// whose source declares no such body stays an input.
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

// main.vibe declares two bodies; Über checks the file name encoding.
const main = [
  "module platform {",
  "  export function answer(): number { return 42 }",
  "}",
  "module Über {",
  "  export const label: string = \"u\"",
  "}",
  "export { answer } from platform",
  "export { label } from Über",
  ""
].join("\n")

const layouts = [
  { name: "beside the source, include src", include: ["src"], at: "src" },
  { name: "beside the source, include .", include: ["."], at: "src" },
  // The record mirrors sidecar paths from the config directory, the
  // migration layout's rootDir.
  { name: "under vibe.sidecarDir, include .", include: ["."], rootDir: ".", vibe: { sidecarDir: "types" }, at: "types/src" }
]

for (const layout of layouts) {
  test("a loader record holds after its compile writes module body declarations " + layout.name, { skip }, async (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-loader-body-")))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", private: true, type: "module" }))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { module: "nodenext", strict: true, skipLibCheck: true, types: [], ...(layout.rootDir ? { rootDir: layout.rootDir } : {}) },
      include: layout.include, ...(layout.vibe ? { vibe: layout.vibe } : {})
    }))
    writeFileSync(join(root, "src/main.vibe"), main)
    await sleep(1500) // past the record's margin, as a checked-out tree is
    const project = join(root, "tsconfig.json")
    const written = writeLoaderRecord({ project, root, compiler: native })
    assert.equal(written.modules, 3, JSON.stringify(written)) // main.vibe and its two bodies
    for (const name of ["main.vibe.platform.d.ts", "main.vibe.-dc-ber.d.ts"]) {
      assert.ok(existsSync(join(root, layout.at, name)), `the record's compile wrote ${name}`)
    }
    assert.deepEqual(checkLoaderRecord({ project, root, compiler: native }), { modules: 3 })
    // A file of a body declaration's shape whose source declares no such body
    // is the project's own input.
    writeFileSync(join(root, layout.at, "main.vibe.other.d.ts"), "export declare const other: number\n")
    assert.match(checkLoaderRecord({ project, root, compiler: native }).miss, /gained or lost a file/)
  })
}
