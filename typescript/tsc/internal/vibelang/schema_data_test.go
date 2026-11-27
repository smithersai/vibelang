package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaDataDeclarations(t *testing.T) {
	packages := map[string]string{
		"effect":           "packages/runtime/node_modules/effect",
		"vibelang-runtime": "packages/runtime",
	}
	opts := `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true}`
	source := `
export schema Address { readonly city: string }
export schema data Delivery {
  Waiting
  Sent { readonly tracking: string; note?: string; address: Address }
}

export function describe(d: Delivery): string {
  return match (d) {
    when { _tag: "Waiting" }: "waiting";
    when { _tag: "Sent", let tracking, let address }: tracking + ":" + address.city;
  }
}

export effect function decode(u: unknown) { return try Schema.decodeUnknownEffect(Delivery)(u) }
`
	program, file, _, _ := editorProgramAt(t, "main.vibe", opts, source, editorPackageJSON, packages)
	all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
	for _, d := range all {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("unexpected diagnostic %s%d: %s", d.Source(), d.Code(), d.MessageText())
		}
	}
}

func TestSchemaDataExhaustivenessAndDiagnostics(t *testing.T) {
	packages := map[string]string{
		"effect":           "packages/runtime/node_modules/effect",
		"vibelang-runtime": "packages/runtime",
	}
	opts := `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]}`
	cases := []struct {
		name   string
		source string
		want   int32
	}{
		{
			name:   "missing-match-variant",
			source: "export schema data Shape { Empty; Circle { radius: number } }\nexport function area(s: Shape): number { return match (s) { when { _tag: \"Empty\" }: 0; } }\n",
			want:   4701,
		},
		{
			name:   "reserved-tag-field",
			source: "export schema data Bad { A { _tag: string } }\n",
			want:   1601,
		},
		{
			name:   "missing-body",
			source: "export schema data Missing\n",
			want:   1604,
		},
		{
			name:   "parenthesized-payload",
			source: "export schema data Bad { A(x: number) }\n",
			want:   1606,
		},
		{
			name:   "type-parameters",
			source: "export schema data Bad<T> { A { x: T } }\n",
			want:   1502,
		},
		{
			name:   "non-field-member",
			source: "export schema data Bad { A { run(): void } }\n",
			want:   1505,
		},
		{
			name:   "ambient-schema-data",
			source: "declare schema data Ambient { A }\nexport {}\n",
			want:   1506,
		},
		{
			name:   "default-export-rejected",
			source: "export default schema data Bad { A }\n",
			want:   1603,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgramAt(t, "main.vibe", opts, tc.source, editorPackageJSON, packages)
			all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			found := false
			for _, d := range all {
				if d.Source() == "EK" && d.Code() == tc.want {
					found = true
				}
			}
			if !found {
				var got []string
				for _, d := range all {
					got = append(got, d.Source()+string(rune('0'))+" "+d.MessageText())
				}
				t.Fatalf("expected EK%d, got %d diagnostics: %v", tc.want, len(all), all)
			}
		})
	}
}

func TestSchemaNamedDataStillWorks(t *testing.T) {
	packages := map[string]string{
		"effect":           "packages/runtime/node_modules/effect",
		"vibelang-runtime": "packages/runtime",
	}
	opts := `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]}`
	source := "export schema data { id: string }\nexport const x: data = { id: \"ok\" }\n"
	program, file, _, _ := editorProgramAt(t, "main.vibe", opts, source, editorPackageJSON, packages)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("unexpected diagnostic %s%d: %s", d.Source(), d.Code(), d.MessageText())
		}
	}
	if !strings.Contains(source, "schema data {") {
		t.Fatal("sanity")
	}
}
