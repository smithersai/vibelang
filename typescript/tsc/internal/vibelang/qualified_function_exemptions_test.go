package vibelang

import "testing"

// VIP-1's qualified Function exemptions preserve erased TypeScript wrappers.
func TestQualifiedFunctionErasedExemptions(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"instanceof-as", "const x: unknown = () => 1; return x instanceof (globalThis.Function as FunctionConstructor)", 0},
		{"instanceof-assert", "const x: unknown = () => 1; return x instanceof (<FunctionConstructor>globalThis.Function)", 0},
		{"instanceof-satisfies", "const x: unknown = () => 1; return x instanceof (globalThis.Function satisfies FunctionConstructor)", 0},
		{"instanceof-nonnull", "const x: unknown = () => 1; return x instanceof globalThis.Function!", 0},
		{"prototype-as", "return (globalThis.Function as FunctionConstructor).prototype", 0},
		{"prototype-assert", "return (<FunctionConstructor>globalThis.Function).prototype", 0},
		{"prototype-satisfies", "return (globalThis.Function satisfies FunctionConstructor).prototype", 0},
		{"prototype-nonnull", "return globalThis.Function!.prototype", 0},
		{"instanceof-parens-control", "const x: unknown = () => 1; return x instanceof ((globalThis.Function))", 0},
		{"prototype-parens-control", "return ((globalThis.Function)).prototype", 0},
		{"read-as-control", "return (globalThis.Function as FunctionConstructor)", 1},
		{"read-satisfies-control", "return (globalThis.Function satisfies FunctionConstructor)", 1},
		{"read-nonnull-control", "return globalThis.Function!", 1},
		{"comma-prototype-control", "return (0, globalThis.Function).prototype", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, "export function check(){ "+tc.body+" }")
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
				if d.Source() == "EK" && d.Code() == 107 {
					count++
				}
			}
			if count != tc.want {
				t.Fatalf("EK0107 count%d want%d: %s", count, tc.want, tc.body)
			}
		})
	}
}
