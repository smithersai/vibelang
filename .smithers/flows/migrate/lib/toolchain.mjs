// A toolchain is one VibeLang build staged for targets to install: the native
// compiler, npm tarballs of vibelang (with that compiler inside),
// vibelang-runtime and vibelang-vite, and a TypeScript compiler API for
// reading declarations. Staging it from a checkout lets a run use the
// compiler on main before it is published; a published version needs no
// staging (setup takes --vibelang-version instead).
import { execFileSync } from "node:child_process"
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { must, readJson, writeJson } from "./util.mjs"

async function pack(dir, out) {
  const { stdout } = await must(`npm pack --silent --pack-destination ${JSON.stringify(out)}`, { cwd: dir })
  const name = stdout.trim().split("\n").at(-1).trim()
  if (!existsSync(join(out, name))) throw new Error(`npm pack in ${dir} printed ${name}, which is not in ${out}`)
  return join(out, name)
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
    compilerTgz = await pack(staging, out)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  const runtimeTgz = await pack(join(repo, "packages/runtime"), out)
  const viteTgz = await pack(join(repo, "packages/vite"), out)

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
    packages: {
      vibelang: compilerTgz.slice(out.length + 1),
      "vibelang-runtime": runtimeTgz.slice(out.length + 1),
      "vibelang-vite": viteTgz.slice(out.length + 1)
    },
    typescript: readJson(join(typescript, "package.json")).version
  }
  writeJson(join(out, "toolchain.json"), toolchain)
  return toolchain
}

/** Reads a staged toolchain: its compiler's absolute path, and its tarballs' names in dir. */
export function readToolchain(dir) {
  dir = resolve(dir)
  const t = readJson(join(dir, "toolchain.json"))
  return { ...t, dir, compiler: join(dir, t.compiler) }
}
