package vibelang

import (
	"strings"
	"testing"
)

func TestTracedCallbackDiagnostic(t *testing.T) {
	p, file, _, _ := editorProgram(t, `import * as Effect from "effect/Effect"
function load() { yieldNow(); return 1 }
export const named = Effect.fn("Reader.named")(load)
export const inline = Effect.fn("Reader.inline")((n: number) => { yieldNow(); return n + 1 })`)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() != EK4301.Code {
			continue
		}
		count++
		if !strings.Contains(diagnosticWithNotes(d), "withSpan(() => { ... }, name)") || strings.Contains(diagnosticWithNotes(d), "synchronously") || strings.Contains(diagnosticWithNotes(d), "forEach") {
			t.Errorf("misleading traced callback diagnostic: %s", diagnosticWithNotes(d))
		}
	}
	if count != 2 {
		t.Fatalf("got %d callback diagnostics, want 2", count)
	}
}

// EK4301 says what the callback can't do and why, and its fix shows a long
// callback by its parameters rather than pasting its whole body.
func TestPausingCallbackMessage(t *testing.T) {
	p, file, _, _ := editorProgram(t, `export function lengths(ids: ReadonlyArray<string>) {
  return ids.map((id) => {
    Console.log(id)
    const trimmed = id.trim()
    return trimmed.length
  })
}`)
	var got []string
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4301.Code {
			got = append(got, diagnosticWithNotes(d))
		}
	}
	want := "This callback can't run Console.log(id), an Effect: ReadonlyArray.prototype.map calls it synchronously, as a plain function.\n" +
		"Use Effect.forEach(ids, (id) => { … }) or a for...of loop.\n" +
		"To collect the program instead of running it, return a function: (id) => () => Console.log(id)"
	if len(got) != 1 || got[0] != want {
		t.Fatalf("EK4301 messages:\n%s\nwant:\n%s", strings.Join(got, "\n---\n"), want)
	}
}
