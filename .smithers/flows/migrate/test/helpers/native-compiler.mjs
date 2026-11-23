// The native compiler the migrate tests run end to end: VIBELANG_BINARY when
// set, otherwise the binary //packages:compilerNative places in the tree. A
// missing binary fails the test file instead of skipping its tests.
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

export function nativeCompiler() {
  const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../../../packages/compiler/native/vibelang", import.meta.url))
  assert.ok(existsSync(compiler), "no native compiler at " + compiler + ": run scripts/build-vibelang.sh or set VIBELANG_BINARY")
  return compiler
}
