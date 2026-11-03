package vibelangfuzz

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestAlchemyUnionPipeRequirementsQuoted(t *testing.T) {
	const quote = "TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
	unionPipeChapter(t)
}

// Alchemy's regression uses the runtime's pinned TypeScript 5.9.3 baseline,
// as its original migration did. The mapper pins 7.1, whose type-argument
// inference cache (#64553) introduced the regression already repaired here.
// Compare diagnostics, complete spans and output, including provider: B.
func FuzzAlchemyUnionPipeRequirements(f *testing.F) {
	startShortBudget(f)
	rows := []string{"original", "renamed-parameter", "renamed-provider", "renamed-requirements", "inline", "parenthesized", "annotated-error"}
	f.Add("original") // The keyed corpus covers every variant without duplicate short seeds.
	stock := alchemyUnionPipeStock(f)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestAlchemyUnionPipeRequirementsQuoted(t)
		if key == alchemyUnionPipeArchive {
			key = "original" // Retain the original migration archive corpus.
		}
		if !slices.Contains(rows, key) {
			if key == "" {
				return
			}
			key = rows[int(key[0])%len(rows)]
		}
		archive := alchemyUnionPipeArchive
		switch key {
		case "renamed-parameter":
			archive = strings.ReplaceAll(archive, "name", "label")
		case "renamed-provider":
			archive = strings.ReplaceAll(archive, "provider", "registered")
		case "renamed-requirements":
			archive = strings.NewReplacer("_A", "_Left", "_B", "_Right").Replace(archive)
		case "inline":
			archive = strings.Replace(archive, `  const configure = (name: string) => (name ? first : second).pipe(Effect.mapError(e => e))
  return { configure }`, `  return { configure: (name: string) => (name ? first : second).pipe(Effect.mapError(e => e)) }`, 1)
		case "parenthesized":
			archive = strings.ReplaceAll(archive, "(name ? first : second).pipe", "((name ? first : second)).pipe")
		case "annotated-error":
			archive = strings.ReplaceAll(archive, "e => e", "(e: E) => e")
		}
		// This target checks inference, not version-specific source-map metadata
		// (5.9 writes an empty sourceRoot that 7.1 omits).
		archive = strings.ReplaceAll(archive, `"sourceMap": true`, `"sourceMap": false`)
		CheckParity(t, w, stock, "FuzzAlchemyUnionPipeRequirements", archive)
	})
}

func alchemyUnionPipeStock(tb testing.TB) string {
	tb.Helper()
	modules := filepath.Join(Root(), "packages/runtime/node_modules")
	if got := packageVersion(filepath.Join(modules, "typescript")); got != "5.9.3" {
		Missing(tb, "Alchemy union inference requires TypeScript 5.9.3, got %q: run (cd packages/runtime && bun install)", got)
	}
	return filepath.Join(modules, ".bin/tsc")
}

const alchemyUnionPipeArchive = `-- main.ts --
import * as Effect from "effect/Effect"
// alchemy-25: packages/railway/src/AuthProvider.ts:109, minimized by drive-alchemy (nyc-02 repros/round3-auth-provider-types/minimal.ts).
interface A { readonly _A: unique symbol }
interface B { readonly _B: unique symbol }
type E = { readonly message: string }
type Config = { method: "x" } | { method: "y" }
interface Impl<C, R> { configure(name: string): Effect.Effect<C, E, R | A> }
declare const register: <C>() => <R = never, InitR = never>(impl: Impl<C,R> | Effect.Effect<Impl<C,R>,never,InitR>) => R | InitR
declare const first: Effect.Effect<{method:"x"}, E, A | B>
declare const second: Effect.Effect<Config, E, A>
export const provider = register<Config>()(Effect.gen(function* () {
  const configure = (name: string) => (name ? first : second).pipe(Effect.mapError(e => e))
  return { configure }
}))
-- tsconfig.json --
{
  "compilerOptions": {"declaration": true, "sourceMap": true, "strict": true, "target": "ESNext", "module": "Preserve", "moduleResolution": "Bundler", "skipLibCheck": true, "types": [], "outDir": "out"},
  "files": ["main.ts"]
}
`
