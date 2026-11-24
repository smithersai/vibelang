package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Pin the category at formerly accepted platform boundaries and ordinary calls.
func TestPlatformHostFileScope(t *testing.T) {
	for _, test := range []struct {
		source   string
		category diagnostics.Category
	}{
		{"export effect function probe() { return try Effect.try(() => window.location.origin); }", warningCategory},
		{"export effect function probe() { return try Effect.tryPromise(async () => document.title); }", warningCategory},
		{`import { tryPromise } from "effect/Effect"; export effect function probe() { return try tryPromise(async () => document.title); }`, errorCategory},
		{"export effect function probe() { return try sync(() => document.title); }", warningCategory},
		{"export effect function probe() { return try callback<string>((resume) => { resume(Effect.succeed(window.location.origin)); }); }", warningCategory},
		{"export effect function probe() { return try Effect.try({ try: () => window.location.origin, catch: (e) => e }); }", warningCategory},
		{"export effect function probe() { return try Effect.try(() => (() => globalThis.window.location.origin)()); }", warningCategory},
		{"export effect function probe() { return try Effect.try(() => globalThis[\"document\"].title); }", warningCategory},
	} {
		t.Run(test.source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, test.source)
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK4402.Code {
					found = true
					if d.Category() != test.category {
						t.Errorf("EK4402 category = %v, want %v: %s", d.Category(), test.category, d.String())
					}
				}
			}
			if !found {
				t.Fatalf("missing EK4402 for host reference inside wrapper: %s", test.source)
			}
		})
	}
}

func TestPlatformHostFileScopeShadowsAndTypes(t *testing.T) {
	source := "export effect function probe() { const window = { location: { origin: \"local\" } }; return try Effect.try(() => window.location.origin); }\nexport type Host = typeof globalThis.window;\n"
	p, file, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK4402.Code {
			t.Fatalf("local/type reference rejected: %s", strings.TrimSpace(d.String()))
		}
	}
}
