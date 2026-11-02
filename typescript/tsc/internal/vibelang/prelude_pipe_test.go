package vibelang

import (
	"strings"
	"testing"
)

func TestPreludePipeCallGuidance(t *testing.T) {
	source := "function num(n: number) { return n + 1 }\nexport function f() { return pipe(num(1), Effect.map((n: number) => n + 1)) }"
	program, file, _, _ := editorProgram(t, source)
	found := false
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == 4502 {
			found = true
			text := diagnosticWithNotes(d)
			if !strings.Contains(text, "Pass the program to the operation as a function: Effect.map(() => num(1), (n: number) => n + 1)") || strings.Contains(text, "|>") || strings.Contains(text, "pipe(() =>") {
				t.Errorf("missing guidance: %s", text)
			}
		}
		if d.Source() == "" && d.Code() == 2345 {
			t.Errorf("raw TypeScript diagnostic: %s", d.String())
		}
	}
	if !found {
		t.Fatal("missing EK4502 for prelude pipe")
	}
	for _, source := range []string{
		"export function f() { return pipe(1, (n: number) => n + 1) }",
		"function num() { return 1 }; export function f() { return pipe(num(), (n: string) => n) }",
		"function num(n: number) { return n + 1 }; export function f() { return pipe(() => num(1), Effect.map((n: number) => n + 1)) }",
		"function pipe(a: number, b: number): number { return a+b }; export function f() { return pipe(1, 2) }",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == 4502 {
				t.Errorf("unexpected guidance for %s", source)
			}
		}
	}
}
