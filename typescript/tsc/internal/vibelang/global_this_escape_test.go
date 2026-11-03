package vibelang

import "testing"

func TestGlobalThisEscapes(t *testing.T) {

	const source = `const key = "URL"
export const alias = globalThis
export const computed = globalThis[key]
export const { URL: Copied } = globalThis
export const passed = Reflect.get(globalThis, "URL")
export const spread = { ...globalThis }
export const member = "URL" in globalThis
export const kind = typeof globalThis
export const repeated = globalThis.globalThis
export const repeatedComputed = globalThis.globalThis[key]
export const shorthand = { globalThis }
export const direct = globalThis.URL
export const literal = globalThis["URL"]
export const optional = globalThis?.URL
export const nested = globalThis.globalThis.URL
export type Global = typeof globalThis
export type Constructor = typeof globalThis.URL
export function shadow(globalThis: { URL: string }): string { return globalThis.URL }
`
	program, _, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Source() != diagnosticSource || d.Code() != 107 {
			t.Errorf("unexpected diagnostic: %s", d.String())
		} else {
			count++
		}
	}
	if count != 10 {
		t.Fatalf("want ten EK0107 escapes, got %d", count)
	}
}

func TestGlobalThisStaticGrammar(t *testing.T) {
	for _, test := range []struct {
		name, source        string
		escapes, typescript int
	}{
		{"empty literal stays TypeScript's", "export const value = globalThis[\"\"]", 0, 1},
		{"numeric key is not a literal name", "export const value = globalThis[0]", 1, 0},
		{"parenthesized static", "export const value = (globalThis).URL", 0, 0},
		{"parenthesized copy", "export const value = (globalThis)", 1, 0},
		{"repeated literal object", "export const value = globalThis[\"globalThis\"].URL", 0, 0},
		{"copied repeated literal object", "export const value = globalThis[\"globalThis\"]", 1, 0},
		{"property name is not a read", "export const value = { globalThis: 1 }", 0, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, _, _, _ := editorProgram(t, test.source)
			escapes, ts := 0, 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
				if d.Source() == diagnosticSource && d.Code() == 107 {
					escapes++
				} else if d.Source() == "" {
					ts++
				} else {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if escapes != test.escapes || ts != test.typescript {
				t.Fatalf("got %d EK0107 and %d TypeScript errors, want %d and %d", escapes, ts, test.escapes, test.typescript)
			}
		})
	}
}
