package vibelang

import "testing"

// VIP-1: instanceof and a statically named prototype access are exempt.
// Grouping and erased assertions do not change the reference they contain.
func TestLegacyFunctionExemptWrappers(t *testing.T) {
	for _, tc := range []struct {
		name, expression string
		want             int
	}{
		{"instanceof-parens", "(() => 1) instanceof ((Function))", 0},
		{"instanceof-assert", "(() => 1) instanceof (Function as FunctionConstructor)", 0},
		{"instanceof-satisfies", "(() => 1) instanceof (Function satisfies FunctionConstructor)", 0},
		{"instanceof-nonnull", "(() => 1) instanceof Function!", 0},
		{"prototype-parens", "((Function)).prototype", 0},
		{"prototype-assert", "(Function as FunctionConstructor).prototype", 0},
		{"prototype-satisfies", "(Function satisfies FunctionConstructor)[\"prototype\"]", 0},
		{"prototype-nonnull", "Function!?.prototype", 0},
		{"call-stays-banned", "(Function as FunctionConstructor)(\"return 7\")", 1},
		{"alias-stays-banned", "((Function))", 1},
		{"member-stays-banned", "(Function!).name", 1},
		{"comma-stays-banned", "(() => 1) instanceof (0, Function)", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export const result = "+tc.expression)
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 107 {
					count++
				}
			}
			if count != tc.want {
				t.Fatalf("EK0107 count = %d, want %d: %s", count, tc.want, tc.expression)
			}
		})
	}
}
