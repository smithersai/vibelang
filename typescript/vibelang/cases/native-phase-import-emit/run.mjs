// run-seconds: 60
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))
const out = fs.mkdtempSync(path.join(os.tmpdir(), "native-import-emit-"))
try {
  execFileSync(process.env.VIBELANG_BINARY, [
    "--target", "ESNext", "--module", "ESNext", "--moduleResolution", "Bundler",
    "--strict", "--skipLibCheck", "--outDir", out, path.join(root, "reference.ts"),
  ], { cwd: root, stdio: "pipe", timeout: 30_000 })
  const native = fs.readFileSync(path.join(out, "reference.js"), "utf8")
  const vibe = fs.readFileSync(path.join(root, "out", "main.js"), "utf8")
  assert.equal(vibe, native)
  console.log("native emit matches")
} finally {
  fs.rmSync(out, { recursive: true, force: true })
}
