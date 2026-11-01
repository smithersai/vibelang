package vibelangfuzz

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

const migrationDefaultProgramTarget = "FuzzMigrationDefaultPrograms"
const migrationDefaultProgramQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func TestMigrationDefaultProgramsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), migrationDefaultProgramQuote) {
		t.Fatalf("Chapter 1 no longer says %q", migrationDefaultProgramQuote)
	}
}

// A migration rewrites each Effect TypeScript program form to its VibeLang
// form. Exported as `export default` or as a named const, the rewrite must
// declare what stock TypeScript declares for the original. t3code's server
// migrations default-export a program, `export default Effect.gen(function*
// () { … })`; its rewrite `export default effect { … }` declared
// `declare function _default(): void` (t3code agent 03:10Z: 47 of 50 modules
// of the first server slice). The oracle is stock tsc's declaration of the
// original under the migration gate's own comparison.
type migrationDefaultProgramForm struct{ key, ts, vibe string }

func migrationDefaultProgramForms() []migrationDefaultProgramForm {
	return []migrationDefaultProgramForm{
		{"block", "Effect.gen(function* () {\n%s\n})", "effect {\n%s\n}"},
		{"parenthesized-block", "(Effect.gen(function* () {\n%s\n}))", "(effect {\n%s\n})"},
		{"function", "(n: number) => Effect.gen(function* () {\n%s\n})", "effect (n: number) => {\n%s\n}"},
		// A pipeline stays inside the block: a module's top level runs nothing (EK1001).
		{"pipeline", "Effect.gen(function* () {\n%s\n}).pipe(Effect.withSpan(\"load\"))", "effect {\nreturn try (effect {\n%s\n}).pipe(Effect.withSpan(\"load\"))\n}"},
	}
}

// migrationDefaultProgramBodies are generator bodies; a body's VibeLang form
// writes `try` for each `yield*`.
var migrationDefaultProgramBodies = []string{
	`yield* Effect.sleep("1 millis")`,
	"yield* Effect.sleep(\"1 millis\")\nreturn 1",
	"if (Math.random() > 2) {\n  yield* Effect.fail(new Error(\"boom\"))\n}\nreturn \"done\"",
	"const value = yield* Effect.succeed({ id: 1, tags: [\"a\"] })\nreturn value.tags",
}

// Words whose meaning differs between a generator body and an effect body, or
// that the textual yield* to try rewrite cannot carry.
var migrationDefaultProgramForeign = regexp.MustCompile(`\b(try|catch|yield|function|this|arguments|async|await)\b`)

func FuzzMigrationDefaultPrograms(f *testing.F) {
	startShortBudget(f)
	forms := migrationDefaultProgramForms()
	for _, form := range forms {
		for _, body := range migrationDefaultProgramBodies {
			f.Add(form.key, body, false)
			f.Add(form.key, body, true)
		}
	}
	tsc := StockTypeScript(f)
	api := declarationIdentityAPI(f)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key, body string, named bool) {
		TestMigrationDefaultProgramsQuoted(t)
		i := slices.IndexFunc(forms, func(form migrationDefaultProgramForm) bool { return form.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(forms)
		}
		form := forms[i]
		if len(body) > 4<<10 || migrationDefaultProgramForeign.MatchString(strings.ReplaceAll(body, "yield* ", "")) {
			return
		}
		known := slices.Contains(migrationDefaultProgramBodies, body)
		indent := func(text string) string { return "  " + strings.ReplaceAll(text, "\n", "\n  ") }
		export := "export default "
		if named {
			export = "export const load = "
		}
		const imports = "import * as Effect from \"effect/Effect\"\n"
		original := imports + export + fmt.Sprintf(form.ts, indent(body)) + "\n"
		migrated := imports + export + fmt.Sprintf(form.vibe, indent(strings.ReplaceAll(body, "yield* ", "try "))) + "\n"
		position := map[bool]string{false: "default", true: "named"}[named]
		gapKey := "declaration:" + form.key + ":" + position
		if !known {
			gapKey += fmt.Sprintf(":%x", sha256.Sum256([]byte(body)))
		}

		dir := emitDeclarationIdentityStock(t, w, tsc, Project{Files: map[string]string{"main.ts": original, "package.json": `{"type":"module"}`}})
		defer os.RemoveAll(dir)
		var result *Result
		var err error
		within(t, "compile", func() {
			result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": migrated, "package.json": `{"type":"module"}`}})
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		if HasError(result.Diagnostics) {
			if !known {
				t.Skip("the migrated body is no VibeLang program")
			}
			t.Fatalf("migrated witness must compile: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), migrated)
		}
		current := filepath.Join(result.Dir, "__default_current")
		for name, text := range result.Outputs {
			if rel, ok := strings.CutPrefix(name, "out/"); ok && isDeclaration(name) {
				if err := writeInside(current, rel, text); err != nil {
					t.Fatal(err)
				}
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
		defer cancel()
		diff, err := compareIdentityDeclarations(ctx, api, filepath.Join(dir, "out"), current)
		if err != nil {
			t.Fatal(err)
		}
		if diff != "" {
			Gap(t, migrationDefaultProgramTarget, gapKey, "Chapter 1: %q; stock tsc's declaration of the original (-) and of its VibeLang form (+) differ:\n%s\noriginal:\n%s\nmigrated:\n%s", migrationDefaultProgramQuote, diff, original, migrated)
		}
		ExpectPending(t, migrationDefaultProgramTarget, gapKey)
		ExpectPending(t, migrationDefaultProgramTarget, specCorpusKey(t))
	})
}
