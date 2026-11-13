import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, matchesGlob, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
const requireFromDocs = createRequire(new URL("../../../docs/tools/package.json", import.meta.url))
const ts = requireFromDocs("typescript")
const fc = requireFromDocs("fast-check")

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const cli = join(repo, ".smithers/node_modules/.bin/smthrs")
const output = result => result.stdout + result.stderr + String(result.error ?? "")
let commandSequence = 0
function invoke(root, ...args) {
  const sequence = ++commandSequence
  const started = performance.now()
  console.error("API_INPUT_COMMAND_BEGIN", sequence, args[0], args[1] ?? "")
  const result = spawnSync(process.execPath, [cli, ...args, "--workspace", root, "--ui", "plain"], {
    encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  })
  console.error("API_INPUT_COMMAND_END", sequence, Math.round(performance.now() - started),
    result.status, result.signal ?? "none", result.error?.code ?? "none")
  return result
}
function temp(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function put(root, file, text) {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}
function key(root, label = "//:api-identity-sync") {
  const result = invoke(root, "explain", label, "--format", "json")
  assert.equal(result.status, 0, output(result))
  const cache = JSON.parse(result.stdout).cache
  assert.equal(cache.cacheable, true, "key assertions must inspect an executable cacheable leaf")
  return cache.key
}

// Path selection reads the declarations without digesting the tree, so it fits the command budget on a busy box.
function assertWholeTreeInput(root, files) {
  const result = invoke(root, "affected", "ci", "//:release", "//:api-identity-test",
    ...files.flatMap(file => ["--files", file]), "--list", "--format", "json")
  assert.equal(result.status, 0, output(result))
  const { conservative, targets } = JSON.parse(result.stdout)
  assert.equal(conservative, false, "these paths must select by declared input")
  assert.ok(!targets.some(target => target.label === "//:api-identity-test" && target.reasonDetails.some(reason => reason.kind === "declared-input")), "API identity must not select unrelated paths")
  const release = targets.find(target => target.label === "//:release")
  const direct = release?.reasonDetails.filter(reason => reason.kind === "declared-input" && reason.input?.pattern === "**"
    && (reason.dependencyPath.includes("//:tree") || reason.dependencyPath.some(label => label.startsWith("//:root-input-file-")))) ?? []
  assert.deepEqual([...new Set(direct.map(reason => reason.file))].sort(), [...files].sort(), "release must retain the whole-tree input")
}

function copyTree(t) {
  const started = performance.now()
  console.error("API_INPUT_COPY_BEGIN")
  const root = temp(t, "vibelang-api-inputs-root-")
  // A private source copy never carries repository stores or installed modules.
  for (const name of readdirSync(repo)) {
    if ([".jj", ".git", ".cache", ".flows", "node_modules"].includes(name)) continue
    cpSync(join(repo, name), join(root, name), { recursive: true, filter(source) {
      const path = relative(repo, source)
      const parts = path.split("/")
      return !parts.some(part => [".jj", ".git", ".cache", ".flows", "node_modules"].includes(part))
        && !["typescript/built", "packages/compiler/native", "packages/runtime/dist", "packages/ts-mapper/dist", "site/dist", "site/.astro"].some(dir => path === dir || path.startsWith(dir + "/"))
    } })
  }
  for (const dir of [".smithers", "docs/tools"]) {
    mkdirSync(join(root, dir), { recursive: true })
    symlinkSync(join(repo, dir, "node_modules"), join(root, dir, "node_modules"), "dir")
  }
  console.error("API_INPUT_COPY_END", Math.round(performance.now() - started))
  return root
}

function relativeApiFiles(entries, base = repo) {
  const files = new Set()
  function visit(file) {
    if (files.has(file)) return
    files.add(file)
    if (!file.endsWith(".mjs")) return
    const ast = ts.createSourceFile(file, readFileSync(join(base, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const walk = node => {
      let specifier
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0]
      else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") specifier = node.arguments?.[0]
      if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) {
        const resolved = relative(base, join(base, dirname(file), specifier.text))
        assert.ok(!resolved.startsWith(".."), "fixture input must stay inside its source tree")
        if (existsSync(join(base, resolved)) && statSync(join(base, resolved)).isFile()) visit(resolved)
      }
      ts.forEachChild(node, walk)
    }
    walk(ast)
  }
  for (const file of entries) visit(file)
  return [...files].sort()
}

export { assert, appendFileSync, cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, dirname, join, matchesGlob, relative, ts, fc, repo, cli, output, invoke, temp, put, key, assertWholeTreeInput, copyTree, relativeApiFiles }

const selected = [
    "scripts/api-identity.mjs",
    "scripts/api-identity-corpus/smithers-canonical-eval-api.json",
    "scripts/testing/property.mjs",
    "scripts/sync-api-identity.mjs",
    ".smithers/flows/migrate/lib/api-identity.mjs",
    ".smithers/flows/migrate/README.md",
    "docs/design/src/001-functions.md",
    "docs/maintainers/api-identity.md",
    "docs/tools/bun.lock",
    "experiments/package.json",
    "packages/runtime/package.json",
    ".smithers/bun.lock",
    "api-inputs.ts",
  ]
const configs = ["tsconfig.api-inputs.json", "vibe.config.json", "api-inputs-base.jsonc"]
export const apiInputProbes = [...selected.map(file => ({ file, added: false })), ...configs.map(file => ({ file, added: true }))]
export function assertSelectedApiInputs(root, baseline, probes) {
  for (const { file, added } of probes) {
    console.error("API_INPUT_SELECTED", file)
    const original = added ? undefined : readFileSync(join(root, file))
    if (added) {
      assert.equal(existsSync(join(root, file)), false)
      put(root, file, JSON.stringify({}) + String.fromCharCode(10))
    } else appendFileSync(join(root, file), "\n")
    try {
      assert.notEqual(key(root), baseline, "API key must retain " + file)
    } finally {
      if (added) rmSync(join(root, file))
      else writeFileSync(join(root, file), original)
    }
  }
  assert.equal(key(root), baseline, "restoring selected bytes restores the API key")
}
