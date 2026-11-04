package vibelang

import "testing"

// Chapter001's function constructor/prototype rules follow the member name;
// parentheses and erased assertions preserve a literal key.
func TestLegacyStaticKeyWrappers(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"constructor-key-parens", "const f=()=>1; return f[(\"constructor\")]", 1},
		{"constructor-key-assert", "const f=()=>1; return f[(\"constructor\" as const)]", 1},
		{"constructor-key-satisfies", "const f=()=>1; return f[(\"constructor\" satisfies string)]", 1},
		{"constructor-key-nonnull", "const f=()=>1; return f[\"constructor\"!]", 1},
		{"prototype-key-parens-control", "return Function[(\"prototype\")]", 0},
		{"prototype-key-assert-control", "return Function[(\"prototype\" as const)]", 0},
		{"prototype-key-satisfies-control", "return Function[(\"prototype\" satisfies string)]", 0},
		{"prototype-key-nonnull-control", "return Function[\"prototype\"!]", 0},
		{"constructor-key-object-control", "const o={constructor:1}; return o[(\"constructor\")]", 0},
		{"constructor-key-any-control", "const f:any=()=>1; return f[(\"constructor\")]", 0},
		{"constructor-key-write-control", "const f=()=>1; f[(\"constructor\")]=f; return f", 0},
		{"constructor-key-update", "const f=()=>1; f[(\"constructor\")] ||= f; return f", 1},
		{"constructor-key-delete-control", "const f=()=>1; delete f[(\"constructor\")]; return f", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, "export function test(){ "+tc.body+" }")
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
				if d.Source() == "EK" && d.Code() == 107 {
					count++
					if tc.want == 1 {
						if got := f.Text()[d.Loc().Pos():d.Loc().End()]; got != `"constructor"` {
							t.Errorf("span %q, want literal key", got)
						}
					}
				}
			}
			if count != tc.want {
				t.Fatalf("EK0107 count%d want%d: %s", count, tc.want, tc.body)
			}
		})
	}
}
