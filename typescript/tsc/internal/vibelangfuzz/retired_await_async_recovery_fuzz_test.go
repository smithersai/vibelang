package vibelangfuzz

import (
	"strings"
	"testing"
)

const retiredAwaitAsyncQuote = "The retired `await.all`, `await.race`, `await.any` and `await.allSettled` are `EK1802`."

func retiredAwaitAsyncChapter(t testing.TB) {
	if !strings.Contains(SpecText("900-appendices.md"), retiredAwaitAsyncQuote) {
		t.Fatal("stale retired-await grammar quote")
	}
}
func TestRetiredAwaitAsyncRecoveryQuoted(t *testing.T) { retiredAwaitAsyncChapter(t) }
