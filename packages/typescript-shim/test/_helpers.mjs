import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const repo = fileURLToPath(new URL("../../../", import.meta.url))
export const shimDir = join(repo, "packages/typescript-shim")
export const compilerDir = join(repo, "packages/compiler")
export const runtimeDir = join(repo, "packages/runtime")
export const effectDir = join(runtimeDir, "node_modules/effect")
export const nativeBinary =
  process.env.VIBELANG_BINARY ||
  (existsSync(join(repo, "typescript/built/local/tsc"))
    ? join(repo, "typescript/built/local/tsc")
    : join(repo, "packages/compiler/native/vibelang"))

const missing = [nativeBinary, effectDir, join(runtimeDir, "dist/index.js")].find((p) => !existsSync(p))
export const skipReason = missing !== undefined && `build native compiler and runtime first; missing ${missing}`

export const defaultTsconfig = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    types: [],
    skipLibCheck: true,
    outDir: "out",
    rootDir: "src",
    declaration: true,
    sourceMap: true,
  },
  include: ["src"],
}

export function createShimmedProject(t, files = {}, tsconfigOverride = {}) {
  const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-shim-suite-")))
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }))

  mkdirSync(join(projectRoot, "node_modules/.bin"), { recursive: true })
  cpSync(shimDir, join(projectRoot, "node_modules/typescript"), {
    recursive: true,
    filter: (p) => !p.includes("/test") && !p.endsWith("/node_modules"),
  })
  symlinkSync(compilerDir, join(projectRoot, "node_modules/vibelang"))
  symlinkSync(realpathSync(effectDir), join(projectRoot, "node_modules/effect"))
  symlinkSync(runtimeDir, join(projectRoot, "node_modules/vibelang-runtime"))
  symlinkSync("../typescript/bin/tsc", join(projectRoot, "node_modules/.bin/tsc"))

  const mergedTsconfig = {
    ...defaultTsconfig,
    ...tsconfigOverride,
    compilerOptions: {
      ...defaultTsconfig.compilerOptions,
      ...(tsconfigOverride.compilerOptions ?? {}),
    },
  }

  const allFiles = {
    "package.json": JSON.stringify({ name: "shim-fixture", private: true, type: "module" }),
    "tsconfig.json": JSON.stringify(mergedTsconfig, null, 2),
    ...files,
  }

  for (const [rel, text] of Object.entries(allFiles)) {
    const dest = join(projectRoot, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, text)
  }

  return projectRoot
}

export function runTsc(projectRoot, args = [], bin = "node_modules/.bin/tsc", extraEnv = {}) {
  return spawnSync(join(projectRoot, bin), args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, VIBELANG_BINARY: nativeBinary, ...extraEnv },
  })
}

export function runNode(projectRoot, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, VIBELANG_BINARY: nativeBinary, ...extraEnv },
  })
}
