package vibelangfuzz

import (
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Every VibeLang body loop consumes a token on each pass. A pass that reports
// an error without consuming one allocates a node forever: the compiler, and an
// editor showing the file, runs until it is out of memory.
func TestVibeLangBodyParseProgress(t *testing.T) {
	bodies := []string{
		"service S { } layer L: S { @ }",
		"layer L: S { n: 1; @ }",
		"data D { @ }",
		"data D { A { @ } }",
		"service S { @ }",
		"error E { @ }",
		"schema error E { @ }",
		"schema C { @ }",
		"const v = match (x) { @ };",
		"const v = match (x) { when { @ }: 1; };",
		"const v = match (x) { when [ @ ]: 1; };",
		"const v = match (x) { when P( @ ): 1; };",
		"effect function f(L) { provide L { @ } }",
		"effect function f() { uninterruptible { @ } }",
		"effect function f(xs) { for concurrent (const x of xs) { @ } }",
		"const v = do { @ };",
		"const v = effect { @ };",
		"class C { effect m() { @ } }",
	}
	tokens := []string{
		"default", "case", "else", "catch", "finally", "extends", "implements", "in", "of", "as",
		")", "]", ":", ",", "=>", "=", ".", "?", "...", "*", "%", "|>", "!", "#", "\\", "<", ">",
		"default default 1", ") )", "; )", "n : default",
	}
	for _, body := range bodies {
		for _, token := range tokens {
			source := strings.Replace(body, "@", token, 1)
			done := make(chan struct{})
			go func() {
				parseAs(parseKind{"/fuzz/main.vibe", core.ScriptKindTS}, source)
				close(done)
			}()
			select {
			case <-done:
			case <-time.After(30 * time.Second):
				// The stuck goroutine still allocates: stop the process, not just this test.
				panic("the parser makes no progress on: " + source)
			}
		}
	}
}
