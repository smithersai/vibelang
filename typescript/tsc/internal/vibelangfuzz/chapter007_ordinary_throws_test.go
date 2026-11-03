package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const chapter007OrdinaryThrowsTarget = "FuzzChapter007OrdinaryThrows"
const chapter007OrdinaryThrowsQuote = "A " + "\x60throw\x60" + " statement is " + "\x60EK0401\x60" + ", even when a " + "\x60try\x60" + " statement in the same function catches it."

func chapter007OrdinaryThrowsQuoted(t testing.TB) {
	if !strings.Contains(SpecText("003-failures.md"), chapter007OrdinaryThrowsQuote) {
		t.Fatalf("Chapter 003 no longer says %q", chapter007OrdinaryThrowsQuote)
	}
}

func TestChapter007OrdinaryThrowsQuoted(t *testing.T) { chapter007OrdinaryThrowsQuoted(t) }

// Chapter 007 / ordinary Vibe throw restrictions remain in force: docs/design/src/007-tooling.md#ca33ed0583087536
// This is the current VIP-4 plain-code restriction. Older FuzzFailuresSpec
// fixtures quote the superseded allowance for a synchronous plain throw.
func FuzzChapter007OrdinaryThrows(f *testing.F) {
	startShortBudget(f)
	chapter007OrdinaryThrowsQuoted(f)
	keys := []string{"plain", "caught", "getter", "generator", "top", "async", "effect"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		value := fmt.Sprintf("%q", fmt.Sprintf("chapter007-%d", variant))
		body := "throw " + value
		source := ""
		switch key {
		case "plain":
			source = "export function witness(){ " + body + " }"
		case "caught":
			source = "export function witness(){ try { " + body + " } catch { return 1 } }"
		case "getter":
			source = "export const witness={get value(){ " + body + " }}"
		case "generator":
			source = "export function* witness(){ " + body + " }"
		case "top":
			source = body
		case "async":
			source = "export async function witness(){ " + body + " }"
		case "effect":
			source = "export effect function witness(){ " + body + " }"
		}
		r := toolsCompile(t, w, chapter007OrdinaryThrowsTarget, map[string]string{"main.vibe": source + "\n"})
		defer r.Remove()
		wantError := key != "async" && key != "effect"
		found := false
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 401 && d.Category() == diagnostics.CategoryError {
				found = true
			}
			if !wantError && d.Category() == diagnostics.CategoryError {
				t.Fatalf("valid %s throw control rejected: %v", key, r.Diagnostics)
			}
		}
		if found != wantError {
			Gap(t, chapter007OrdinaryThrowsTarget, key, "VIP-4 %s; want EK0401=%t, got %v\n%s", chapter007OrdinaryThrowsQuote, wantError, r.Diagnostics, source)
		}
		ExpectPending(t, chapter007OrdinaryThrowsTarget, key)
		ExpectPending(t, chapter007OrdinaryThrowsTarget, specCorpusKey(t))
	})
}
