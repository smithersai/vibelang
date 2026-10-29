// Local release assembly only: npm pack runs, npm publish never does.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const platformPackage = (platform) => platform.startsWith("win32-") ? `@vibelang/cli-${platform}` : `vibelang-${platform}`
const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]
const json = (file) => JSON.parse(readFileSync(file, "utf8"))
// The compiler package's own files; make-packages writes the others.
const compilerSources = json(join(repo, "packages/compiler/package.json")).files
  .filter((file) => !["editor", "dprint-plugin.json", "README.md", "LICENSE", "NOTICE"].includes(file))
  .map((file) => `packages/compiler/${file}`)
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-release-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const path of ["scripts/release/make-packages.mjs", "docs/tools/release-docs.mjs", "LICENSE", "typescript/LICENSE.txt", "typescript/NOTICE.txt", "typescript/tsc/internal/vibelang/identity.go",
    ...["compiler", "runtime", "vite", "create-vibelang", "unplugin"].flatMap((name) => [`packages/${name}/package.json`, `packages/${name}/README.md`]),
    ...compilerSources, "editors/tree-sitter-vibelang/src", "packages/vite/src", "packages/create-vibelang/bin", "packages/unplugin/src", "templates/app"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    cpSync(join(repo, path), join(root, path), { recursive: true, filter: (file) => !["node_modules", "dist", ".prototype"].includes(file.split("/").at(-1)) })
  }
  for (const path of ["packages/runtime/dist/index.js", "packages/runtime/dist/index.d.ts", "packages/runtime/dist/kernel/kernel.js", "editors/vscode/vibelang.vsix"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), `fixture ${path}\n`)
  }
  for (const platform of platforms) {
    const binary = join(root, "dist-npm/bin", platform, platform.startsWith("win32") ? "vibelang.exe" : "vibelang")
    mkdirSync(dirname(binary), { recursive: true })
    writeFileSync(binary, Buffer.from(`binary ${platform}\0\xff`))
  }
  return root
}
function assemble(root) {
  return spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build"], { encoding: "utf8", timeout: 120_000 })
}
function archive(root, name, path) {
  const version = json(join(root, "packages/compiler/package.json")).version
  return execFileSync("tar", ["-xOzf", join(root, "dist-npm/tarballs", `${name.replace("@", "").replace("/", "-")}-${version}.tgz`), `package/${path}`], { maxBuffer: 64 * 1024 * 1024 })
}

test("packs every file the compiler package lists and every target its exports name", { timeout: 120_000 }, (t) => {
  const root = fixture(t)
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  const compiler = json(join(root, "packages/compiler/package.json"))
  assert.deepEqual(archive(root, "vibelang", "tree-sitter/scanner.c"), readFileSync(join(repo, "editors/tree-sitter-vibelang/src/scanner.c")))
  assert.ok(archive(root, "vibelang", "tree-sitter/parser.c").length > 1000)
  const targets = Object.values(compiler.exports).flatMap((target) => typeof target === "string" ? [target] : Object.values(target))
  for (const path of [...targets.map((target) => target.replace(/^\.\//, "")), ...compiler.files.filter((file) => file !== "bin" && file !== "editor")]) {
    assert.ok(archive(root, "vibelang", path).length > 0, `vibelang tarball lacks ${path}`)
  }
})

test("assembles every package in publish order with pinned versions, platform binaries and portable templates", { timeout: 120_000 }, (t) => {
  const root = fixture(t)
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  const manifest = json(join(root, "dist-npm/tarballs/manifest.json"))
  const names = [...platforms.map((p) => platformPackage(p)), "vibelang", "vibelang-runtime", "vibelang-vite", "create-vibelang", "vibelang-unplugin"]
  assert.deepEqual(manifest.packages.map((p) => p.name), names)
  for (const pkg of manifest.packages) {
    assert.equal(pkg.version, manifest.version)
    assert.equal(readFileSync(join(root, "dist-npm/tarballs", pkg.file)).length, pkg.size)
    assert.ok(pkg.files > 0)
    const packed = JSON.parse(archive(root, pkg.name, "package.json"))
    assert.equal(packed.name, pkg.name)
    assert.equal(packed.version, manifest.version)
  }
  for (const platform of platforms) {
    const [os, cpu] = platform.split("-")
    const name = platformPackage(platform)
    const pkg = JSON.parse(archive(root, name, "package.json"))
    assert.deepEqual(pkg.os, [os])
    const compiler = json(join(root, "packages/compiler/package.json"))
    assert.deepEqual([pkg.homepage, pkg.bugs, pkg.repository], [compiler.homepage, compiler.bugs, compiler.repository], `${name} links to the compiler's repository`)
    assert.deepEqual(pkg.cpu, [cpu])
    const exe = os === "win32" ? "vibelang.exe" : "vibelang"
    assert.deepEqual(archive(root, name, `bin/${exe}`), readFileSync(join(root, "dist-npm/bin", platform, exe)))
    const mode = execFileSync("tar", ["-tvzf", join(root, "dist-npm/tarballs", `${name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`)], { encoding: "utf8" })
    assert.match(mode, /-rwxr-xr-x/)
  }
  for (const path of ["src/options.d.ts", "src/index.d.ts", "src/deferred.d.ts"]) {
    assert.deepEqual(archive(root, "vibelang-unplugin", path), readFileSync(join(repo, "packages/unplugin", path)))
  }
  const plugin = JSON.parse(archive(root, "vibelang", "dprint-plugin.json"))
  assert.equal(plugin.kind, "process")
  assert.equal(plugin.name, "dprint-plugin-vibelang")
  assert.equal(plugin.version, manifest.version)
  const dprintNames = { "darwin-arm64": "darwin-aarch64", "darwin-x64": "darwin-x86_64", "linux-arm64": "linux-aarch64", "linux-x64": "linux-x86_64", "win32-arm64": "windows-aarch64", "win32-x64": "windows-x86_64" }
  for (const platform of platforms) {
    const exe = platform.startsWith("win32") ? "vibelang.exe" : "vibelang"
    const tarball = readFileSync(join(root, "dist-npm/tarballs", `${platformPackage(platform).replace("@", "").replace("/", "-")}-${manifest.version}.tgz`))
    assert.deepEqual(plugin[dprintNames[platform]], {
      reference: `npm:${platformPackage(platform)}@${manifest.version}/bin/${exe}`,
      checksum: createHash("sha256").update(tarball).digest("hex")
    })
  }
  const launcherFiles = execFileSync("tar", ["-tzf", join(root, "dist-npm/tarballs", `vibelang-${manifest.version}.tgz`)], { encoding: "utf8" })
  assert.doesNotMatch(launcherFiles, /package\/native\//)
  assert.deepEqual(archive(root, "vibelang", "editor/vibelang.vsix"), readFileSync(join(root, "editors/vscode/vibelang.vsix")))
  const app = JSON.parse(archive(root, "create-vibelang", "template/package.json"))
  assert.equal(app.dependencies["vibelang-runtime"], manifest.version)
  assert.equal(app.devDependencies.vibelang, manifest.version)
  assert.equal(app.devDependencies["vibelang-vite"], manifest.version)
  assert.ok(archive(root, "create-vibelang", "template/gitignore").length)
  assert.ok(archive(root, "create-vibelang", "template/gitattributes").length)
  for (const name of ["vibelang", ...platforms.map(p => platformPackage(p))]) {
    const notice = archive(root, name, "NOTICE").toString()
    const own = notice.slice(0, notice.indexOf("NOTICES AND INFORMATION"))
    assert.match(own, /microsoft\/TypeScript/, name + ": name the repository that owns the upstream commit")
    assert.doesNotMatch(own, /typescript-go/, name + ": the upstream commit is from the unified TypeScript repository")
  }
  for (const name of ["vibelang-runtime", "vibelang-vite", "vibelang-unplugin", "create-vibelang"]) {
    const license = archive(root, name, "LICENSE").toString()
    assert.equal(license.split("\n")[0], "MIT License", name + ": LICENSE must start at the MIT heading")
    assert.equal(createHash("sha256").update(license).digest("hex"), "812b2af11bfeb9214e0428f91357a87316996b779e32c58b19319a59af38e1e9", name + ": unchanged standard MIT text")
    assert.doesNotMatch(license, /VibeLang is licensed under/)
  }
})

test("reports inconsistent versions, pins and missing binaries together before replacing release artifacts", (t) => {
  const root = fixture(t)
  const runtimePath = join(root, "packages/runtime/package.json")
  const runtime = json(runtimePath)
  runtime.version = "99.0.0"
  writeFileSync(runtimePath, JSON.stringify(runtime))
  const compilerPath = join(root, "packages/compiler/package.json")
  const compiler = json(compilerPath)
  compiler.optionalDependencies["vibelang-linux-x64"] = "99.0.0"
  delete compiler.optionalDependencies["@vibelang/cli-win32-x64"]
  writeFileSync(compilerPath, JSON.stringify(compiler))
  rmSync(join(root, "dist-npm/bin/darwin-arm64"), { recursive: true })
  mkdirSync(join(root, "dist-npm/tarballs"))
  const previous = join(root, "dist-npm/tarballs/manifest.json")
  writeFileSync(previous, "previous release")
  const result = assemble(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /vibelang-runtime: version 99\.0\.0/)
  assert.match(result.stderr, /optionalDependencies must list exactly/)
  assert.match(result.stderr, /vibelang-linux-x64 pinned to 99\.0\.0/)
  assert.match(result.stderr, /missing dist-npm\/bin\/darwin-arm64/)
  assert.equal(readFileSync(previous, "utf8"), "previous release")
})

for (const missing of ["editors/vscode/vibelang.vsix", "packages/runtime/dist/index.js"]) {
  test(`--skip-build refuses a missing ${missing} before replacing release artifacts`, (t) => {
    const root = fixture(t)
    rmSync(join(root, missing))
    const result = assemble(root)
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes(missing), result.stderr)
    assert.match(result.stderr, /run without --skip-build/)
    assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
  })
}

test("refuses stale install docs before replacing release artifacts", (t) => {
  const root = fixture(t)
  const page = join(root, "docs/user/src/setup.md")
  mkdirSync(dirname(page), { recursive: true })
  writeFileSync(page, "Install vibelang@0.0.0")
  const result = assemble(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /docs\/user\/src\/setup.md: stale VibeLang version/)
  assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
})

test("all release packages and the starter declare the Node 22.22.3 floor", () => {
  for (const path of [...["compiler", "runtime", "vite", "unplugin", "create-vibelang"].map(name => "packages/" + name + "/package.json"), "templates/app/package.json"]) {
    assert.equal(json(join(repo, path)).engines?.node, "^22.22.3 || >=24.11.1", path)
  }
})

for (const name of ["compiler", "runtime", "vite", "unplugin", "create-vibelang"]) {
  test("refuses a drifting Node engine in " + name + " before replacing release artifacts", (t) => {
    const root = fixture(t)
    const path = join(root, "packages", name, "package.json")
    const pkg = json(path)
    pkg.engines = { ...pkg.engines, node: ">=20" }
    writeFileSync(path, JSON.stringify(pkg))
    const result = assemble(root)
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes("expected ^22.22.3 || >=24.11.1"), result.stderr)
    assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
  })
}

test("package READMEs teach the Node 22.22.3 floor", () => {
  for (const name of ["compiler", "runtime", "vite", "unplugin", "create-vibelang"]) {
    const readme = readFileSync(join(repo, "packages", name, "README.md"), "utf8")
    assert.doesNotMatch(readme, /Node 26 or later/, name)
    assert.match(readme, /Node 22\.22\.3(?:\s|\.)/, name)
  }
})

test("the root license starts with standard MIT text", () => {
  assert.ok(readFileSync(join(repo, "LICENSE"), "utf8").startsWith("MIT License\n"))
})

test("packs only MIT text when the root license is MIT first with trailing exceptions", { timeout: 120_000 }, (t) => {
  const root = fixture(t)
  const source = readFileSync(join(root, "LICENSE"), "utf8")
  const start = source.indexOf("MIT License\n")
  const end = source.indexOf("\nSOFTWARE.", start) + "\nSOFTWARE.".length
  const mit = source.slice(start, end) + "\n"
  writeFileSync(join(root, "LICENSE"), mit + "\nCompiler exceptions: see typescript/LICENSE.txt.\n")
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  for (const name of ["vibelang-runtime", "vibelang-vite", "vibelang-unplugin", "create-vibelang"]) {
    assert.equal(archive(root, name, "LICENSE").toString(), mit)
  }
})

test("refuses a missing or drifting transitive Effect override before packing", (t) => {
  for (const pin of [undefined, "0.0.0"]) {
    const root = fixture(t)
    const path = join(root, "templates/app/package.json")
    const app = json(path)
    app.overrides = { "@effect/platform-node-shared": pin }
    writeFileSync(path, JSON.stringify(app))
    const result = assemble(root)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /@effect\/platform-node-shared override must match effect/)
    assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
  }
})
