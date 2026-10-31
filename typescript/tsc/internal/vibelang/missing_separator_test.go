package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Decided detail 241, Appendix A Separator: two members of an error, schema
// error or service body on one line with no separator get the body's code,
// EK1306 or EK0908, never TypeScript's TS1442 or TS1005.
func TestMissingBodySeparator(t *testing.T) {
	for _, tc := range []struct {
		source, token string
		code          int32
	}{
		{"error E { a: number b: string }", "b", 1306},
		{"schema error E { a: number b: string }", "b", 1306},
		{"error E { a?: number readonly b: string }", "readonly", 1306},
		{"error E { a: number /* note */ b: string }", "b", 1306},
		{"error E { a: string | number b: boolean }", "b", 1306},
		{"error E { a: number get b() { return 1 } }", "get", 1306},
		{"error E { a: number describe() { return 1 } }", "describe", 1306},
		{"schema error E { a: number b?: string }", "b", 1306},
		{"service S { a: number b: string }", "b", 908},
		{"error E { a(): number a(): number { return 1 } }", "a", 1306},
		{"schema error E { a(): number a(): number { return 1 } }", "a", 1306},
		{"service S { a(): Effect.Effect<number> b(): Effect.Effect<string> }", "b", 908},
		{"error E { a: number mutable b: string }", "mutable", 1306},
		{"declare const dec: any; error E { a: number @dec b() { return 1 } }", "@", 1306},
	} {
		t.Run(tc.source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source+"\n")
			for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
				t.Errorf("syntax error: %s", d.String())
			}
			found := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				switch d.Code() {
				case tc.code:
					found++
					if got := file.Text()[d.Pos():d.End()]; got != tc.token {
						t.Errorf("EK%04d spans %q, want %q, the next member's first token", tc.code, got, tc.token)
					}
				case 1442, 1005:
					t.Errorf("TypeScript code: %s", d.String())
				}
			}
			if found != 1 {
				t.Fatalf("want one EK%04d, got %d", tc.code, found)
			}
		})
	}
}

// A line break, a semicolon or a closing brace separates members, and a
// method's body ends it: none of these report the code.
func TestBodySeparatorsAccepted(t *testing.T) {
	for _, source := range []string{
		"error E { a: number; b: string }",
		"error E {\n  a: number\n  b: string\n}",
		"error E { a: number }",
		"error E { describe() { return 1 } get b() { return 2 } }",
		"error E { a(): number; a(): number { return 1 } }",
		"schema error E { a(): number\n a(): number { return 1 } }",
		"service S { a(): Effect.Effect<number>; b(): Effect.Effect<string> }",
		"schema error E { a: number; b: string }",
		"service S { a: number; b: string }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source+"\n")
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == 1306 || d.Code() == 908 || d.Code() == 1442 || d.Code() == 1005 {
					t.Errorf("unexpected %s", d.String())
				}
			}
		})
	}
}

func TestMissingBodySeparatorQuickFix(t *testing.T) {
	for _, tc := range []struct {
		source, want string
		code         int32
	}{
		{"export error E { a: number b: string }\n", "export error E { a: number; b: string }\n", 1306},
		{"export schema error E { a: number  b: string }\n", "export schema error E { a: number;  b: string }\n", 1306},
		{"export service S { a: number b: string }\n", "export service S { a: number; b: string }\n", 908},
		{"export error E { a: number /** @internal */ b: string }\n", "export error E { a: number; /** @internal */ b: string }\n", 1306},
		{"export schema error E { a: number /* keep */ b: string }\n", "export schema error E { a: number; /* keep */ b: string }\n", 1306},
		{"export error E { a(): number /** @deprecated */ a(): number { return 1 } }\n", "export error E { a(): number; /** @deprecated */ a(): number { return 1 } }\n", 1306},
	} {
		t.Run(tc.source, func(t *testing.T) {
			if got := applyQuickFixOf(t, tc.source, tc.code, diagnostics.CategoryError); got != tc.want {
				t.Fatalf("quick fix wrote %q, want %q", got, tc.want)
			}
		})
	}
}

// Decided detail 241 preserves native TypeScript diagnostics, including inside
// a nested native class or an object method in an error's method body.
func TestNativeMissingSeparators(t *testing.T) {
	for _, tc := range []struct {
		source string
		code   int32
	}{
		{"class C { declare a: number b: string }", 1442},
		{"abstract class C { abstract a(): number b(): number }", 1144},
		{"interface C { a: number b: string }", 1005},
		{"error E { m() { class C { declare a: number b: string } } }", 1442},
		{"error E { m() { const x = { a(): number b() { return 1 } }; return x } }", 1005},
	} {
		t.Run(tc.source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source+"\n")
			found := false
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == tc.code {
					found = true
				}
				if d.Code() == 1306 || d.Code() == 908 {
					t.Errorf("native syntax received %s", d.String())
				}
			}
			if !found {
				t.Fatalf("missing native TS%d", tc.code)
			}
		})
	}
}
