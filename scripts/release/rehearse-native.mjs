#!/usr/bin/env node
// Cross-platform native release rehearsal for Linux, macOS, and Windows.
// Builds or consumes a freshly built native binary for the host OS/arch,
// stages local npm tarballs for the platform package, vibelang, vibelang-runtime,
// and vibelang-vite, scaffolds a real starter app via create-vibelang, installs,
// verifies the exact native binary bytes are resolved (never public npm), and
// runs build, start, test, lint, and format checks natively.
//
// Usage:
//   node scripts/release/rehearse-native.mjs --binary <path-to-vibelang-exe> [--with-bun]
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const isWin = process.platform === "win32"
const platform = `${process.platform}-${process.arch}`
const exeName = isWin ? "vibelang.exe" : "vibelang"
const platformPkgName = isWin ? `@smthrs/cli-${platform}` : `vibelang-${platform}`
const npmCmd = isWin ? "npm.cmd" : "npm"
const bunCmd = isWin ? "bun.exe" : "bun"

const args = process.argv.slice(2)
const binIndex = args.indexOf("--binary")
const binaryPath = resolve(
  binIndex >= 0 && args[binIndex + 1]
    ? args[binIndex + 1]
    : join(root, "packages/compiler/native", exeName)
)
const withBun = args.includes("--with-bun")

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, {
    encoding: "utf8",
    shell: isWin && /\.(?:cmd|bat)$/i.test(command),
    ...options,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  assert.equal(
    result.status,
    0,
    `${command} ${argv.join(" ")} failed (status=${result.status}, error=${result.error ?? "none"})`
  )
  return result.stdout ?? ""
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function packDir(dir, destDir) {
  const out = run(npmCmd, ["pack", "--pack-destination", destDir], { cwd: dir })
  const tgzName = out.trim().split(/\r?\n/).filter(Boolean).at(-1)
  assert.ok(tgzName && tgzName.endsWith(".tgz"), `npm pack in ${dir} did not print a .tgz filename: ${out}`)
  return join(destDir, tgzName)
}

assert.ok(existsSync(binaryPath), `native binary not found at ${binaryPath}`)
const compilerPkg = JSON.parse(readFileSync(join(root, "packages/compiler/package.json"), "utf8"))
const version = compilerPkg.version

// 1. Verify native binary executes and reports matching version.
const versionOutput = run(binaryPath, ["--version"]).trim()
assert.ok(
  versionOutput.startsWith(`VibeLang ${version} (`),
  `expected native binary to print "VibeLang ${version} (...)", got ${JSON.stringify(versionOutput)}`
)
const expectedBinarySha = sha256(binaryPath)
console.log(`rehearse-native: ${platform} binary verified (${versionOutput}, sha256:${expectedBinarySha.slice(0, 12)})`)

// 2. Stage packages cleanly into a scratch directory so no repo files are modified.
const scratch = mkdtempSync(join(tmpdir(), "vibelang-rehearse-native-"))
const keep = process.env.KEEP === "1"
try {
  const stage = join(scratch, "stage")
  const tarballs = join(scratch, "tarballs")
  mkdirSync(stage, { recursive: true })
  mkdirSync(tarballs, { recursive: true })

  // 2a. Native platform package
  const platDir = join(stage, "platform")
  mkdirSync(join(platDir, "bin"), { recursive: true })
  const stagedBin = join(platDir, "bin", exeName)
  copyFileSync(binaryPath, stagedBin)
  if (!isWin) chmodSync(stagedBin, 0o755)
  copyFileSync(join(root, "LICENSE"), join(platDir, "LICENSE"))
  writeFileSync(join(platDir, "package.json"), JSON.stringify({
    name: platformPkgName,
    version,
    description: `VibeLang native compiler for ${platform}`,
    license: "MIT",
    os: [process.platform],
    cpu: [process.arch],
    files: ["bin", "LICENSE"],
  }, null, 2))
  const platformTgz = packDir(platDir, tarballs)

  // 2b. Compiler package (with fresh dprint-plugin.json, without local native/ dir so optionalDependency is exercised!)
  const compDir = join(stage, "compiler")
  cpSync(join(root, "packages/compiler"), compDir, {
    recursive: true,
    filter: (p) => !/(?:^|[\\/])(?:native|node_modules|test)$/.test(p) && !p.endsWith(".zip"),
  })
  const dprintPlatformMap = {
    "darwin-arm64": "darwin-aarch64",
    "darwin-x64": "darwin-x86_64",
    "linux-arm64": "linux-aarch64",
    "linux-x64": "linux-x86_64",
    "win32-arm64": "windows-aarch64",
    "win32-x64": "windows-x86_64",
  }
  const dprintKey = dprintPlatformMap[platform]
  assert.ok(dprintKey, `unsupported dprint platform ${platform}`)
  writeFileSync(join(compDir, "dprint-plugin.json"), JSON.stringify({
    schemaVersion: 2,
    kind: "process",
    name: "dprint-plugin-vibelang",
    version,
    [dprintKey]: {
      reference: `npm:${platformPkgName}@${version}/bin/${exeName}`,
      checksum: sha256(platformTgz),
    },
  }, null, 2) + "\n")
  const compManifestPath = join(compDir, "package.json")
  const compManifest = JSON.parse(readFileSync(compManifestPath, "utf8"))
  compManifest.optionalDependencies = { [platformPkgName]: version }
  writeFileSync(compManifestPath, JSON.stringify(compManifest, null, 2))
  copyFileSync(join(root, "LICENSE"), join(compDir, "LICENSE"))
  const compilerTgz = packDir(compDir, tarballs)

  // 2c. Runtime package (must already have dist/ built)
  assert.ok(existsSync(join(root, "packages/runtime/dist/index.js")), "packages/runtime/dist/index.js is missing; build packages/runtime first")
  const rtDir = join(stage, "runtime")
  cpSync(join(root, "packages/runtime"), rtDir, {
    recursive: true,
    filter: (p) => !/(?:^|[\\/])(?:node_modules|tests)$/.test(p),
  })
  copyFileSync(join(root, "LICENSE"), join(rtDir, "LICENSE"))
  const runtimeTgz = packDir(rtDir, tarballs)

  // 2d. Vite plugin package
  const viteDir = join(stage, "vite")
  cpSync(join(root, "packages/vite"), viteDir, {
    recursive: true,
    filter: (p) => !/(?:^|[\\/])(?:node_modules|test)$/.test(p),
  })
  copyFileSync(join(root, "LICENSE"), join(viteDir, "LICENSE"))
  const viteTgz = packDir(viteDir, tarballs)

  // 3. Helper to scaffold and run end-to-end starter checks with a package manager.
  function runStarterApp(manager) {
    const appDir = join(scratch, `app-${manager}`)
    console.log(`rehearse-native: [${manager}] scaffolding starter app at ${appDir}`)
    run(process.execPath, [
      join(root, "packages/create-vibelang/bin/create-vibelang.mjs"),
      appDir,
      "--no-install",
    ], { cwd: scratch })

    const appPkgPath = join(appDir, "package.json")
    const appPkg = JSON.parse(readFileSync(appPkgPath, "utf8"))
    const fileRef = (p) => `file:${p.replaceAll("\\", "/")}`
    appPkg.dependencies = {
      ...appPkg.dependencies,
      "vibelang-runtime": fileRef(runtimeTgz),
    }
    appPkg.devDependencies = {
      ...appPkg.devDependencies,
      vibelang: fileRef(compilerTgz),
      "vibelang-vite": fileRef(viteTgz),
    }
    appPkg.overrides = {
      ...appPkg.overrides,
      vibelang: fileRef(compilerTgz),
      "vibelang-runtime": fileRef(runtimeTgz),
      "vibelang-vite": fileRef(viteTgz),
      [platformPkgName]: fileRef(platformTgz),
    }
    appPkg.resolutions = {
      ...appPkg.resolutions,
      ...appPkg.overrides,
    }
    writeFileSync(appPkgPath, JSON.stringify(appPkg, null, 2))

    // Clean environment: never leak checkout VIBELANG_BINARY override into the rehearsal app!
    const cleanEnv = {
      ...process.env,
      VIBELANG_DISABLE_CACHE: "1",
      DPRINT_CACHE_DIR: join(scratch, `dprint-cache-${manager}`),
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    }
    delete cleanEnv.VIBELANG_BINARY
    delete cleanEnv.VIBELANG_RUNTIME
    delete cleanEnv.VIBELANG_RUNTIME_DIR
    delete cleanEnv.EFFECT_NODE_MODULES

    if (manager === "npm") {
      run(npmCmd, ["install", "--no-audit", "--no-fund"], { cwd: appDir, env: cleanEnv })
    } else if (manager === "bun") {
      run(bunCmd, ["install"], { cwd: appDir, env: cleanEnv })
    }

    // Verify installed platform binary matches the freshly built native binary byte-for-byte.
    const installedPlatBin = join(appDir, "node_modules", ...platformPkgName.split("/"), "bin", exeName)
    assert.ok(existsSync(installedPlatBin), `installed native binary missing at ${installedPlatBin}`)
    assert.equal(
      sha256(installedPlatBin),
      expectedBinarySha,
      `installed binary at ${installedPlatBin} does not match freshly built ${binaryPath}`
    )
    console.log(`rehearse-native: [${manager}] installed binary SHA-256 verified`)

    const runner = manager === "npm" ? npmCmd : bunCmd
    console.log(`rehearse-native: [${manager}] running build, start, test, lint, format`)
    run(runner, ["run", "build"], { cwd: appDir, env: cleanEnv })
    const startOut = run(runner, ["run", "start"], { cwd: appDir, env: cleanEnv })
    assert.ok(startOut.trim().length > 0, `${manager} run start produced empty output`)
    run(runner, ["run", "test"], { cwd: appDir, env: cleanEnv })
    run(runner, ["run", "lint"], { cwd: appDir, env: cleanEnv })
    run(runner, ["run", "check"], { cwd: appDir, env: cleanEnv })

    console.log(`rehearse-native: [${manager}] PASS`)
    return { appDir, cleanEnv }
  }

  const { appDir: npmAppDir, cleanEnv } = runStarterApp("npm")
  if (withBun) {
    runStarterApp("bun")
  }

  // 4. On Windows, also run windows-smoke.mjs in paths containing spaces, #, and % (and --vitest without #).
  if (isWin) {
    const special = join(scratch, "space # % smoke")
    cpSync(npmAppDir, special, { recursive: true })
    rmSync(join(special, "src"), { recursive: true, force: true })
    rmSync(join(special, "dist"), { recursive: true, force: true })
    run(process.execPath, [join(root, "scripts/release/windows-smoke.mjs"), special], { env: cleanEnv })

    const vitestDir = join(scratch, "space vitest smoke")
    cpSync(npmAppDir, vitestDir, { recursive: true })
    rmSync(join(vitestDir, "src"), { recursive: true, force: true })
    rmSync(join(vitestDir, "dist"), { recursive: true, force: true })
    run(process.execPath, [join(root, "scripts/release/windows-smoke.mjs"), vitestDir, "--vitest"], { env: cleanEnv })
  }

  console.log(`rehearse-native: ALL CHECKS PASSED on ${platform}`)
} finally {
  if (keep) {
    console.log(`rehearse-native: kept scratch directory ${scratch}`)
  } else {
    rmSync(scratch, { recursive: true, force: true })
  }
}
