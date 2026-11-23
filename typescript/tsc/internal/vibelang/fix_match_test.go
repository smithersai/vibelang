package vibelang

import (
	"testing"
)

// The diagnostic still recognizes choices with complex patterns and handlers.
// Chapter 007 / unsupported Match patterns and handlers retain source: docs/design/src/007-tooling.md#5d8fbe0b4f027c86
func TestMatchChainWarnings(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"a predicate", "export const f = (n: number) => Match.value(n).pipe(Match.when((x) => x > 1, () => \"big\"), Match.orElse(() => \"small\"))\n"},
		{"an array pattern", "export const f = (xs: ReadonlyArray<number>) => Match.value(xs).pipe(Match.when([1], () => \"one\"), Match.orElse(() => \"other\"))\n"},
		{"a handler that is not an arrow", "function one() { return \"one\" }\nexport const f = (n: 1 | 2): string => Match.value(n).pipe(Match.when(1, one), Match.orElse(() => \"two\"))\n"},
		{"a handler with early returns", "export const f = (n: 1 | 2): string => Match.value(n).pipe(Match.when(1, () => { if (n) return \"a\"; return \"b\" }), Match.orElse(() => \"two\"))\n"},
		{"a type no name writes", "type Box = { readonly n: number }\nexport const f = (n: 1 | 2) => Match.value(n).pipe(Match.when(1, (): Box => ({ n: 1 })), Match.orElse((): Box | undefined => undefined))\n"},
		{"a comment in a stage", "export const f = (n: 1 | 2): string => Match.value(n).pipe(Match.when(1, /* one */ () => \"one\"), Match.orElse(() => \"two\"))\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			assertMatchFormWarning(t, test.source)
		})
	}
}

// A chain that does not end in a finisher, or whose value runs, draws nothing:
// a partial matcher has no match form.
func TestMatchChainNotReported(t *testing.T) {
	for _, source := range []string{
		"export const f = (n: number) => Match.value(n).pipe(Match.when(1, () => \"one\"), Match.option)\n",
		"export const partial = Match.type<number>().pipe(Match.when(1, () => \"one\"))\n",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Source() == diagnosticSource && d.Code() == EK4839.Code {
				t.Errorf("unexpected EK4839 in %s: %s", source, d.String())
			}
		}
	}
}

// VIP-7 refuse native Match migration when contextual types cannot be preserved; rule: docs/design/vips/0007-match.md#ac19cae21b402757

func assertMatchFormWarning(t *testing.T, source string) {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK4839.Code {
			return
		}
	}
	t.Fatalf("missing EK4839 in %s", source)
}
