import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync } from "node:fs"
import { dirname, join, delimiter } from "node:path"
import { fileURLToPath } from "node:url"

const pkg = fileURLToPath(new URL("..", import.meta.url))
export const compiler = process.env.VIBELANG_BINARY || join(pkg, "native", process.platform === "win32" ? "vibelang.exe" : "vibelang")
const oxlint = join(pkg, "node_modules", ".bin", process.platform === "win32" ? "oxlint.cmd" : "oxlint")
export function namespaceFixture(root, input, extension, references) {
  function write(name, value) {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value))
  }
  const nested = Array.from({ length: input.depth }, (_, i) => "p" + i).join("/")
  const leaf = nested + "/" + input.name
  const options = {
    strict: true, skipLibCheck: true, target: "ES2022", module: "ESNext",
    moduleResolution: "Bundler", allowArbitraryExtensions: true,
    allowImportingTsExtensions: true, disableSourceOfProjectReferenceRedirect: true
  }
  write("package.json", { private: true, type: "module" })
  write(".oxlintrc.json", { options: { typeAware: true }, plugins: ["typescript"], rules: { "typescript/no-redundant-type-constituents": "error" } })
  write("packages/producer/package.json", {
    name: "@fixture/cloud", type: "module",
    exports: { ".": "./src/index.ts", "./resource": "./src/" + leaf + "." + extension }
  })
  const declaration = "export interface " + input.name + " { readonly id: string }\n"
  write("packages/producer/src/" + leaf + "." + extension, declaration)
  if (extension === "vibe") write("packages/producer/src/" + leaf + ".d.vibe.ts", declaration)
  write("packages/producer/src/" + nested + "/index.ts", 'export * from "./' + input.name + "." + extension + '";\n')
  write("packages/producer/src/index.ts", 'export * as ' + input.namespace + ' from "./' + nested + '/index.ts";\n')
  write("packages/producer/tsconfig.json", {
    compilerOptions: { ...options, composite: true, declaration: true, emitDeclarationOnly: true, rootDir: "src", outDir: "lib" },
    include: ["src/**/*.ts", "src/**/*.vibe"]
  })
  write("packages/consumer/package.json", { private: true, type: "module" })
  write("packages/consumer/tsconfig.json", {
    compilerOptions: { ...options, noEmit: true }, include: ["src/**/*.ts"],
    ...(references ? { references: [{ path: "../producer" }] } : {})
  })
  write("tsconfig.json", { files: [], references: [{ path: "packages/producer" }, { path: "packages/consumer" }] })
  mkdirSync(join(root, "node_modules/@fixture"), { recursive: true })
  symlinkSync(join(root, "packages/producer"), join(root, "node_modules/@fixture/cloud"), "dir")
  symlinkSync(join(pkg, "node_modules/oxlint-tsgolint"), join(root, "node_modules/oxlint-tsgolint"), "dir")
  symlinkSync(join(pkg, "node_modules/@oxlint-tsgolint"), join(root, "node_modules/@oxlint-tsgolint"), "dir")
  const expression = "Cloud." + input.namespace + "." + input.name
  const source = 'import * as Cloud from "@fixture/cloud";\n' +
    'import type { ' + input.name + ' } from "@fixture/cloud/resource";\n' +
    "export type Namespace = " + expression + " | string;\n" +
    "export type Subpath = " + input.name + " | string;\n" +
    "export type MustWarn = any | string;\n"
  write("packages/consumer/src/probe.ts", source)
  const env = { ...process.env, GOMAXPROCS: "2", PATH: dirname(oxlint) + delimiter + process.env.PATH }
  assert.ok(existsSync(compiler), "build the native compiler or set VIBELANG_BINARY")
  const build = spawnSync(compiler, ["-b", join(root, "packages/producer/tsconfig.json"), "--pretty", "false"], { cwd: root, env, encoding: "utf8" })
  assert.ifError(build.error)
  assert.equal(build.signal, null)
  assert.equal(build.status, 0, build.stdout + build.stderr)
  // Validate emitted declaration provenance, rather than substituting a
  // hand-authored lib tree for the producer the linter actually redirects to.
  assert.ok(readFileSync(join(root, "packages/producer/lib", leaf + ".d.ts"), "utf8").includes("interface " + input.name))
  const lint = spawnSync(oxlint, ["--threads", "2", "--format", "json", "-c", join(root, ".oxlintrc.json"), join(root, "packages/consumer/src/probe.ts")], { cwd: root, env, encoding: "utf8" })
  assert.ifError(lint.error)
  assert.equal(lint.signal, null)
  assert.equal(lint.status, 1, "the independent any-union negative control must run: " + lint.stdout + lint.stderr)
  let report
  try { report = JSON.parse(lint.stdout) } catch { assert.fail("Oxlint did not produce JSON: " + (lint.stdout + lint.stderr).slice(-4000)) }
  assert.equal(report.number_of_files, 1)
  const diagnostics = report.diagnostics.map(d => ({
    code: d.code, severity: d.severity, message: d.message,
    file: d.filename.replaceAll("\\", "/"), span: d.labels[0].span
  }))
  return { diagnostics, expression, source }
}
