import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { join, basename, dirname } from "node:path"
import { tmpdir } from "node:os"

export const fixtureDirectory = group => group === "source-map-tools" ? "compiler/test/source-maps" : group + "/test"
const ignored = new Set(["node_modules", ".fixtures", ".prepared", ".cache", ".jj", ".git", "native"])
function copySupport(source, destination, selected) {
  cpSync(source, destination, { recursive: true, filter(path) {
    const name = basename(path)
    return !ignored.has(name) && (!/\.test\.mjs$/.test(name) || selected.has(path))
  } })
}
function link(source, destination) {
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(source, destination, "dir")
}
function modules(source, destination, replacements = {}) {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source)) {
    if (Object.hasOwn(replacements, entry)) continue
    link(join(source, entry), join(destination, entry))
  }
  for (const [name, target] of Object.entries(replacements)) link(target, join(destination, name))
}

// Runtime platform packages must resolve the same Effect as the fixture.
// Copy this scope, as the original run.sh does; all other installs are read-only.
export function runtimeModules(repo, destination) {
  const source = join(repo, "packages/runtime/node_modules")
  mkdirSync(destination, { recursive: true })
  for (const name of readdirSync(source)) {
    if (name === "effect" || name === "@effect") continue
    link(join(source, name), join(destination, name))
  }
  cpSync(join(source, "@effect"), join(destination, "@effect"), { recursive: true, dereference: true })
  link(join(repo, "experiments/node_modules/effect"), join(destination, "effect"))
}

export function stagePackageTest(repo, group, file) {
  if (!["vite", "unplugin", "source-map-tools"].includes(group)) throw new Error("unknown fixture group")
  const files = Array.isArray(file) ? file : [file]
  const directory = fixtureDirectory(group)
  if (!files.length || files.some(file => dirname(file) !== directory || !basename(file).endsWith(".test.mjs"))) throw new Error("test file is outside its fixture group")
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-package-test-"))
  try {
    for (const entry of readdirSync(repo)) {
      if (entry === "packages" || ignored.has(entry)) continue
      link(join(repo, entry), join(scratch, entry))
    }
    const packages = join(scratch, "packages")
    mkdirSync(packages, { recursive: true })
    const privatePackages = group === "source-map-tools" ? ["compiler"] : ["compiler", "vite", "unplugin"]
    for (const entry of readdirSync(join(repo, "packages"))) {
      if (!privatePackages.includes(entry)) link(join(repo, "packages", entry), join(packages, entry))
    }
    for (const name of privatePackages) {
      const source = join(repo, "packages", name), destination = join(packages, name)
      if (name === "compiler" || name === group) {
        copySupport(source, destination, new Set(files.map(file => join(repo, "packages", file))))
      } else {
        mkdirSync(destination, { recursive: true })
        cpSync(join(source, "src"), join(destination, "src"), { recursive: true })
        cpSync(join(source, "package.json"), join(destination, "package.json"))
      }
      if (name === "compiler") link(join(source, "native"), join(destination, "native"))
      if (existsSync(join(source, "node_modules"))) modules(join(source, "node_modules"), join(destination, "node_modules"), name === "compiler" ? {} :
        { vibelang: join(packages, "compiler") })
    }
    const here = join(packages, directory), fixtures = join(here, ".fixtures")
    mkdirSync(fixtures, { recursive: true })
    cpSync(join(repo, "packages", directory, ".prepared/runtime"), join(fixtures, "vibelang-runtime"), { recursive: true })
    runtimeModules(repo, join(fixtures, "vibelang-runtime/node_modules"))
    const installed = group === "source-map-tools" ? join(repo, "packages", directory, "node_modules") :
      join(repo, "packages", group, "node_modules")
    const overrides = {
      effect: join(repo, "experiments/node_modules/effect"),
      "vibelang-runtime": join(fixtures, "vibelang-runtime"),
      vibelang: join(packages, "compiler"),
      ...(group === "unplugin" ? { "vibelang-unplugin": join(packages, "unplugin") } : {})
    }
    modules(installed, join(fixtures, "node_modules"), overrides)
    if (group === "source-map-tools") {
      modules(installed, join(here, "node_modules"))
      for (const name of ["vite", "unplugin"]) {
        const destination = join(fixtures, "plugins", name)
        mkdirSync(destination, { recursive: true })
        cpSync(join(repo, "packages", name, "package.json"), join(destination, "package.json"))
        cpSync(join(repo, "packages", name, "src"), join(destination, "src"), { recursive: true })
      }
      rmSync(join(fixtures, "node_modules/@effect"), { recursive: true, force: true })
      mkdirSync(join(fixtures, "node_modules/@effect"), { recursive: true })
      cpSync(join(installed, "@effect/vitest"), join(fixtures, "node_modules/@effect/vitest"), { recursive: true, dereference: true })
      cpSync(join(repo, "packages", directory, ".prepared/programs.jsonl"), join(fixtures, "programs.jsonl"))
    }
    return { root: scratch, cwd: group === "source-map-tools" ? here : join(packages, group), file: join(packages, files[0]), files: files.map(file => join(packages, file)),
      cleanup: () => rmSync(scratch, { recursive: true, force: true }) }
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true })
    throw error
  }
}
