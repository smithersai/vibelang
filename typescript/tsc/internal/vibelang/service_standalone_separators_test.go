package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

// VIP-9: the members of a service body are separated as an interface's are,
// one `;`, `,` or line break after each member. A separator with no member
// before it is TypeScript's "Property or signature expected" (TS1131), as in
// `interface I { n: number; ; m: string }`. A class body's empty `;` element
// is not a service member, while a `;` after a member with a body keeps the
// class reading: that body is rejected on its own (EK0902).
func TestServiceStandaloneSeparators(t *testing.T) {
	const key = "static readonly key = \"separators/S\"; "
	for _, tc := range []struct {
		name   string
		source string
		want   []string // the text at each TS1131, in order
	}{
		{"second semicolon", "service S { " + key + "n: number; ; m: string }\n", []string{"; m: string }"}},
		{"leading semicolon", "service S { " + key + "; n: number }\n", []string{"; n: number }"}},
		{"trailing double semicolon", "service S { " + key + "n: number; ; }\n", []string{"; }"}},
		{"second comma", "service S { " + key + "n: number, , m: string }\n", []string{", m: string }"}},
		{"comma after semicolon", "service S { " + key + "n: number; , m: string }\n", []string{", m: string }"}},
		{"semicolon after comma", "service S { " + key + "n: number, ; m: string }\n", []string{"; m: string }"}},
		{"leading comma", "service S { " + key + ", n: number }\n", []string{", n: number }"}},
		{"semicolon lines", "service S {\n  " + key + "\n  n: number\n  ;\n  ;\n  m: string\n}\n", []string{";\n  m: string"}},
		{"after method signature", "service S { " + key + "m(): void; ; n: number }\n", []string{"; n: number }"}},
		{"written shape", "service S: { n: number } { ; " + key + "}\n", []string{"; static readonly"}},
		{"written shape trailing", "service S: { n: number } { " + key + "; }\n", []string{"; }"}},
		{"two strays", "service S { " + key + "; n: number, , m: string }\n", []string{"; n: number", ", m: string }"}},
		{"one separator each", "service S { " + key + "n: number, m: string, }\n", nil},
		{"semicolon separators", "service S { " + key + "n: number; m: string; }\n", nil},
		{"line break then semicolon", "service S {\n  " + key + "\n  n: number\n  ;\n  m: string\n}\n", nil},
		{"after a body", "service S { " + key + "m() { } ; n(): void }\n", nil},
		{"comment between", "service S { " + key + "n: number; /* c */ m: string }\n", nil},
		{"error body keeps class separators", "error E { a: string; ; b: string }\n", nil},
		{"class body keeps empty elements", "class C { a = 1; ; b = 2 }\n", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			var got []string
			for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
				if d.Code() != 1131 || d.Source() != "" {
					t.Errorf("unexpected syntax diagnostic: %s", d.String())
					continue
				}
				if text := tc.source[d.Pos():d.End()]; text != ";" && text != "," {
					t.Errorf("TS1131 spans %q, want the separator token", text)
				}
				got = append(got, tc.source[d.Pos():])
			}
			if len(got) != len(tc.want) {
				t.Fatalf("want %d TS1131, got %d: %q", len(tc.want), len(got), got)
			}
			for i, want := range tc.want {
				if !strings.HasPrefix(got[i], want) {
					t.Errorf("TS1131 %d at %q, want %q", i, head(got[i]), want)
				}
			}
			if t.Failed() {
				t.Log(fmt.Sprintf("source:\n%s", tc.source))
			}
		})
	}
}

func head(s string) string {
	if len(s) > 24 {
		return s[:24]
	}
	return s
}
