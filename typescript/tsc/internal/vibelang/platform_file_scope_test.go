package vibelang

import (
	"strings"
	"testing"
)

// VIP-33: wrappers change failures, not permission to reach the host.
func TestPlatformHostFileScope(t *testing.T) {
	for _, source := range []string{
		"export effect function probe() { return try Effect.try(() => window.location.origin); }",
		"export effect function probe() { return try Effect.tryPromise(async () => document.title); }",
		`import { tryPromise } from "effect/Effect"; export effect function probe() { return try tryPromise(async () => document.title); }`,
		"export effect function probe() { return try sync(() => document.title); }",
		"export effect function probe() { return try callback<string>((resume) => { resume(Effect.succeed(window.location.origin)); }); }",
		"export effect function probe() { return try Effect.try({ try: () => window.location.origin, catch: (e) => e }); }",
		"export effect function probe() { return try Effect.try(() => (() => globalThis.window.location.origin)()); }",
		"export effect function probe() { return try Effect.try(() => globalThis[\"document\"].title); }",
	} {
		t.Run(source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK4402.Code {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing EK4402 for host reference inside wrapper: %s", source)
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
