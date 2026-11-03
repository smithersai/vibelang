package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

const errorSignatureSpanQuote = "4. **Existing tools work.**"

func TestErrorSignatureSpanQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), errorSignatureSpanQuote) {
		t.Fatal("tooling contract changed")
	}
}

// Signature help must tolerate every cursor position, including trivia in
// synthesized payload types. Keep the keyed witnesses as formatting mutates.
func FuzzErrorSignatureSpan(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"plain", "comment", "optional", "generic", "nested", "tag", "schema"} {
		f.Add(key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice byte) {
		trivia := []string{" ", "\n // field\n ", " /* field */ "}[int(choice)%3]
		head, field := "error E", "a: string"
		switch key {
		case "optional":
			field = "a?: string; b: number"
		case "generic":
			head, field = "error E<T>", "value:T"
		case "nested":
			field = "a: { readonly value: string }"
		case "tag":
			field = "_tag: \"E\"; a: string"
		case "schema":
			head = "schema error E"
		case "comment":
			trivia = "\n // field\n "
		}
		source := fmt.Sprintf("%s {%s%s }", head, trivia, field)
		r := toolsCompile(t, w, "FuzzEditor", map[string]string{"main.vibe": source})
		defer r.Remove()
		file := r.SourceFile("main.vibe")
		if file == nil {
			t.Fatal("missing editor source")
		}
		service, conv := toolsService(w, r.Program, toolsFileName(r.Dir, "main.vibe"))
		for offset := 0; offset <= len(source); offset++ {
			pos, _ := conv.ToLSPPosition(file, core.TextPos(offset))
			if _, err := service.ProvideSignatureHelp(t.Context(), toolsURI(r.Dir, "main.vibe"), pos, nil); err != nil {
				t.Fatalf("byte %d: %v", offset, err)
			}
		}
	})
}
