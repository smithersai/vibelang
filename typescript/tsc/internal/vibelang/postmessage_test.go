package vibelang

import (
	"strings"
	"testing"
)

// VIP-33 bans host messaging references, including held values and statically
// named globalThis members. Local bindings retain their JavaScript meaning.
func TestPostMessagePlatformDiagnostics(t *testing.T) {
	files := computedKeyFiles(false)
	for name := range files {
		if strings.HasSuffix(name, "/main.vibe") {
			delete(files, name)
		}
	}
	for name := range files {
		if strings.HasSuffix(name, "/tsconfig.json") {
			files[strings.TrimSuffix(name, "tsconfig.json")+"main.vibe"] = `export const direct = postMessage
export const dotted = globalThis.postMessage
export const bracket = globalThis["postMessage"]
export const local = (postMessage: () => number) => postMessage()
export const localGlobal = (globalThis: {postMessage: () => number}) => globalThis.postMessage()
`
			break
		}
	}
	p := computedKeyProgram(t, files)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Code() == EK4402.Code {
			count++
			if !strings.Contains(diagnosticWithNotes(d), "postMessage") {
				t.Errorf("missing banned global name: %s", diagnosticWithNotes(d))
			}
		}
	}
	if count != 3 {
		t.Fatalf("got %d platform diagnostics, want 3", count)
	}
}
