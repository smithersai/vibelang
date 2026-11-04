package vibelang

import "testing"

func TestQualifiedPrototypeLiteralKeys(t *testing.T) {
	for _, tc := range []struct {
		name, expression string
		want             int
	}{
		{"grouped", `globalThis.Function[("prototype")]`, 0},
		{"as-const", `globalThis.Function["prototype" as const]`, 0},
		{"assertion", `globalThis.Function[<"prototype">"prototype"]`, 0},
		{"satisfies", `globalThis.Function["prototype" satisfies string]`, 0},
		{"non-null", `globalThis.Function["prototype"!]`, 0},
		{"template", "globalThis.Function[(`prototype`)]", 0},
		{"nested", `globalThis.Function[(("prototype" as const)!)]`, 0},
		{"optional", `globalThis.Function?.[("prototype")]`, 0},
		{"computed-receiver", `globalThis["Function"][("prototype")]`, 0},
		{"receiver-and-key-assertions", `(globalThis.Function as FunctionConstructor)[("prototype" as const)]`, 0},
		{"receiver-satisfies-and-template-key", "(globalThis[\"Function\"] satisfies FunctionConstructor)?.[(`prototype`)]", 0},
		{"literal-control", `globalThis.Function["prototype"]`, 0},
		{"property-control", `globalThis.Function.prototype`, 0},
		{"other-member-control", `globalThis.Function.name`, 1},
		{"alias-key-control", `globalThis.Function[literal]`, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `export function check(){const literal = "prototype" as const; return ` + tc.expression + `}`
			p, f, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
				if d.Source() == "EK" && d.Code() == 107 {
					count++
				}
			}
			if count != tc.want {
				t.Fatalf("EK0107 count %d, want %d: %s", count, tc.want, source)
			}
		})
	}
}
