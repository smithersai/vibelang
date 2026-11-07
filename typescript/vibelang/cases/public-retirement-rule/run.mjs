// rule-evidence: docs/design/vips/README.md#vibelang-improvement-proposals
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, "../../../..")
const { verifyWitness } = await import(path.join(repo, "docs/tools/retirement-gate.mjs"))
const compiler = process.env.VIBELANG_TEST_COMPILER || process.env.VIBELANG_BINARY || path.join(repo, "typescript/built/local/tsc")
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "docs/design/retirement-fixes.json"), "utf8"))
const entry = manifest.find(entry => entry.code === "EK0909")
const witness = entry?.cases.find(witness => witness.input.endsWith("/retired-service-class.fail"))
assert.ok(witness, "the retired declaration has a registered preserving fix")
const root = fs.mkdtempSync(path.join(tmpdir(), "public-retirement-rule-"))
const modules = process.env.EFFECT_NODE_MODULES || path.join(repo, "experiments/node_modules")
fs.mkdirSync(path.join(root, "docs/tools/node_modules"), { recursive: true })
fs.mkdirSync(path.join(root, "packages"), { recursive: true })
for (const name of ["effect", "@effect"])
  if (fs.existsSync(path.join(modules, name)))
    fs.symlinkSync(path.join(modules, name), path.join(root, "docs/tools/node_modules", name))
fs.symlinkSync(process.env.VIBELANG_RUNTIME || path.join(repo, "packages/runtime"), path.join(root, "packages/runtime"))
const files = dir => fs.readdirSync(path.join(repo, dir), { recursive: true, withFileTypes: true })
  .filter(file => file.isFile()).map(file => path.relative(repo, path.join(file.parentPath, file.name)).split(path.sep).join("/"))
  .filter(file => !/\/(?:out|node_modules|\.cache[^/]*)\//.test(file) && !/\.d\.vibex?\.ts$/.test(file))
try {
  const paths = [...files(witness.input), ...files(witness.output)].sort()
  verifyWitness(entry.code, witness, { paths, read: file => fs.readFileSync(path.join(repo, file), "utf8") }, root, compiler)
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log("a retired declaration has a preserving registered fix")
