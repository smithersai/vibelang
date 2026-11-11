import { spawn } from "node:child_process"
import { constants } from "node:os"
import { fileURLToPath } from "node:url"
import { stagePackageTest } from "./package-fixtures.mjs"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const [group, ...selection] = process.argv.slice(2)
const files = selection.filter(option => !option.startsWith("--"))
const reporting = selection.filter(option => option.startsWith("--"))
if (reporting.some(option => !option.startsWith("--test-reporter=") && !option.startsWith("--test-name-pattern="))) throw new Error("only reporting or named-test selection may accompany a package leaf")
const staged = stagePackageTest(repo, group, files)
const args = ["--test", "--test-concurrency=4", "--test-timeout=300000",
  ...(group === "vite" ? ["--test-force-exit", "--import", staged.root + "/packages/vite/test/report-handles.mjs"] : []),
  ...reporting, ...staged.files]
try {
  const child = spawn(process.execPath, args, { cwd: staged.cwd, stdio: "inherit", env: {
    ...process.env, VIBELANG_BINARY: process.env.VIBELANG_BINARY ?? repo + "/packages/compiler/native/vibelang",
    VIBELANG_PACKAGE_TEST_ROOT: staged.root, VIBELANG_PACKAGE_SOURCE_ROOT: repo
  } })
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map(signal => {
    const handler = () => child.kill(signal)
    process.on(signal, handler)
    return [signal, handler]
  })
  try {
    const result = await new Promise((resolve, reject) => {
      child.on("error", reject)
      child.on("close", (code, signal) => resolve({ code, signal }))
    })
    process.exitCode = result.code ?? 128 + (constants.signals[result.signal] ?? 1)
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler)
  }
} finally {
  staged.cleanup()
}
