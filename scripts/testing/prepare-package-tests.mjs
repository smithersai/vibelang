import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { spawnSync } from "node:child_process"
import { fixtureDirectory, runtimeModules } from "./package-fixtures.mjs"

export function preparePackageTests(repo, group, binary = process.env.VIBELANG_BINARY ?? join(repo, "packages", "compiler", "native", "vibelang")) {
if (!["vite", "unplugin", "source-map-tools"].includes(group)) throw new Error("unknown fixture group")
const prepared = join(repo, "packages", fixtureDirectory(group), ".prepared")
rmSync(prepared, { recursive: true, force: true })
const runtime = join(prepared, "runtime")
mkdirSync(runtime, { recursive: true })
for (const name of ["src", "package.json", "tsconfig.json"]) cpSync(join(repo, "packages/runtime", name), join(runtime, name), { recursive: true })
try {
  runtimeModules(repo, join(runtime, "node_modules"))
  const compile = spawnSync(binary, ["-p", join(runtime, "tsconfig.json")], { stdio: "inherit" })
  if (compile.error) throw compile.error
  if (compile.status !== 0) throw new Error("fixture runtime compilation failed: " + (compile.signal ?? compile.status))
} finally {
  // Cached outputs hold real bytes. Workspace/install links are per-leaf scratch.
  rmSync(join(runtime, "node_modules"), { recursive: true, force: true })
}
if (group === "source-map-tools") {
  const generated = spawnSync("go", ["run", "-p", "8", "-trimpath", "./internal/vibelangfuzz/vipgen/programs"], {
    cwd: join(repo, "typescript/tsc"), env: { ...process.env, CGO_ENABLED: "0", GOCACHE: process.env.GOCACHE ?? join(homedir(), ".cache/go-build-smthrs") }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024
  })
  if (generated.error) throw generated.error
  if (generated.status !== 0) throw new Error("source-map program generation failed: " + generated.stderr)
  writeFileSync(join(prepared, "programs.jsonl"), generated.stdout)
}

}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  preparePackageTests(fileURLToPath(new URL("../../", import.meta.url)), process.argv[2])
}
