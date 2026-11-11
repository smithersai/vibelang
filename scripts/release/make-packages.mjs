#!/usr/bin/env node
// make-packages assembles VibeLang's twelve npm packages under dist-npm/pkg/ and
// packs them into dist-npm/tarballs/, with manifest.json listing the tarballs
// in publish order. Run scripts/release/build-binaries.sh first.
//
//   node scripts/release/make-packages.mjs [--skip-build] [--rehearsal]
//
// --skip-build reuses packages/runtime/dist and editors/vscode/vibelang.vsix.
// The script fails unless every package version equals the compiler's own
// version (typescript/tsc/internal/vibelang/identity.go) and every pin agrees.
//
// The tarballs must come from one commit. The script fails unless the tree
// has no uncommitted change, every build receipt in dist-npm/bin/ records
// exit 0, and the binaries were built from the checkout's revision, which
// manifest.json then records. Packages are staged from the files that
// revision tracks, so untracked and ignored files never ship. --rehearsal
// accepts a changed tree and binaries from another revision. publish.sh
// refuses tarballs assembled with --rehearsal or --skip-build.
import { releaseDocsProblems, typescriptShimPatch } from "../../docs/tools/release-docs.mjs"
import { readRecord, sourceRevision, trackedFiles } from "./revision.mjs"
import { zipFixedTimes } from "./zip-times.mjs"
import { isTemplateFile } from "../template-files.mjs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const out = join(root, "dist-npm")
const staging = join(out, "pkg")
const tarballs = join(out, "tarballs")
const skipBuild = process.argv.includes("--skip-build")
const rehearsal = process.argv.includes("--rehearsal")
const platformPackage = (platform) => platform.startsWith("win32-") ? `@smthrs/cli-${platform}` : `vibelang-${platform}`
const platforms = {
  "darwin-arm64": ["darwin", "arm64"],
  "darwin-x64": ["darwin", "x64"],
  "linux-arm64": ["linux", "arm64"],
  "linux-x64": ["linux", "x64"],
  "win32-arm64": ["win32", "arm64"],
  "win32-x64": ["win32", "x64"]
}

// dprint's name for each platform, for the .vibe formatter's plugin manifest (D276).
const dprintPlatforms = {
  "darwin-arm64": "darwin-aarch64",
  "darwin-x64": "darwin-x86_64",
  "linux-arm64": "linux-aarch64",
  "linux-x64": "linux-x86_64",
  "win32-arm64": "windows-aarch64",
  "win32-x64": "windows-x86_64"
}

const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"))
const compiler = readJson("packages/compiler/package.json")
const runtime = readJson("packages/runtime/package.json")
const vite = readJson("packages/vite/package.json")
const unplugin = readJson("packages/unplugin/package.json")
const create = readJson("packages/create-vibelang/package.json")
const typescriptShim = readJson("packages/typescript-shim/package.json")
const template = readJson("templates/app/package.json")
const identity = readFileSync(join(root, "typescript/tsc/internal/vibelang/identity.go"), "utf8")
const version = /const Version = "([^"]+)"/.exec(identity)?.[1]

// Its major and minor are the TypeScript the compiler forks.
const typescriptShimVersion = () => typescriptShim.version.split(".").slice(0, 2).concat(typescriptShimPatch(version)).join(".")

const problems = releaseDocsProblems(root)
const nodeEngine = runtime.engines?.node
const expect = (ok, message) => { if (!ok) problems.push(message) }
expect(version, "identity.go: no Version constant")
for (const [name, pkg] of [["vibelang", compiler], ["vibelang-runtime", runtime], ["vibelang-vite", vite], ["vibelang-unplugin", unplugin], ["create-vibelang", create]]) {
  expect(pkg.name === name, `${name}: package.json names ${pkg.name}`)
  expect(pkg.engines?.node === nodeEngine && nodeEngine === "^22.22.3 || >=24.11.1", name + ": engines.node " + pkg.engines?.node + ", expected ^22.22.3 || >=24.11.1 (matching vibelang-runtime)")
  expect(pkg.version === version, `${name}: version ${pkg.version}, but the compiler is ${version}`)
}
expect(template.engines?.node === nodeEngine, "template: engines.node " + template.engines?.node + ", expected ^22.22.3 || >=24.11.1 (matching vibelang-runtime)")
const optional = compiler.optionalDependencies ?? {}
expect(JSON.stringify(Object.keys(optional).sort()) === JSON.stringify(Object.keys(platforms).map((p) => platformPackage(p)).sort()),
  `vibelang: optionalDependencies must list exactly ${Object.keys(platforms).join(", ")}`)
for (const [name, pin] of Object.entries(optional)) expect(pin === version, `vibelang: ${name} pinned to ${pin}, expected ${version}`)
expect(vite.peerDependencies?.vibelang === version, `vibelang-vite: peer vibelang ${vite.peerDependencies?.vibelang}, expected ${version}`)
expect(typescriptShim.dependencies?.vibelang === version, `vibelang-typescript: dependency vibelang ${typescriptShim.dependencies?.vibelang}, expected ${version}`)
expect(typescriptShim.version === typescriptShimVersion(), `vibelang-typescript: version ${typescriptShim.version}, expected ${typescriptShimVersion()}`)
expect(typescriptShim.engines?.node === nodeEngine, `vibelang-typescript: engines.node ${typescriptShim.engines?.node}, expected ${nodeEngine}`)
expect(unplugin.peerDependencies?.vibelang === version, `vibelang-unplugin: peer vibelang ${unplugin.peerDependencies?.vibelang}, expected ${version}`)
const effect = runtime.peerDependencies?.effect
expect(typeof effect === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(effect),
  "vibelang-runtime: effect peer must be an exact version")
expect(compiler.peerDependencies?.effect === effect,
  "vibelang: effect peer must match the runtime's exact pin " + effect)
expect(compiler.peerDependenciesMeta?.effect?.optional !== true,
  "vibelang: effect peer must be required")
expect(template.dependencies?.effect === effect, `template: effect ${template.dependencies?.effect}, but the runtime requires ${effect}`)
expect(template.dependencies?.["@effect/platform-node"] === effect, `template: @effect/platform-node must match effect ${effect}`)
expect(template.devDependencies?.["@effect/vitest"] === effect, `template: @effect/vitest must match effect ${effect}`)
expect(template.overrides?.["@effect/platform-node-shared"] === effect, `template: @effect/platform-node-shared override must match effect ${effect}`)
// The checkout's revision, the one build-binaries.sh recorded, and each
// target's receipt must agree: a binary an earlier run left behind has the
// same version as this one.
let source
try {
  source = sourceRevision(root)
} catch (error) {
  problems.push(error.message)
}
expect(!source || source.clean || rehearsal, "the tree has changes that are not in a commit; commit them (--rehearsal assembles tarballs that publish.sh refuses)")
const built = readRecord(join(out, "bin", "revision"))
for (const [platform, [os]] of Object.entries(platforms)) {
  const binary = join(out, "bin", platform, os === "win32" ? "vibelang.exe" : "vibelang")
  const shown = binary.slice(root.length)
  expect(existsSync(binary), `missing ${shown}; run scripts/release/build-binaries.sh`)
  if (!existsSync(binary)) continue
  const receipt = readRecord(join(out, "bin", `${platform}.status`))
  expect(receipt?.exit === "0", receipt
    ? `dist-npm/bin/${platform}.status records exit ${receipt.exit}, so ${shown} is from an earlier build; run scripts/release/build-binaries.sh`
    : `no receipt dist-npm/bin/${platform}.status for ${shown}; run scripts/release/build-binaries.sh`)
  expect(!built?.revision || readFileSync(binary).includes(built.revision),
    `${shown} does not carry revision ${built?.revision}, which dist-npm/bin/revision records; run scripts/release/build-binaries.sh`)
}
expect(built?.revision, "no dist-npm/bin/revision, so nothing says which commit the binaries are from; run scripts/release/build-binaries.sh")
if (built?.revision && !rehearsal) {
  expect(built.clean === "true", "the binaries were built from a tree with uncommitted changes; commit them and run scripts/release/build-binaries.sh")
  expect(!source || built.revision === source.revision, `the binaries were built from revision ${built.revision}, but this checkout is ${source?.revision}; run scripts/release/build-binaries.sh`)
}
if (problems.length) {
  console.error(`make-packages: ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}`)
  process.exit(1)
}

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: ["ignore", "inherit", "inherit"] })
if (!skipBuild) {
  console.log("make-packages: build the runtime")
  // tsc never deletes the output of a source that is gone.
  rmSync(join(root, "packages/runtime/dist"), { recursive: true, force: true })
  run("bun", ["install", "--frozen-lockfile"], join(root, "packages/runtime"))
  run("bun", ["run", "build"], join(root, "packages/runtime"))
  console.log("make-packages: build the VS Code extension")
  rmSync(join(root, "editors/vscode/vibelang.vsix"), { force: true })
  run("bun", ["install", "--frozen-lockfile"], join(root, "editors/vscode"))
  run("bun", ["run", "package"], join(root, "editors/vscode"))
}
const vsix = join(root, "editors/vscode/vibelang.vsix")
for (const file of [vsix, join(root, "packages/runtime/dist/index.js")]) {
  if (!existsSync(file)) {
    console.error(`make-packages: missing ${file.slice(root.length)}; run without --skip-build`)
    process.exit(1)
  }
}

rmSync(staging, { recursive: true, force: true })
rmSync(tarballs, { recursive: true, force: true })
mkdirSync(tarballs, { recursive: true })

const rootLicense = readFileSync(join(root, "LICENSE"), "utf8")
// Extract the standard MIT grant without the repository's trailing exceptions.
// Accept either heading position so older release checkouts remain readable.
const mit = /^MIT License\r?\n[\s\S]*?^SOFTWARE\.\r?(?:\n|$)/m.exec(rootLicense)?.[0]
if (!mit) throw new Error("LICENSE: missing standard MIT License text")
const apache = readFileSync(join(root, "typescript/LICENSE.txt"), "utf8")
const notice = `VibeLang
Copyright (c) 2026 the VibeLang authors

The VibeLang compiler is a modified version of the TypeScript compiler
(microsoft/TypeScript), Copyright (c) Microsoft Corporation, licensed under the
Apache License 2.0. VibeLang's changes are licensed under the same license.
The TypeScript notices follow.

${readFileSync(join(root, "typescript/NOTICE.txt"), "utf8")}`
const warning = "> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use."

// copyTracked copies a tracked file, or the tracked files of a directory, and
// nothing else found there: an untracked or ignored file never reaches a package.
const tracked = trackedFiles(root)
function copyTracked(from, to, keep = () => true) {
  const files = tracked.filter((file) => file === from || (file.startsWith(`${from}/`) && keep(file.slice(from.length + 1))))
  if (!files.length) throw new Error(`make-packages: ${from} has no tracked files`)
  for (const file of files) {
    const target = join(to, file.slice(from.length))
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(root, file), target)
  }
}

function stage(name, sources, files) {
  const dir = join(staging, name)
  mkdirSync(dir, { recursive: true })
  for (const [from, to] of sources) copyTracked(join(from), join(dir, to ?? basename(from)))
  for (const [to, text] of Object.entries(files)) writeFileSync(join(dir, to), text)
  return dir
}

const order = []
for (const [platform, [os, cpu]] of Object.entries(platforms)) {
  const exe = os === "win32" ? "vibelang.exe" : "vibelang"
  const name = platformPackage(platform)
  const dir = stage(name, [], {
    "package.json": JSON.stringify({
      name,
      version,
      description: `The native VibeLang compiler for ${os} on ${cpu}. Install vibelang instead; it selects this package.`,
      homepage: compiler.homepage,
      bugs: compiler.bugs,
      repository: compiler.repository,
      license: "Apache-2.0",
      os: [os],
      cpu: [cpu],
      files: ["bin", "README.md", "LICENSE", "NOTICE"],
      preferUnplugged: true
    }, null, 2) + "\n",
    "README.md": `# ${name}\n\n${warning}\n\nThe native VibeLang compiler for ${os} on ${cpu}. Install [\`vibelang\`](https://www.npmjs.com/package/vibelang) instead: it lists this package as an optional dependency, and npm installs the one that matches your platform.\n`,
    "LICENSE": apache,
    "NOTICE": notice
  })
  mkdirSync(join(dir, "bin"))
  copyFileSync(join(out, "bin", platform, exe), join(dir, "bin", exe))
  chmodSync(join(dir, "bin", exe), 0o755)
  order.push({ name, dir, required: [`bin/${exe}`, "LICENSE", "NOTICE"], executable: `bin/${exe}` })
}

// Every file the compiler package lists, except the ones this script writes.
const compilerFiles = compiler.files.filter((file) => !["editor", "dprint-plugin.json", "LICENSE", "NOTICE"].includes(file))
const grammarRoot = "editors/tree-sitter-vibelang"
const grammarManifest = readJson(`${grammarRoot}/tree-sitter.json`)
const grammarSources = grammarManifest.grammars.map(grammar => [
  join(grammarRoot, grammar.path ?? ".", "src"),
  join("tree-sitter", grammar.path ?? ".", "src")
])
const vibelangDir = stage("vibelang", [...compilerFiles.map((file) => [`packages/compiler/${file}`, file]), ["packages/compiler/package.json"],
  [`${grammarRoot}/tree-sitter.json`, "tree-sitter/tree-sitter.json"], ...grammarSources], { LICENSE: apache, NOTICE: notice })
const stagedCompiler = JSON.parse(readFileSync(join(vibelangDir, "package.json"), "utf8"))
stagedCompiler.files.push("tree-sitter")
writeFileSync(join(vibelangDir, "package.json"), JSON.stringify(stagedCompiler, null, 2) + "\n")
mkdirSync(join(vibelangDir, "editor"))
// vsce stamps each entry with the packaging time; a fixed time keeps vibelang reproducible.
writeFileSync(join(vibelangDir, "editor", "vibelang.vsix"), zipFixedTimes(readFileSync(vsix)))
order.push({
  name: "vibelang",
  dir: vibelangDir,
  required: [...compilerFiles.filter((file) => file !== "bin"), "bin/vibelang", "editor/vibelang.vsix", "dprint-plugin.json", "LICENSE", "NOTICE"],
  forbidden: /^native\//
})

order.push({
  name: "vibelang-runtime",
  dir: stage("vibelang-runtime", [["packages/runtime/README.md"], ["packages/runtime/package.json"]], { LICENSE: mit }),
  required: ["dist/index.js", "dist/index.d.ts", "dist/kernel/kernel.js", "LICENSE"]
})
// The runtime's dist is build output, which no revision tracks.
cpSync(join(root, "packages/runtime/dist"), join(staging, "vibelang-runtime/dist"), { recursive: true })
order.push({
  name: "vibelang-vite",
  dir: stage("vibelang-vite", [["packages/vite/src", "src"], ["packages/vite/README.md"], ["packages/vite/package.json"]], { LICENSE: mit }),
  required: ["src/index.js", "src/index.d.ts", "LICENSE"]
})

const createDir = stage("create-vibelang", [["packages/create-vibelang/bin", "bin"], ["packages/create-vibelang/README.md"], ["packages/create-vibelang/package.json"]], { LICENSE: mit })
copyTracked("templates/app", join(createDir, "template"), isTemplateFile)
// npm drops .gitignore from packages; create-vibelang restores the dot.
for (const name of [".gitignore", ".gitattributes"]) renameSync(join(createDir, "template", name), join(createDir, "template", name.slice(1)))
const appManifest = JSON.parse(readFileSync(join(createDir, "template/package.json"), "utf8"))
appManifest.dependencies["vibelang-runtime"] = version
appManifest.devDependencies.vibelang = version
appManifest.devDependencies["vibelang-vite"] = version
writeFileSync(join(createDir, "template/package.json"), JSON.stringify(appManifest, null, 2) + "\n")
order.push({
  name: "create-vibelang",
  dir: createDir,
  required: ["bin/create-vibelang.mjs", "template/package.json", "template/gitignore", "template/gitattributes", "template/src/main.vibe", "template/AGENTS.md", "LICENSE"]
})

order.push({
  name: "vibelang-unplugin",
  dir: stage("vibelang-unplugin", [["packages/unplugin/src", "src"], ["packages/unplugin/README.md"], ["packages/unplugin/package.json"]], { LICENSE: mit }),
  required: ["src/index.js", "src/index.d.ts", "src/webpack.js", "src/rspack.js", "src/rollup.js", "src/rolldown.js", "src/esbuild.js", "src/bun.js", "src/vite.js", "LICENSE"]
})

order.push({
  name: "vibelang-typescript",
  version: typescriptShim.version,
  dir: stage("vibelang-typescript", [["packages/typescript-shim/bin", "bin"], ["packages/typescript-shim/lib", "lib"], ["packages/typescript-shim/launcher.mjs"], ["packages/typescript-shim/tsc"], ["packages/typescript-shim/README.md"], ["packages/typescript-shim/package.json"]], { LICENSE: apache }),
  required: ["bin/tsc", "lib/tsc", "lib/version.cjs", "launcher.mjs", "tsc", "LICENSE"],
  executable: "bin/tsc"
})

// writeDprintPlugin writes vibelang's dprint plugin manifest, which dprint names
// npm:vibelang/dprint-plugin.json: each platform's compiler is the plugin's
// executable, fetched from its platform package and checked against the
// checksum of the tarball packed above (D276).
function writeDprintPlugin(dir, packed) {
  const plugin = { schemaVersion: 2, kind: "process", name: "dprint-plugin-vibelang", version }
  for (const [platform, [os]] of Object.entries(platforms)) {
    const tarball = packed.find((p) => p.name === platformPackage(platform))
    const exe = os === "win32" ? "vibelang.exe" : "vibelang"
    const checksum = createHash("sha256").update(readFileSync(join(tarballs, tarball.file))).digest("hex")
    plugin[dprintPlatforms[platform]] = { reference: `npm:${platformPackage(platform)}@${version}/bin/${exe}`, checksum }
  }
  writeFileSync(join(dir, "dprint-plugin.json"), JSON.stringify(plugin, null, 2) + "\n")
}

const manifest = []
for (const entry of order) {
  if (entry.name === "vibelang") writeDprintPlugin(entry.dir, manifest)
  const [packed] = JSON.parse(execFileSync("npm", ["pack", entry.dir, "--pack-destination", tarballs, "--json", "--silent"], { encoding: "utf8" }))
  const paths = new Map(packed.files.map((file) => [file.path, file]))
  for (const required of entry.required) {
    if (!paths.has(required)) problems.push(`${entry.name}: tarball lacks ${required}`)
  }
  if (entry.forbidden) for (const path of paths.keys()) if (entry.forbidden.test(path)) problems.push(`${entry.name}: tarball includes ${path}`)
  if (entry.executable && (paths.get(entry.executable)?.mode & 0o111) === 0) problems.push(`${entry.name}: ${entry.executable} is not executable`)
  if (packed.name !== entry.name || packed.version !== (entry.version ?? version)) problems.push(`${entry.name}: packed as ${packed.name}@${packed.version}`)
  manifest.push({ name: packed.name, version: packed.version, file: packed.filename, size: packed.size, unpackedSize: packed.unpackedSize, files: packed.files.length })
}
if (problems.length) {
  console.error(`make-packages: ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}`)
  process.exit(1)
}
const rehearsalOnly = [skipBuild && "--skip-build", rehearsal && "--rehearsal"].filter(Boolean)
writeFileSync(join(tarballs, "manifest.json"), JSON.stringify({
  version, revision: source.revision, clean: source.clean, ...(rehearsalOnly.length ? { rehearsalOnly } : {}), packages: manifest
}, null, 2) + "\n")

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
console.log(`\nmake-packages: ${manifest.length} tarballs for ${version} at revision ${source.revision} in dist-npm/tarballs/, in publish order:`)
for (const p of manifest) console.log(`  ${p.name.padEnd(22)} ${mb(p.size).padStart(9)} packed  ${mb(p.unpackedSize).padStart(9)} unpacked  ${String(p.files).padStart(3)} files`)
