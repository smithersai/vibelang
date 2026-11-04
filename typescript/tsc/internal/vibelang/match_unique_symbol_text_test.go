package vibelang

import (
	"strings"
	"testing"
)

// EK4701 prints the subject and its missing case as TypeScript writes them
// at the match: a unique symbol reads typeof A, not unique symbol, and an
// imported namespace member keeps its qualifier.
func TestMatchCaseTextAtScope(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"unique symbol",
			"export const A: unique symbol = Symbol(\"A\"); export const B: unique symbol = Symbol(\"B\")\n" +
				"export function f(s: typeof A | typeof B) { return match (s) { when A: 1; } }\n",
			"This match does not handle every case of typeof A | typeof B: typeof B is left."},
		{"namespace member",
			"import { Option } from \"effect\"\n" +
				"export function f(o: Option.Option<number>) { return match (o) { when Option.Some(let v): v; } }\n",
			"This match does not handle every case of Option.Option<number>: Option.None<number> is left."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != "EK" || d.Code() != 4701 {
					continue
				}
				if !strings.Contains(d.String(), tc.want) {
					t.Fatalf("EK4701 text %q, want %q", d.String(), tc.want)
				}
				return
			}
			t.Fatal("no EK4701")
		})
	}
}
