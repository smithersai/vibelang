package vibelang

import "testing"

// A key header with a definite marker and no initializer gets the key rule
// alone: EK0901 explains the header to write, so TypeScript's TS1255 for the
// marker adds nothing. A header with an initializer keeps the marker rule. A
// static index signature is one rejected member, without TS2411 on the key,
// and a key with neither initializer nor type gets no TS7008.
func TestServiceKeyDefiniteMarkerReportedOnce(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		code         int32
	}{
		{"body", "export service S {\n static readonly key!: string\n n: number\n}\n", 901},
		{"whole shape", "type Shape = { n: number }\nexport service S: Shape {\n static readonly key!: string\n}\n", 901},
		{"optional marker", "export service S {\n static readonly key?: string\n n: number\n}\n", 901},
		{"marker with initializer", "export service S {\n static readonly key!: string = \"marker/S\"\n n: number\n}\n", 902},
		{"no initializer or type", "export service S {\n static readonly key\n n: number\n}\n", 901},
		{"no readonly, initializer or type", "export service S {\n static key\n n: number\n}\n", 901},
		{"whole shape without initializer", "type Shape = { n: number }\nexport service S: Shape {\n static readonly key\n}\n", 901},
		{"static index signature", "export service S {\n static readonly key = \"marker/S\"\n static [k: string]: number\n n: number\n}\n", 902},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != diagnosticSource || d.Code() != tc.code {
					t.Errorf("unexpected diagnostic: %s", d.String())
				} else {
					count++
				}
			}
			if count != 1 {
				t.Fatalf("want one EK%04d, got %d", tc.code, count)
			}
		})
	}
}
