// Compile the HTTP example against the local compiler and runtime before testing its requests.
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { prepareExample } from "./prepare-examples.mjs"

const repository = process.cwd()
const temporary = mkdtempSync(join(tmpdir(), "vibelang-http-api-"))
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  process.stdout.write(result.stdout ?? "")
  process.stderr.write(result.stderr ?? "")
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(command + " exited " + result.status)
  return result.stdout
}
try {
  const manifest = JSON.parse(readFileSync("packages/runtime/package.json", "utf8"))
  const archive = join(temporary, "runtime.tgz")
  run("bun", ["pm", "pack", "--ignore-scripts", "--filename", archive, "--quiet"], resolve("packages/runtime"))
  const example = join(temporary, "http-api")
  prepareExample(resolve("examples/http-api"), example, {
    vibelang: resolve("packages/compiler"),
    "vibelang-runtime": archive,
    "vibelang-vite": resolve("packages/vite")
  }, manifest.peerDependencies.effect)
  run("bun", ["install"], example)
  run(resolve("packages/compiler/native/vibelang"), ["-p", example], repository)
  run("bun", ["run", "test"], example)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
