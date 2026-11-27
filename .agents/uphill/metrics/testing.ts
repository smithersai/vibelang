import { join } from "node:path"
import { analyzeGoFile, emit, GO_PACKAGES, NPM_PACKAGES, ROOT, walkFiles } from "./_lib.ts"

let totalFuzzTargets = 0

for (const pkg of GO_PACKAGES) {
  const testFiles = walkFiles(join(ROOT, pkg), "_test.go")
  let testFuncs = 0
  for (const file of testFiles) {
    const stats = analyzeGoFile(file)
    testFuncs += stats.testFuncs
    totalFuzzTargets += stats.fuzzFuncs
  }
  emit("go-unit-tests", testFuncs, { item: pkg })
}

emit("go-fuzz-targets", totalFuzzTargets)

for (const pkg of NPM_PACKAGES) {
  const testFiles = walkFiles(join(ROOT, pkg), [".ts", ".tsx", ".mjs", ".js"]).filter(
    (f) => f.includes(".test.") || f.includes(".spec.")
  )
  emit("pkg-test-files", testFiles.length, { item: pkg })
}
