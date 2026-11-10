package vibelang

import (
	"strings"
	"testing"
)

// Appendix A: a DeclarationStart has no DecoratorList, as TypeScript's `type`
// has none, so a decorator before `service`, `error`, `schema error`,
// `schema` or `data` is TypeScript's "Decorators are not valid here"
// (TS1206) at the decorator's `@`, as `@dec type T = 1` is. The declaration
// itself still parses, without the decorator; a decorated class and a
// decorated class member keep TypeScript's reading.
func TestDeclarationDecorators(t *testing.T) {
	const dec = "function dec(value: unknown, context: unknown) {}\n"
	for _, tc := range []struct {
		name   string
		source string
		want   []string // the text at each TS1206, in order
	}{
		{"service", dec + "@dec service S { static readonly key = \"d/S\"; n: number }\n", []string{"@dec service"}},
		{"error", dec + "@dec error E { id: string }\n", []string{"@dec error"}},
		{"schema error", dec + "@dec schema error E { id: Schema.String }\n", []string{"@dec schema error"}},
		{"schema", dec + "@dec schema S { a: Schema.String }\n", []string{"@dec schema S"}},
		{"data", dec + "@dec data D { A; B }\n", []string{"@dec data"}},
		{"export then decorator", dec + "export @dec service S { static readonly key = \"d/S\"; n: number }\n", []string{"@dec service"}},
		{"decorator then export", dec + "@dec export service S { static readonly key = \"d/S\"; n: number }\n", []string{"@dec export"}},
		{"two decorators report once", dec + "@dec @dec service S { static readonly key = \"d/S\"; n: number }\n", []string{"@dec @dec"}},
		{"line break", dec + "@dec\nservice S { static readonly key = \"d/S\"; n: number }\n", []string{"@dec\nservice"}},
		{"call decorator", dec + "@(dec) error E { id: string }\n", []string{"@(dec)"}},
		{"two declarations", dec + "@dec error E { id: string }\n@dec service S { static readonly key = \"d/S\"; n: number }\n", []string{"@dec error", "@dec service"}},
		{"class keeps decorators", dec + "@dec class C { @dec m() {} }\n", nil},
		{"plain declarations", dec + "export service S { static readonly key = \"d/S\"; n: number }\nerror E { id: string }\n", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			var got []string
			for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
				if d.Code() != 1206 || d.Source() != "" {
					t.Errorf("unexpected syntax diagnostic: %s", d.String())
					continue
				}
				if text := tc.source[d.Pos():d.End()]; text != "@" {
					t.Errorf("TS1206 spans %q, want the decorator's @", text)
				}
				got = append(got, tc.source[d.Pos():])
			}
			if len(got) != len(tc.want) {
				t.Fatalf("want %d TS1206, got %d: %q", len(tc.want), len(got), got)
			}
			for i, want := range tc.want {
				if !strings.HasPrefix(got[i], want) {
					t.Errorf("TS1206 %d at %q, want %q", i, got[i], want)
				}
			}
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 1206 {
					t.Errorf("TS1206 reported again by the checker: %s", d.String())
				}
			}
			// The decorator never reaches the lowered declaration's emit.
			if tc.want != nil {
				for name, emitted := range emittedJS(t, program) {
					if strings.Contains(emitted, "__esDecorate") || strings.Contains(emitted, "__decorate") {
						t.Errorf("the rejected decorator is applied in %s:\n%s", name, emitted)
					}
				}
			}
		})
	}
}
