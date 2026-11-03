package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

const errorSignatureSpanQuote = "The language server prefers an in-program `./x.vibe` source to its stale adjacent or relocated `x.d.vibe.ts`."

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

const errorFieldDocQuote = "and the same doc comment on each export"

func TestErrorFieldDocQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), errorFieldDocQuote) {
		t.Fatalf("Chapter 1 no longer says %q; update the oracle", errorFieldDocQuote)
	}
}

// A field's doc comment stays on its field wherever the field stands in the
// body: the payload literal must not take the first field's leading trivia.
// Each comment starts its own line: stock tsc 5.9.3 drops one that shares a
// line with the token before it, so the twin keeps nothing to compare there.
func FuzzErrorFieldDoc(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"first", "second", "after-tag", "generic", "after-method", "optional"} {
		f.Add(key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice byte) {
		TestErrorFieldDocQuoted(t)
		gap := []string{" ", "\n  ", "\n\n  "}[int(choice)%3]
		head, doc, field := "E", "/** doc */"+gap, "readonly a: string"
		body := doc + "a: string\n  b: number"
		switch key {
		case "second":
			body = "b: number\n  " + doc + "a: string"
		case "after-tag":
			body = "_tag: \"E\"\n  " + doc + "a: string"
		case "generic":
			head, body, field = "E<T>", doc+"a: T", "readonly a: T"
		case "after-method":
			body = doc + "a: string\n  describe(): string { return this.a }"
		case "optional":
			body, field = doc+"a?: string", "readonly a?: string"
		}
		r := toolsCompile(t, w, "FuzzEditor", map[string]string{"main.vibe": "export error " + head + " {\n  " + body + "\n}\n"})
		defer r.Remove()
		declaration, ok := r.Outputs["out/main.d.ts"]
		if !ok {
			t.Skip("project emits no declaration")
		}
		if !strings.Contains(strings.Join(strings.Fields(declaration), " "), "/** doc */ "+field) {
			t.Errorf("Chapter 1: %q\nfield %q lost its comment:\n%s", errorFieldDocQuote, field, declaration)
		}
		class, _, found := strings.Cut(declaration[strings.Index(declaration, "export declare class"):], " extends ")
		if !found || strings.Contains(class, "/**") {
			t.Errorf("a field's comment left the type literal:\n%s", declaration)
		}
	})
}
