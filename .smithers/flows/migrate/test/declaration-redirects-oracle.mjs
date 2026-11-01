// Real native declaration output and the upstream type-aware checker.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, readFileSync, symlinkSync } from "node:fs"
import { dirname, join, delimiter } from "node:path"
import { spawnSync } from "node:child_process"
import { wireDeclarationRedirects } from "../lib/declaration-redirects.mjs"

function put(root, file, value) {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value))
}

function check(root, tag, lint) {
  const run = spawnSync(lint, ["--threads", "2", "--format", "json", "-c", ".oxlintrc.json", "packages/c/src/probe.ts"], {
    cwd: root, encoding: "utf8", env: { ...process.env, GOMAXPROCS: "2", PATH: dirname(lint) + delimiter + process.env.PATH }
  })
  assert.ifError(run.error)
  assert.equal(run.signal, null)
  assert.equal(run.status, 1, run.stdout + run.stderr)
  let data
  try { data = JSON.parse(run.stdout) }
  catch { assert.fail("Oxlint did not return JSON: " + (run.stdout + run.stderr).slice(-4000)) }
  assert.equal(data.number_of_files, 1)
  const lines = data.diagnostics.map(d => d.labels[0].span.line).sort((a, b) => a - b)
  put(root, tag + ".json", data)
  assert.ok(lines.includes(5), "negative any-union control must warn")
  assert.ok(!lines.includes(4), "direct subpath interface must stay typed")
  for (const d of data.diagnostics) {
    assert.equal(d.code, "typescript(no-redundant-type-constituents)")
    if (d.labels[0].span.line === 3) assert.match(d.message, /error.*type/)
  }
  return lines
}

export function inspectNamespaceRedirect(base, input, { ts, compiler, lint, lintModules }) {
  for (const extension of ["ts", "vibe"]) for (const refs of [false, true]) {
    const root = join(base, extension + "-" + refs)
    const dir = [input.namespace, ...Array.from({ length: input.depth ?? 0 }, (_, i) => "p" + i)].join("/")
    const leaf = "export interface " + input.name + " {readonly id:string}\n"
    mkdirSync(root, { recursive: true })
    put(root, "package.json", { private: true, type: "module" })
    put(root, ".oxlintrc.json", {
      options: { typeAware: true }, plugins: ["typescript"],
      rules: { "typescript/no-redundant-type-constituents": "error" }
    })
    put(root, "packages/p/package.json", {
      name: "@fixture/aws", type: "module",
      exports: { ".": "./src/index.ts", "./resource": "./src/" + dir + "/" + input.name + "." + extension }
    })
    put(root, "packages/p/src/" + dir + "/" + input.name + "." + extension, leaf)
    if (extension === "vibe") put(root, "packages/p/src/" + dir + "/" + input.name + ".d.vibe.ts", leaf)
    put(root, "packages/p/src/" + dir + "/index.ts", 'export * from "./' + input.name + '.' + extension + '";\n')
    put(root, "packages/p/src/index.ts", 'export * as ' + input.namespace + ' from "./' + dir + '/index.ts";\n')
    const options = {
      strict: true, skipLibCheck: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
      allowArbitraryExtensions: true, allowImportingTsExtensions: true, disableSourceOfProjectReferenceRedirect: true
    }
    put(root, "packages/p/tsconfig.json", {
      compilerOptions: { ...options, composite: true, declaration: true, emitDeclarationOnly: true, rootDir: "src", outDir: "lib" },
      include: ["src/**/*.ts", "src/**/*.vibe"]
    })
    put(root, "packages/c/tsconfig.json", {
      compilerOptions: { ...options, noEmit: true }, include: ["src/**/*.ts"],
      ...(refs ? { references: [{ path: "../p" }] } : {})
    })
    put(root, "tsconfig.json", { files: [], references: [{ path: "packages/p" }, { path: "packages/c" }] })
    put(root, "packages/c/src/probe.ts",
      'import * as Cloud from "@fixture/aws";\n' +
      'import type {' + input.name + '} from "@fixture/aws/resource";\n' +
      'export type Namespace=Cloud.' + input.namespace + '.' + input.name + '|string;\n' +
      'export type Subpath=' + input.name + '|string;\nexport type MustWarn=any|string;\n')
    mkdirSync(join(root, "node_modules/@fixture"), { recursive: true })
    symlinkSync(join(root, "packages/p"), join(root, "node_modules/@fixture/aws"))
    for (const name of ["oxlint-tsgolint", "@oxlint-tsgolint"]) {
      symlinkSync(join(lintModules, name), join(root, "node_modules", name))
    }
    const build = spawnSync(compiler, ["-b", "packages/p/tsconfig.json", "--pretty", "false"], {
      cwd: root, encoding: "utf8", env: { ...process.env, GOMAXPROCS: "2", PATH: dirname(lint) + delimiter + process.env.PATH }
    })
    assert.ifError(build.error)
    assert.equal(build.status, 0, build.stdout + build.stderr)
    assert.ok(readFileSync(join(root, "packages/p/lib/" + dir + "/" + input.name + ".d.ts"), "utf8").includes("interface " + input.name))
    const before = check(root, extension + "-" + refs + "-before", lint)
    assert.deepEqual(before, extension === "vibe" && refs ? [3, 5] : [5])
    const receipt = wireDeclarationRedirects({
      root, ts, configs: ["packages/p/tsconfig.json", "packages/c/tsconfig.json", "tsconfig.json"]
    })
    assert.equal(receipt.edits.length, 2)
    const after = check(root, extension + "-" + refs + "-after", lint)
    assert.deepEqual(after, [5], "source redirects should restore namespace interface")
  }
}
