// Local release assembly only: npm pack runs, npm publish never does.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { crc32 } from "node:zlib"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const platformPackage = (platform) => platform.startsWith("win32-") ? `@smthrs/cli-${platform}` : `vibelang-${platform}`
const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]
const json = (file) => JSON.parse(readFileSync(file, "utf8"))
// The compiler package's own files; make-packages writes the others.
const compilerSources = json(join(repo, "packages/compiler/package.json")).files
  .filter((file) => !["editor", "dprint-plugin.json", "README.md", "LICENSE", "NOTICE"].includes(file))
  .map((file) => `packages/compiler/${file}`)
// A stored zip whose entries carry one modification time, in the DOS header
// fields and in an extended-timestamp field, the way vsce writes a VSIX.
const vsixFiles = { "extension.vsixmanifest": "<PackageManifest/>\n", "extension/readme.md": "# VibeLang\n" }
function zipAt(when, files) {
  const dosTime = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1)
  const dosDate = ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate()
  const stamp = Buffer.alloc(9)
  stamp.writeUInt16LE(0x5455, 0); stamp.writeUInt16LE(5, 2); stamp.writeUInt8(1, 4); stamp.writeUInt32LE(Math.floor(when.getTime() / 1000), 5)
  const locals = [], centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), path = Buffer.from(name)
    const fields = (header) => {
      header.writeUInt16LE(dosTime, 0); header.writeUInt16LE(dosDate, 2); header.writeUInt32LE(crc32(data), 4)
      header.writeUInt32LE(data.length, 8); header.writeUInt32LE(data.length, 12); header.writeUInt16LE(path.length, 16); header.writeUInt16LE(stamp.length, 18)
      return header
    }
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0]), fields(Buffer.alloc(20)), path, stamp, data])
    const tail = Buffer.alloc(14); tail.writeUInt32LE(offset, 10)
    centrals.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0]), fields(Buffer.alloc(20)), tail, path, stamp]))
    locals.push(local)
    offset += local.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length, 8); end.writeUInt16LE(centrals.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-release-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const path of ["scripts/release/make-packages.mjs", "scripts/release/zip-times.mjs", "docs/tools/release-docs.mjs", "LICENSE", "typescript/LICENSE.txt", "typescript/NOTICE.txt", "typescript/tsc/internal/vibelang/identity.go",
    ...["compiler", "runtime", "vite", "create-vibelang", "unplugin", "typescript-shim"].flatMap((name) => [`packages/${name}/package.json`, `packages/${name}/README.md`]),
    ...["bin", "lib", "launcher.mjs", "tsc"].map((name) => `packages/typescript-shim/${name}`),
    ...compilerSources, "editors/tree-sitter-vibelang/tree-sitter.json",
    ...json(join(repo, "editors/tree-sitter-vibelang/tree-sitter.json")).grammars.map(grammar => join("editors/tree-sitter-vibelang", grammar.path ?? ".", "src")), "packages/vite/src", "packages/create-vibelang/bin", "packages/unplugin/src", "templates/app"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    cpSync(join(repo, path), join(root, path), { recursive: true, filter: (file) => !["node_modules", "dist", ".prototype"].includes(file.split("/").at(-1)) })
  }
  for (const path of ["packages/runtime/dist/index.js", "packages/runtime/dist/index.d.ts", "packages/runtime/dist/kernel/kernel.js"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), `fixture ${path}\n`)
  }
  mkdirSync(join(root, "editors/vscode"), { recursive: true })
  writeFileSync(join(root, "editors/vscode/vibelang.vsix"), zipAt(new Date("2026-11-08T05:04:40Z"), vsixFiles))
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
  const { file } = json(join(root, "dist-npm/tarballs/manifest.json")).packages.find((pkg) => pkg.name === name)
  return execFileSync("tar", ["-xOzf", join(root, "dist-npm/tarballs", file), `package/${path}`], { maxBuffer: 64 * 1024 * 1024 })
}

test("packs every file the compiler package lists and every target its exports name", { timeout: 120_000 }, (t) => {
  const root = fixture(t)
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  const compiler = json(join(root, "packages/compiler/package.json"))
  assert.deepEqual(archive(root, "vibelang", "tree-sitter/src/scanner.c"), readFileSync(join(repo, "editors/tree-sitter-vibelang/src/scanner.c")))
  assert.ok(archive(root, "vibelang", "tree-sitter/src/parser.c").length > 1000)
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
  const names = [...platforms.map((p) => platformPackage(p)), "vibelang", "vibelang-runtime", "vibelang-vite", "create-vibelang", "vibelang-unplugin", "vibelang-typescript"]
  assert.deepEqual(manifest.packages.map((p) => p.name), names)
  for (const pkg of manifest.packages) {
    assert.equal(pkg.version, pkg.name === "vibelang-typescript" ? json(join(repo, "packages/typescript-shim/package.json")).version : manifest.version)
    assert.equal(readFileSync(join(root, "dist-npm/tarballs", pkg.file)).length, pkg.size)
    assert.ok(pkg.files > 0)
    const packed = JSON.parse(archive(root, pkg.name, "package.json"))
    assert.equal(packed.name, pkg.name)
    assert.equal(packed.version, pkg.version)
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
  const compilerPeer = JSON.parse(archive(root, "vibelang", "package.json")).peerDependencies
  assert.equal(compilerPeer?.effect, json(join(root, "packages/runtime/package.json")).peerDependencies.effect,
    "VIP-32: the packed compiler requires the runtime's exact Effect version")
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
  assert.deepEqual(unzipped(root, archive(root, "vibelang", "editor/vibelang.vsix")), vsixFiles)
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

function unzipped(root, vsix) {
  const file = join(root, "packed.vsix")
  writeFileSync(file, vsix)
  return Object.fromEntries(Object.keys(vsixFiles).map((name) => [name, execFileSync("unzip", ["-p", file, name], { encoding: "utf8" })]))
}

test("packs the same vibelang tarball when only the VS Code extension's packaging time differs", { timeout: 240_000 }, (t) => {
  const hashes = []
  for (const when of ["2026-11-08T05:04:40Z", "2026-11-08T05:16:08Z"]) {
    const root = fixture(t)
    writeFileSync(join(root, "editors/vscode/vibelang.vsix"), zipAt(new Date(when), vsixFiles))
    const result = assemble(root)
    assert.equal(result.status, 0, result.stderr)
    const { file } = json(join(root, "dist-npm/tarballs/manifest.json")).packages.find((pkg) => pkg.name === "vibelang")
    hashes.push(createHash("sha256").update(readFileSync(join(root, "dist-npm/tarballs", file))).digest("hex"))
    assert.deepEqual(unzipped(root, archive(root, "vibelang", "editor/vibelang.vsix")), vsixFiles)
  }
  assert.equal(hashes[0], hashes[1])
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
  delete compiler.optionalDependencies["@smthrs/cli-win32-x64"]
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

test("release assembly includes every registered grammar and its manifest", { timeout: 120_000 }, t => {
  const root = fixture(t)
  const grammarRoot = join(root, "editors/tree-sitter-vibelang")
  const manifest = json(join(grammarRoot, "tree-sitter.json"))
  manifest.grammars.push({ name: "extra", path: "extra", "file-types": ["extra"] })
  writeFileSync(join(grammarRoot, "tree-sitter.json"), JSON.stringify(manifest))
  mkdirSync(join(grammarRoot, "extra/src"), { recursive: true })
  writeFileSync(join(grammarRoot, "extra/src/parser.c"), "int tree_sitter_extra(void) { return 1; }")
  writeFileSync(join(grammarRoot, "extra/src/scanner.c"), "int extra_scan(void) { return 1; }")
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(archive(root, "vibelang", "tree-sitter/tree-sitter.json")), manifest)
  assert.equal(archive(root, "vibelang", "tree-sitter/extra/src/parser.c").toString(), "int tree_sitter_extra(void) { return 1; }")
  const unpacked = join(root, "unpacked")
  mkdirSync(unpacked)
  const version = json(join(root, "packages/compiler/package.json")).version
  execFileSync("tar", ["-xzf", join(root, "dist-npm/tarballs", `vibelang-${version}.tgz`), "-C", unpacked])
  const library = join(root, "parser.so")
  const build = spawnSync(process.execPath, [join(unpacked, "package/bin/vibelang-ast-grep"), library], { encoding: "utf8" })
  if (process.platform === "win32") {
    assert.equal(build.status, 1)
    assert.match(build.stderr, /WSL/)
    return
  }
  assert.equal(build.status, 0, build.stderr)
  const symbols = execFileSync("nm", ["-g", library], { encoding: "utf8" })
  assert.ok(symbols.includes("tree_sitter_vibe"), symbols)
  assert.ok(symbols.includes("tree_sitter_extra"), symbols)
})
