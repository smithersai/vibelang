package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

func TestAlchemyUnionPipeRequirementsQuoted(t *testing.T) {
	const quote = "TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
}

// Reuse the shared stock-TypeScript oracle. This target is restricted to the
// minimized Alchemy union/pipe/inferred-requirements defect, so its pending
// keys cannot excuse diagnostics or emission differences in unrelated TS.
func FuzzAlchemyUnionPipeRequirements(f *testing.F) {
	startShortBudget(f)
	rows := []string{"original", "renamed-parameter", "renamed-provider"}
	for _, key := range rows {
		f.Add(key)
	}
	stock := StockTypeScript(f)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestAlchemyUnionPipeRequirementsQuoted(t)
		if key == "-- main.ts --\nimport * as Effect from \"effect/Effect\"\n// alchemy-25: packages/railway/src/AuthProvider.ts:109, minimized by drive-alchemy (nyc-02 repros/round3-auth-provider-types/minimal.ts).\ninterface A { readonly _A: unique symbol }\ninterface B { readonly _B: unique symbol }\ntype E = { readonly message: string }\ntype Config = { method: \"x\" } | { method: \"y\" }\ninterface Impl<C, R> { configure(name: string): Effect.Effect<C, E, R | A> }\ndeclare const register: <C>() => <R = never, InitR = never>(impl: Impl<C,R> | Effect.Effect<Impl<C,R>,never,InitR>) => R | InitR\ndeclare const first: Effect.Effect<{method:\"x\"}, E, A | B>\ndeclare const second: Effect.Effect<Config, E, A>\nexport const provider = register<Config>()(Effect.gen(function* () {\n  const configure = (name: string) => (name ? first : second).pipe(Effect.mapError(e => e))\n  return { configure }\n}))\n-- tsconfig.json --\n{\n  \"compilerOptions\": {\"declaration\": true, \"sourceMap\": true, \"strict\": true, \"target\": \"ESNext\", \"module\": \"Preserve\", \"moduleResolution\": \"Bundler\", \"skipLibCheck\": true, \"types\": [], \"outDir\": \"out\"},\n  \"files\": [\"main.ts\"]\n}\n" {
			key = "original"
		}
		if !slices.Contains(rows, key) {
			if key == "" {
				return
			}
			key = rows[int(key[0])%len(rows)]
		}
		archive := "-- main.ts --\nimport * as Effect from \"effect/Effect\"\n// alchemy-25: packages/railway/src/AuthProvider.ts:109, minimized by drive-alchemy (nyc-02 repros/round3-auth-provider-types/minimal.ts).\ninterface A { readonly _A: unique symbol }\ninterface B { readonly _B: unique symbol }\ntype E = { readonly message: string }\ntype Config = { method: \"x\" } | { method: \"y\" }\ninterface Impl<C, R> { configure(name: string): Effect.Effect<C, E, R | A> }\ndeclare const register: <C>() => <R = never, InitR = never>(impl: Impl<C,R> | Effect.Effect<Impl<C,R>,never,InitR>) => R | InitR\ndeclare const first: Effect.Effect<{method:\"x\"}, E, A | B>\ndeclare const second: Effect.Effect<Config, E, A>\nexport const provider = register<Config>()(Effect.gen(function* () {\n  const configure = (name: string) => (name ? first : second).pipe(Effect.mapError(e => e))\n  return { configure }\n}))\n-- tsconfig.json --\n{\n  \"compilerOptions\": {\"declaration\": true, \"sourceMap\": true, \"strict\": true, \"target\": \"ESNext\", \"module\": \"Preserve\", \"moduleResolution\": \"Bundler\", \"skipLibCheck\": true, \"types\": [], \"outDir\": \"out\"},\n  \"files\": [\"main.ts\"]\n}\n"
		if key == "renamed-parameter" {
			archive = strings.ReplaceAll(archive, "name", "label")
		}
		if key == "renamed-provider" {
			archive = strings.ReplaceAll(archive, "provider", "registered")
		}
		CheckParity(t, w, stock, "FuzzAlchemyUnionPipeRequirements", archive)
	})
}
