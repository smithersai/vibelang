package vibelangfuzz

import (
	"strings"
	"testing"
)

const nativeAwaitBridgeQuote = "In the existing `async` context, suggest `await runPromise(Fiber.join(fiber))` or `await runPromise(Deferred.await(deferred))`"

func nativeAwaitBridgeChapter(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("002-running.md"), nativeAwaitBridgeQuote) {
		t.Fatal("stale async await repair quote")
	}
}
func TestNativeAwaitBridgeQuoted(t *testing.T) { nativeAwaitBridgeChapter(t) }
