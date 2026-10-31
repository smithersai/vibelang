import {expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {createRequire} from "node:module"
import {spawnSync} from "node:child_process"

test("constructor extraction includes possible primitive values in its public types", () => {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), "vibelang-extractor-types-"))
  try {
    mkdirSync(join(dir, "node_modules"))
    symlinkSync(root, join(dir, "node_modules/vibelang-runtime"), "dir")
    symlinkSync(join(root, "node_modules/effect"), join(dir, "node_modules/effect"), "dir")
    writeFileSync(join(dir, "package.json"), '{"type":"module"}')
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {target: "ESNext", module: "NodeNext", strict: true, skipLibCheck: true, noEmit: true, types: []},
      files: ["main.ts"],
    }))
    const cases = [
      ["String", "string | String"],
      ["Number", "number | Number"],
      ["Boolean", "boolean | Boolean"],
      ["BigInt", "bigint | BigInt"],
      ["Symbol", "symbol | Symbol"],
    ]
    const source = 'import {$extract} from "vibelang-runtime"\n' + cases.map(([name, value]) => `
function check${name}(C: ${name}Constructor, subject: unknown) {
  const result = $extract(C, subject)
  if (result !== false) {
    const supported: ${value} = result[0]
    // @ts-expect-error The constructor can return a primitive.
    const objectOnly: object = result[0]
    return supported
  }
}
`).join("\n") + `
function newOnly(C: new () => Number, subject: unknown) {
  const result = $extract(C, subject)
  if (result !== false) {
    const supported: Number | number = result[0]
    // @ts-expect-error Number is assignable to this constructor signature.
    const objectOnly: object = result[0]
    return supported
  }
}
class Nominal extends Number { readonly marker = "nominal" }
function ordinary(subject: unknown) {
  const result = $extract(Nominal, subject)
  if (result !== false) {
    const supported: Nominal = result[0]
    return supported.marker
  }
}
`
    writeFileSync(join(dir, "main.ts"), source)
    const require = createRequire(import.meta.url)
    const result = spawnSync(process.execPath, [require.resolve("typescript/lib/tsc.js"), "-p", dir], {
      cwd: dir, encoding: "utf8", timeout: 45_000,
    })
    expect(result.status, result.stdout + result.stderr + source).toBe(0)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
}, 60_000)
