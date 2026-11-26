// A toolchain is one VibeLang build staged for targets to install: the native
// compiler, npm tarballs of vibelang (with that compiler inside),
// vibelang-runtime, vibelang-vite and vibelang-unplugin, and a TypeScript compiler API for
// reading declarations. Staging it from a checkout lets a run use the
// compiler on main before it is published; a published version needs no
// staging (setup takes --vibelang-version instead).
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { accessSync, chmodSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { must, quote, readJson, writeJson } from "./util.mjs"

async function pack(dir, out) {
  const { stdout } = await must(`npm pack --silent --pack-destination ${quote(out)}`, { cwd: dir })
  const name = stdout.trim().split("\n").at(-1).trim()
  if (!existsSync(join(out, name))) throw new Error(`npm pack in ${dir} printed ${name}, which is not in ${out}`)
  return join(out, name)
}

/**
 * The license files each package ships, as scripts/release/make-packages.mjs
 * writes them: MIT for the runtime and the plugin, from the repository's
 * LICENSE; Apache 2.0 and a NOTICE for the compiler, which is a modified
 * TypeScript. A target's license tooling, such as a bundle's third-party
 * notices, needs them.
 */
export function licenseFiles(repo) {
  const mit = /^MIT License\r?\n[\s\S]*?^SOFTWARE\.\r?(?:\n|$)/m.exec(readFileSync(join(repo, "LICENSE"), "utf8"))?.[0]
  if (!mit) throw new Error(`${join(repo, "LICENSE")}: missing standard MIT License text`)
  const notice = `VibeLang
Copyright (c) 2026 the VibeLang authors

The VibeLang compiler is a modified version of the TypeScript compiler
(microsoft/TypeScript), Copyright (c) Microsoft Corporation, licensed under the
Apache License 2.0. VibeLang's changes are licensed under the same license.
The TypeScript notices follow.

${readFileSync(join(repo, "typescript/NOTICE.txt"), "utf8")}`
  return { mit: { LICENSE: mit }, compiler: { LICENSE: readFileSync(join(repo, "typescript/LICENSE.txt"), "utf8"), NOTICE: notice } }
}

// Packs a copy of a package directory with its license files added.
async function packWith(dir, files, out) {
  const staging = mkdtempSync(join(tmpdir(), "vibelang-package-"))
  try {
    cpSync(dir, staging, { recursive: true, filter: (src) => !/\/(?:node_modules|test|tests)(?:\/|$)/.test(src.slice(dir.length)) })
    for (const [name, text] of Object.entries(files)) writeFileSync(join(staging, name), text)
    return await pack(staging, out)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Stages the toolchain of a built VibeLang checkout (sh scripts/build-vibelang.sh, then bun run build in packages/runtime). */
export async function stageToolchain({ vibelang, out }) {
  const repo = resolve(vibelang)
  out = resolve(out)
  const binary = join(repo, "packages/compiler/native/vibelang")
  if (!existsSync(binary)) throw new Error(`${binary} is missing: run sh scripts/build-vibelang.sh in the checkout`)
  if (!existsSync(join(repo, "packages/runtime/dist/index.js"))) throw new Error("packages/runtime/dist is missing: run bun install && bun run build in packages/runtime")
  mkdirSync(join(out, "native"), { recursive: true })
  copyFileSync(binary, join(out, "native/vibelang"))
  chmodSync(join(out, "native/vibelang"), 0o755)

  const licenses = licenseFiles(repo)
  // The compiler package with its native binary beside its launcher, which looks there first.
  const staging = mkdtempSync(join(tmpdir(), "vibelang-compiler-"))
  let compilerTgz
  try {
    cpSync(join(repo, "packages/compiler"), staging, { recursive: true, filter: (src) => !/\/(?:node_modules|test)(?:\/|$)/.test(src.slice(repo.length)) })
    const manifest = readJson(join(staging, "package.json"))
    manifest.files = [...new Set([...(manifest.files ?? []), "native", "tree-sitter"])]
    cpSync(join(repo, "editors/tree-sitter-vibelang/src"), join(staging, "tree-sitter"), { recursive: true })
    delete manifest.optionalDependencies
    writeFileSync(join(staging, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
    rmSync(join(staging, "native"), { recursive: true, force: true })
    mkdirSync(join(staging, "native"))
    copyFileSync(binary, join(staging, "native/vibelang"))
    chmodSync(join(staging, "native/vibelang"), 0o755)
    execFileSync(binary, ["--write-dprint-plugin", staging], { stdio: "pipe" })
    for (const [name, text] of Object.entries(licenses.compiler)) writeFileSync(join(staging, name), text)
    compilerTgz = await pack(staging, out)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  const runtimeTgz = await packWith(join(repo, "packages/runtime"), licenses.mit, out)
  const viteTgz = await packWith(join(repo, "packages/vite"), licenses.mit, out)
  const unpluginTgz = await packWith(join(repo, "packages/unplugin"), licenses.mit, out)

  const typescript = join(repo, "packages/runtime/node_modules/typescript")
  if (!existsSync(join(typescript, "package.json"))) throw new Error(`${typescript} is missing: run bun install in packages/runtime`)
  cpSync(typescript, join(out, "node_modules/typescript"), { recursive: true })
  writeFileSync(join(out, "package.json"), "{\"private\":true}\n")

  const { stdout: commit } = await must("jj log -r @- --no-graph -T commit_id", { cwd: repo })
  const runtime = readJson(join(repo, "packages/runtime/package.json"))
  const toolchain = {
    version: readJson(join(repo, "packages/compiler/package.json")).version,
    commit: commit.trim(),
    effect: runtime.peerDependencies.effect,
    compiler: "native/vibelang",
    nativeSha256: fileDigest(join(out, "native/vibelang")),
    compilerArchiveSha256: fileDigest(compilerTgz),
    packages: {
      vibelang: compilerTgz.slice(out.length + 1),
      "vibelang-runtime": runtimeTgz.slice(out.length + 1),
      "vibelang-vite": viteTgz.slice(out.length + 1),
      "vibelang-unplugin": unpluginTgz.slice(out.length + 1)
    },
    typescript: readJson(join(typescript, "package.json")).version
  }
  const packedNative = execFileSync("tar", ["-xOzf", compilerTgz, "package/native/vibelang"], { maxBuffer: statSync(join(out, "native/vibelang")).size + 1024 })
  if (digest(packedNative) !== toolchain.nativeSha256) throw new Error("staging refused: packed and standalone native compilers differ")
  writeJson(join(out, "toolchain.json"), toolchain)
  return toolchain
}

/** Reads a staged toolchain: its compiler's absolute path, and its tarballs' names in dir. */
export function readToolchain(dir) {
  dir = resolve(dir)
  const t = readJson(join(dir, "toolchain.json"))
  const compiler = join(dir, t.compiler)
  if (t.nativeSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(t.nativeSha256) || fileDigest(compiler) !== t.nativeSha256)) {
    throw new Error("native compiler digest mismatch: restage the toolchain before migration")
  }
  if (t.compilerArchiveSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(t.compilerArchiveSha256) ||
      !t.packages?.vibelang || fileDigest(join(dir, t.packages.vibelang)) !== t.compilerArchiveSha256)) {
    throw new Error("compiler archive digest mismatch: restage the toolchain before migration")
  }
  return { ...t, dir, compiler }
}

const digest = bytes => createHash("sha256").update(bytes).digest("hex")
const fileDigest = file => digest(readFileSync(file))

/** The revision is an asserted producer label; the digest identifies its actual executable bytes. */
export function compilerArtifactOf(toolchain) {
  if (toolchain?.kind !== "staged") return null
  const staged = readToolchain(toolchain.dir)
  return { revision: staged.commit ?? null, nativeSha256: fileDigest(staged.compiler) }
}

/** Pin before conversion, then require the same artifact after restart and at every later phase. */
export function bindCompilerArtifact(config, paths, { resume = false } = {}) {
  const actual = compilerArtifactOf(config.toolchain)
  const expected = config.compilerArtifact
  if (!actual) {
    if (expected) throw new Error("migration compiler artifact changed: the pinned staged compiler is no longer selected; reconvert in a fresh run")
    return null
  }
  if (!expected && resume) throw new Error("migration has no compiler artifact receipt; reconvert in a fresh run")
  if (expected && (expected.revision !== actual.revision || expected.nativeSha256 !== actual.nativeSha256)) {
    throw new Error("migration compiler artifact changed: expected " + JSON.stringify(expected) + ", actual " + JSON.stringify(actual) + "; reconvert in a fresh run")
  }
  if (!expected) {
    config.compilerArtifact = actual
    writeJson(paths.config, config)
  }
  return actual
}

/**
 * The compiler each phase of a batch ran, as `{ revision, nativeDigest }`
 * (#370). convert and check are one receipt's artifact each; emit is the list
 * of its emission entries' artifacts, which must agree among themselves. A
 * phase with no receipt (undefined) is absent; null is an untracked compiler.
 */
export function phaseCompilers({ convert, check, emit } = {}) {
  const of = artifact => artifact ? { revision: artifact.revision ?? null, nativeDigest: artifact.nativeSha256 ?? artifact.nativeDigest } : null
  const phases = {}
  if (convert !== undefined) phases.convert = of(convert)
  if (check !== undefined) phases.check = of(check)
  if (emit?.length) {
    const distinct = [...new Map(emit.map(of).map(item => [JSON.stringify(item), item])).values()]
    if (distinct.length > 1) throw new Error("migration receipt mixes native compilers within emit: " + distinct.map(item => JSON.stringify(item)).join(" vs ") + "; reconvert in a fresh run")
    phases.emit = distinct[0]
  }
  return phases
}

/** The one compiler every phase ran, or a refusal naming the phases that disagree. */
export function assertPhasesAgree(phases) {
  const entries = Object.entries(phases)
  if (!entries.length) return null
  const [first, firstArtifact] = entries[0]
  for (const [phase, artifact] of entries.slice(1)) {
    if (JSON.stringify(artifact) !== JSON.stringify(firstArtifact)) {
      throw new Error("migration receipt mixes native compilers: " + first + " ran " + JSON.stringify(firstArtifact) + ", " + phase + " ran " + JSON.stringify(artifact) + "; a revision label cannot stand for different native bytes; reconvert in a fresh run")
    }
  }
  return firstArtifact
}

const nativeExecutable = process.platform === "win32" ? "vibelang.exe" : "vibelang"

function resolveInstalledNativeBinary(vibelangPackagePath) {
  const pkgDir = dirname(vibelangPackagePath)
  const local = join(pkgDir, "native", nativeExecutable)
  if (existsSync(local)) return local
  const target = `${process.platform}-${process.arch}`
  const name = process.platform === "win32" ? `@smthrs/cli-${target}` : `vibelang-${target}`
  try {
    const manifest = createRequire(vibelangPackagePath).resolve(`${name}/package.json`)
    const candidate = join(dirname(manifest), "bin", nativeExecutable)
    return existsSync(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

/**
 * Verifies that installed `vibelang` packages in `target` actually carry an
 * executable native compiler binary (and match `staged.nativeSha256` when a
 * staged toolchain is pinned), catching incomplete or stale restored
 * dependency caches before build/test execution (#167).
 */
export function verifyInstalledCompiler({ target, packages = [{ dir: "." }], toolchain, requirePackage = true } = {}) {
  const root = resolve(target)
  const expectedSha256 = toolchain?.kind === "staged" && existsSync(join(toolchain.dir, "toolchain.json"))
    ? readToolchain(toolchain.dir).nativeSha256 ?? null
    : null
  const dirs = [...new Set([".", ...packages.map(pkg => pkg.dir ?? ".")])]
  const checked = []
  const missing = []
  for (const dir of dirs) {
    const manifestPath = join(root, dir, "package.json")
    if (!existsSync(manifestPath)) continue
    let manifest
    try { manifest = readJson(manifestPath) } catch { continue }
    const spec = manifest.dependencies?.vibelang ?? manifest.devDependencies?.vibelang
    if (!spec) continue
    let vibelangPkg
    try { vibelangPkg = createRequire(manifestPath).resolve("vibelang/package.json") } catch { vibelangPkg = null }
    if (!vibelangPkg) {
      if (requirePackage) missing.push({ package: dir, spec, reason: "installed vibelang package is missing from node_modules" })
      continue
    }
    const installedVersion = readJson(vibelangPkg).version ?? null
    const binary = resolveInstalledNativeBinary(vibelangPkg)
    if (!binary) {
      missing.push({ package: dir, spec, vibelangPackage: vibelangPkg, version: installedVersion, reason: "installed vibelang package is missing its native compiler binary" })
      continue
    }
    let stats
    try { stats = statSync(binary) } catch { stats = null }
    if (!stats?.isFile() || stats.size === 0) {
      missing.push({ package: dir, spec, vibelangPackage: vibelangPkg, version: installedVersion, binary, reason: "installed native compiler binary is empty or not a regular file" })
      continue
    }
    if (process.platform !== "win32") {
      try { accessSync(binary, constants.X_OK) } catch {
        missing.push({ package: dir, spec, vibelangPackage: vibelangPkg, version: installedVersion, binary, reason: "installed native compiler binary is not executable" })
        continue
      }
    }
    const actualSha256 = fileDigest(binary)
    if (expectedSha256 && actualSha256 !== expectedSha256) {
      missing.push({ package: dir, spec, vibelangPackage: vibelangPkg, version: installedVersion, binary, expectedSha256, actualSha256, reason: "installed native compiler binary digest mismatch against staged toolchain" })
      continue
    }
    checked.push({ package: dir, spec, vibelangPackage: vibelangPkg, version: installedVersion, binary, nativeSha256: actualSha256 })
  }
  return { ok: missing.length === 0, expectedSha256, checked, missing }
}

/** Fails fast with a dependency-cache integrity error when any installed vibelang lacks its native compiler binary (#167). */
export function assertInstalledCompiler(options) {
  const receipt = verifyInstalledCompiler(options)
  if (!receipt.ok) {
    const details = receipt.missing.map(item => `${item.package}: ${item.reason}`).join("; ")
    throw new Error(`dependency cache integrity failure (not a compiler semantic failure): ${details}; refresh/reinstall dependencies without stale cache`)
  }
  return receipt
}
