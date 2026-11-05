import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const { vibePath } = await import(pathToFileURL(resolve(".smithers/flows/migrate/lib/codemod.mjs")).href)
const { planScope } = await import(pathToFileURL(resolve(".smithers/flows/migrate/lib/onepass.mjs")).href)
const { file, source = "export const value = 1\n" } = JSON.parse(readFileSync(0, "utf8"))
mkdirSync(".cache", { recursive: true })
const root = mkdtempSync(resolve(".cache/migration-route-"))
const control = "__migration_control.ts"
const put = (name, text) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text) }
function snapshot(directory = root, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = prefix + entry.name
    return entry.isDirectory() ? snapshot(join(directory, entry.name), name + "/") : [[name, readFileSync(join(directory, entry.name), "utf8")]]
  })
}
try {
  put("package.json", '{"type":"module"}')
  put("tsconfig.json", '{"compilerOptions":{"jsx":"preserve"},"include":["**/*"]}')
  put(file, source)
  put(control, "export const control = 1\n")
  const before = JSON.stringify(snapshot())
  const plan = planScope(root, [file, control])
  const admitted = plan.batches.some(batch => batch.files.includes(file))
  console.log(JSON.stringify({
    admitted, rejected: !admitted, value: admitted ? vibePath(file) : "",
    deferred: plan.deferred.filter(entry => entry.file === file),
    unchanged: JSON.stringify(snapshot()) === before
  }))
} finally { rmSync(root, { recursive: true, force: true }) }
