import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { appendFileSync, cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, matchesGlob, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
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
function key(root, label = "//:api-identity-test") {
  const result = invoke(root, "explain", label, "--format", "json")
  assert.equal(result.status, 0, output(result))
  return JSON.parse(result.stdout).cache.key
}
// Path selection reads the declarations without digesting the tree, so it fits the command budget on a busy box.
function assertWholeTreeInput(root, files) {
  const result = invoke(root, "affected", "ci", "//:release", "//:api-identity-test",
    ...files.flatMap(file => ["--files", file]), "--list", "--format", "json")
  assert.equal(result.status, 0, output(result))
  const { conservative, targets } = JSON.parse(result.stdout)
  assert.equal(conservative, false, "these paths must select by declared input")
  assert.ok(!targets.some(target => target.label === "//:api-identity-test"), "API identity must not select unrelated paths")
  const release = targets.find(target => target.label === "//:release")
  const direct = release?.reasonDetails.filter(reason => reason.kind === "declared-input"
    && reason.input?.pattern === "**" && reason.dependencyPath.join(" ") === "//:release //:tree") ?? []
  assert.deepEqual(direct.map(reason => reason.file).sort(), [...files].sort(), "release must retain the whole-tree input")
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
        && !["typescript/built", "site/dist", "site/.astro"].some(dir => path === dir || path.startsWith(dir + "/"))
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

test("relative API fixture inputs retain transitive helpers and URL assets", t => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 6 }), fc.constantFrom("static", "dynamic", "bare", "url"), fc.boolean(), (depth, form, cycle) => {
    const root = temp(t, "api-input-closure-")
    const statement = spec => {
      const name = JSON.stringify(spec)
      if (form === "static") return "import { value as nextValue } from " + name + ";"
      if (form === "dynamic") return "void import(" + name + ");"
      if (form === "bare") return "import " + name + ";"
      return "new URL(" + name + ", import.meta.url);"
    }
    const expected = ["scripts/api-identity.mjs", "scripts/nested/rules.json"]
    put(root, expected[0], statement("./nested/helper-1.mjs") + "\nexport const value = 1;")
    for (let i = 1; i <= depth; i++) {
      const file = "scripts/nested/helper-" + i + ".mjs"
      const next = i < depth ? statement("./helper-" + (i+1) + ".mjs") : cycle ? statement("../api-identity.mjs") : ""
      put(root, file, '// import "./comment-only.mjs";\n' + next + '\nnew URL("./rules.json", import.meta.url);\nexport const value = 1;')
      expected.push(file)
    }
    put(root, "scripts/nested/rules.json", "{}")
    put(root, "scripts/nested/comment-only.mjs", "export const ignored = 1")
    assert.deepEqual(relativeApiFiles([expected[0]], root), expected.sort())
  }), { seed: 186016, numRuns: 120 })
})

test("the actual root API key ignores unrelated files and retains every input family", t => {
  const root = copyTree(t)
  const before = key(root)
  const neighbours = []
  // Include additions at several depths: exclusion must not depend on one witness.
  for (let i = 0; i < 64; i++) {
    const dir = ["typescript/tsc/internal/vibelangfuzz", "typescript/vibelang/cases", "docs/user/src", "site/src/pages"][i % 4]
    neighbours.push(dir + "/api-input-neighbour-" + i + [".go", ".vibe", ".md", ".mdx"][i % 4])
    put(root, neighbours[i], "// unrelated fixture\n")
  }
  assert.equal(key(root), before, "Go, compiler cases, user prose and generated site output must not invalidate API identity")
  assertWholeTreeInput(root, neighbours)

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
  for (const file of selected) {
    const original = readFileSync(join(root, file))
    console.error("API_INPUT_SELECTED", file)
    appendFileSync(join(root, file), "\n")
    assert.notEqual(key(root), before, "API key must retain " + file)
    writeFileSync(join(root, file), original)
  }
  // Parent-walking project lookup can see root configs when TMPDIR is in-tree.
  for (const file of ["tsconfig.api-inputs.json", "vibe.config.json", "api-inputs-base.jsonc"]) {
    assert.equal(existsSync(join(root, file)), false)
    console.error("API_INPUT_CONFIG", file)
    put(root, file, JSON.stringify({}) + String.fromCharCode(10))
    assert.notEqual(key(root), before, "API key must retain added root config " + file)
    rmSync(join(root, file))
  }
  assert.equal(key(root), before, "restoring all selected bytes must restore the original API key")
})

test("whole-tree input guard rejects a narrowed release declaration", t => {
  const root = copyTree(t)
  const probe = ["docs/user/src/api-input-neighbour.md"]
  assertWholeTreeInput(root, probe)
  const packageFile = join(root, "PACKAGE.ts")
  const declaration = readFileSync(packageFile, "utf8")
  const wholeTree = "inputs: ReadonlyArray<unknown> = [tree]"
  assert.equal(declaration.split(wholeTree).length, 2)
  writeFileSync(packageFile, declaration.replace(wholeTree,
    'inputs: ReadonlyArray<unknown> = [S.Filegroup({ srcs: [S.glob("scripts/**")] })]'))
  assert.throws(() => assertWholeTreeInput(root, probe), /release must retain the whole-tree input/)
})

test("real SDK caching reuses API results across Go edits and rejects a changed declaration", t => {
  const root = temp(t, "vibelang-api-inputs-cache-")
  const outside = temp(t, "vibelang-api-inputs-trace-")
  const trace = join(outside, "calls")
  for (const file of ["api-inputs.ts", ".smithers/WORKSPACE.ts", ".smithers/package.json", ".smithers/bun.lock"]) {
    put(root, file, readFileSync(join(repo, file)))
  }
  symlinkSync(join(repo, ".smithers/node_modules"), join(root, ".smithers/node_modules"), "dir")
  put(root, "package.json", '{"name":"api-inputs-real-checker-fixture","private":true,"type":"module"}\n')
  for (const file of relativeApiFiles(["scripts/api-identity.mjs"]))
    put(root, file, readFileSync(join(repo, file)))
  put(root, "docs/tools/package.json", readFileSync(join(repo, "docs/tools/package.json")))
  symlinkSync(join(repo, "docs/tools/node_modules"), join(root, "docs/tools/node_modules"), "dir")
  put(root, "scripts/api-inputs-corpus.json", '{"before":"string","after":"string"}\n')
  put(root, "scripts/proof.mjs", [
    'import {appendFileSync,readFileSync,mkdirSync,writeFileSync} from "node:fs"',
    'import {join} from "node:path"',
    'import {compareApiIdentity,loadTypeScript} from "./api-identity.mjs"',
    'appendFileSync(process.env.TRACE,"api\\n")',
    'const corpus=JSON.parse(readFileSync("scripts/api-inputs-corpus.json","utf8"))',
    'const dirs=["before","after"].map(side=>{const dir=join(process.env.PROOF,side);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,"index.d.ts"),"export type X = "+corpus[side]+";");return dir})',
    'const result=compareApiIdentity(loadTypeScript(),...dirs)',
    'console.log(JSON.stringify(result));process.exitCode=result.identical?0:7',
    "",
  ].join("\n"))
  put(root, "PACKAGE.ts", [
    'import {Smithers as S} from "@smthrs/targets"',
    'import {createApiIdentityInputs} from "./api-inputs.ts"',
    'const packages=S.Filegroup({srcs:[S.glob("packages/**")]})',
    'const tree=S.Filegroup({srcs:[...S.glob(["**","!.jj/**"])]})',
    'export const Package=S.Package({targets:{',
    '"whole-tree-consumer":S.Shell.Test({shell:"true",data:[tree],tools:[],sandbox:"none"}),',
    '"api-identity-test":S.Shell.Test({',
    'shell:"node scripts/proof.mjs",data:[createApiIdentityInputs(S,packages)],tools:[S.Host.bin("node")],sandbox:"none",',
    "env:" + JSON.stringify({ TRACE: trace, PROOF: outside }),
    "})}})",
    "",
  ].join("\n"))
  const run = () => invoke(root, "test", "//:api-identity-test")
  const calls = () => readFileSync(trace, "utf8").trim().split("\n")
  for (let i = 0; i < 2; i++) {
    const result = run()
    assert.equal(result.status, 0, output(result))
    assert.deepEqual(calls(), ["api"], "unchanged successful results replay")
  }
  const wholeTree = () => key(root, "//:whole-tree-consumer")
  const wholeTreeBefore = wholeTree()
  assert.equal(wholeTree(), wholeTreeBefore, "the whole-tree key is stable without a source change")
  for (let i = 0; i < 64; i++)
    put(root, "typescript/tsc/internal/vibelangfuzz/deep/witness-" + i + ".go", "// unrelated\n")
  assert.notEqual(wholeTree(), wholeTreeBefore, "a whole-tree input must change its consumer's key")
  let result = run()
  assert.equal(result.status, 0, output(result))
  assert.deepEqual(calls(), ["api"], "Go edits retain the real checker result")
  appendFileSync(join(root, "scripts/api-identity.mjs"), "\n// selected checker mutation\n")
  result = run()
  assert.equal(result.status, 0, output(result))
  assert.deepEqual(calls(), ["api", "api"], "checker source changes execute the real comparator")
  put(root, "scripts/api-inputs-corpus.json", '{"before":"string","after":"number"}\n')
  result = run()
  assert.notEqual(result.status, 0, output(result))
  assert.equal(result.signal, null, output(result))
  assert.deepEqual(calls(), ["api", "api", "api"], "a changed public declaration must be checked and fail")
  put(root, "scripts/api-identity.mjs", readFileSync(join(repo, "scripts/api-identity.mjs")))
  put(root, "scripts/api-inputs-corpus.json", '{"before":"string","after":"string"}\n')
  result = run()
  assert.equal(result.status, 0, output(result))
  assert.deepEqual(calls(), ["api", "api", "api"], "restored bytes replay the earlier successful result")
})

test("current API entrypoints, imports, corpus and specification reads remain covered", async () => {
  const { apiInputPatterns } = await import("../../../api-inputs.ts")
  const covered = path => path.startsWith("packages/") || apiInputPatterns.some(pattern => matchesGlob(path, pattern))
  const visited = new Set()
  function inspect(file) {
    if (visited.has(file)) return
    visited.add(file)
    assert.ok(covered(file), "declare the API read input " + file)
    const text = readFileSync(join(repo, file), "utf8")
    for (const match of text.matchAll(/(?:from\s*|import\s*\(|new URL\s*\()\s*["'](\.[^"']+)["']/g)) {
      const resolved = relative(repo, join(dirname(join(repo, file)), match[1]))
      if (!existsSync(join(repo, resolved)) || !statSync(join(repo, resolved)).isFile()) continue
      assert.ok(covered(resolved), "declare relative API input " + resolved)
      if (resolved.endsWith(".mjs")) inspect(resolved)
    }
    for (const match of text.matchAll(/SpecPath\(["']([^"']+)["']\)/g))
      assert.ok(covered("docs/design/src/" + match[1]), "declare specification lookup " + match[1])
  }
  for (const name of readdirSync(join(repo, "scripts")))
    if (/^api-identity.*\.mjs$/.test(name)) inspect("scripts/" + name)
  inspect("scripts/sync-api-identity.mjs")
  for (const file of globSync("scripts/api-identity-corpus/**/*.json", { cwd: repo })) {
    const corpus = JSON.parse(readFileSync(join(repo, file), "utf8"))
    if (typeof corpus.spec === "string")
      assert.ok(covered(corpus.spec.split("#")[0]), "declare corpus specification read " + corpus.spec)
  }
  assert.ok(visited.size >= 20, "audit actual API files, not an empty selection")
})
