package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// A provide block can own a lexical Scope as well as provide services. Lowering
// the Scope first used to discard its provider marker and emit an unprovided
// $region, even though the inferred contract removed the supplied requirements.
// The using binds null: an Effect without Scope must give a Disposable (D401).
func TestProvideBlockKeepsProviderWhenScoped(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		body   string
		scoped bool
	}{
		{body: "using value = null; return 1", scoped: true},
		{body: "const child = fork Effect.succeed(1); return 1", scoped: false},
	} {
		t.Run(test.body, func(t *testing.T) {
			t.Parallel()
			files := computedKeyFiles(false)
			base := "/workspace/x/src/node_modules/"
			files[base+"effect/Effect.d.ts"] += `
export declare function succeed<A>(value: A): Effect<A>
`
			// Operand assignability locates the pinned Effect interface by its real dist path.
			files[base+"effect/dist/Effect.d.ts"] = files[base+"effect/Effect.d.ts"]
			delete(files, base+"effect/Effect.d.ts")
			files[base+"effect/package.json"] = strings.ReplaceAll(files[base+"effect/package.json"], "./Effect.d.ts", "./dist/Effect.d.ts")
			files[base+"effect/index.d.ts"] = strings.ReplaceAll(files[base+"effect/index.d.ts"], "./Effect.js", "./dist/Effect.js")
			files[base+"vibelang-runtime/index.d.ts"] += `
export declare function fork<A, E, R>(program: import("effect/Effect").Effect<A, E, R>): import("effect/Effect").Effect<unknown, never, R>
`
			files["/workspace/x/src/main.vibe"] = `
import { provider } from "./provider.js"
export effect function example() { provide provider { ` + test.body + ` } }
`
			// Provider channels have the same variance structure as Effect's Layer.
			files["/workspace/x/src/provider.d.ts"] = `
export declare const provider: { readonly "~effect/Layer": {
  readonly _ROut: (_: never) => void
  readonly _E: (_: never) => never
  readonly _RIn: (_: never) => never
} }
`
			p := computedKeyProgram(t, files)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("source: %s", d.String())
				}
			}
			var js string
			p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
				if strings.HasSuffix(string(name), "main.js") {
					js = text
				}
				return nil
			}})
			if !strings.Contains(js, ".provide(") || !strings.Contains(js, ", provider)") {
				t.Fatalf("provide must retain its supplied services:\n%s", js)
			}
			if got := strings.Contains(js, ".$region("); got != test.scoped {
				t.Fatalf("resource Scope present=%v, want %v; fork stays with the parent fiber:\n%s", got, test.scoped, js)
			}
			if !test.scoped && !strings.Contains(js, ".forkChild(") {
				t.Fatalf("keyword fork lost its current-fiber owner:\n%s", js)
			}
		})
	}
}
