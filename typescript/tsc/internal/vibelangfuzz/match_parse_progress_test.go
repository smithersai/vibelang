package vibelangfuzz

import (
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// After a misplaced rest element, the match list parser reads the rest of the
// list as patterns. A token that starts no pattern was reported without being
// read, so the loop never ended and allocated until the process ran out of
// memory (campaign103: `when [ let a , ... * : a ; ...`).
func TestVibeLangMatchListParseProgress(t *testing.T) {
	lists := []string{
		"const v = match (x) { when [ ...a, @ ]: 1; };",
		"const v = match (x) { when [ ... @ ]: 1; };",
		"const v = match (x) { when P( ...a, @ ): 1; };",
		"const v = match (x) { when { ...a, @ }: 1; };",
		"const v = match ( x ) { when\n[ let a , ... @ : a ; when { k : let b readonly b } : ; default : throw 1 ; } ;",
	}
	tokens := []string{
		"default", "case", "else", "catch", "in", "of", "as", ")", "}", ":", "=>", "=", ".", "?",
		"...", "*", "%", "|>", "!", "#", "\\", "<", ">", ";", "default default 1", "; )", "* *",
	}
	for _, list := range lists {
		for _, token := range tokens {
			source := strings.Replace(list, "@", token, 1)
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
