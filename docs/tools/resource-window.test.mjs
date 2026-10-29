import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("the scope guide releases a JavaScript Disposable once through acquireDisposable", () => {
  const text = readFileSync(new URL("../user/src/resource-management/030-scope.md", import.meta.url), "utf8")
  assert.match(text, /## Releasing JavaScript Disposables/)
  // using keeps TypeScript's meaning (VIP-8), so Effect code registers disposal in its scope.
  assert.match(text, /`acquireDisposable` acquires a JavaScript Disposable or AsyncDisposable/)
  assert.match(text, /released exactly once on success, typed failure, defect, or interruption/)
  assert.match(text, /A value acquired with `acquireRelease` is released only by its release/)
  assert.doesNotMatch(text, /holder\.value/, "the plain-holder workaround is gone")
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  const current = notes.slice(notes.indexOf("## 0.0.11"), notes.indexOf("## 0.0.10"))
  // using adds no mask (D490), so an interruption pending in the initializer's own
  // mask is delivered as that mask ends, as Effect delivers it: a known limitation.
  assert.match(current, /delivered as that mask ends/)
  assert.doesNotMatch(current, /Its release is now registered before the interruption can land/)
})
