import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { checkProperty } from "./testing/property.mjs"
import { stripInternalOutput } from "../typescript/vibelang/cases/_schema-stripinternal.mjs"

const repo = fileURLToPath(new URL("../", import.meta.url))
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const binary = process.env.VIBELANG_BINARY ?? join(repo, "typescript/built/local/tsc")

function verify({ name, form, nested, newline }) {
  const dir = mkdtempSync(join(tmpdir(), "schema-stripinternal-"))
  const previous = process.cwd(), previousBinary = process.env.VIBELANG_BINARY
  try {
    mkdirSync(join(dir, "typescript"))
    mkdirSync(join(dir, "node_modules"))
    symlinkSync(join(resolve(process.env.EFFECT_NODE_MODULES ?? join(repo, "experiments/node_modules")), "effect"),
      join(dir, "node_modules/effect"))
    symlinkSync(resolve(process.env.VIBELANG_RUNTIME ?? join(repo, "packages/runtime")),
      join(dir, "node_modules/vibelang-runtime"))
    writeFileSync(join(dir, "package.json"), '{"type":"module"}')
    const options = { strict: true, skipLibCheck: true, target: "ES2022", module: "NodeNext",
      declaration: true, emitDeclarationOnly: true, stripInternal: true, outDir: "out", types: [] }
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: options,
      files: ["main.vibe"], vibe: { effectGlobals: false, effectModules: false } }))
    writeFileSync(join(dir, "typescript/tsconfig.emit.json"), JSON.stringify({
      compilerOptions: options, files: ["main.ts"],
    }))
    const comment = "/** Internal " + name + ".\n * @internal\n */\n"
    const vibe = comment + "export schema " + name +
      (form === "struct" ? " { readonly value: string }\n" : " = string;\n")
    const stock = comment + "export const " + name + " = " +
      (form === "struct" ? "Schema.Struct({ value: Schema.String })" : "Schema.String") +
      ";\nexport type " + name + " = typeof " + name + ".Type;\n"
    const wrap = text => 'import * as Schema from "effect/Schema";\n' +
      (nested ? "export namespace Models {\n" + text + "}\n" : text)
    writeFileSync(join(dir, "main.vibe"), wrap(vibe).replaceAll("\n", newline))
    writeFileSync(join(dir, "typescript/main.ts"), wrap(stock).replaceAll("\n", newline))
    const compiled = spawnSync(binary, ["-p", dir, "--pretty", "false"], {
      encoding: "utf8", timeout: 30_000,
    })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
    process.env.VIBELANG_BINARY = binary
    process.chdir(dir)
    stripInternalOutput([name])
  } finally {
    process.chdir(previous)
    if (previousBinary === undefined) delete process.env.VIBELANG_BINARY
    else process.env.VIBELANG_BINARY = previousBinary
    rmSync(dir, { recursive: true, force: true })
  }
}

test("property: stripped schema constants preserve TypeScript output and dangling-alias diagnostics", async () => {
  await checkProperty(fc, {
    name: "schema-stripinternal-native-emission",
    rule: "006-data.md: A JSDoc comment on a schema declaration is emitted on its declare const only; its typeof Name.Type alias has no comment. Native removeComments and stripInternal behavior is unchanged.",
    command: "node --test scripts/schema-stripinternal-property.test.mjs",
    arbitrary: fc.record({
      name: fc.constantFrom("Parcel", "Note", "A17", "LongValue"),
      form: fc.constantFrom("struct", "alias"),
      nested: fc.boolean(),
      newline: fc.constantFrom("\n", "\r\n"),
    }),
    numRuns: 8,
    check: verify,
  })
})
