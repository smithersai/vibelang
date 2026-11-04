package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const nativeGeneratorsTarget = "FuzzNativeGenerators"

func nativeGeneratorsChapter(t testing.TB) {
	for _, rule := range []struct{ chapter, quote string }{
		{"../vips/0021-producers.md", "A plain \x60function*\x60 stays a JavaScript generator."},
		{"003-failures.md", "| any other \x60.vibe\x60 code | a compile error, \x60EK0401\x60 ([Plain code never throws](#plain-code-never-throws)) |"},
		{"003-failures.md", "an \x60async\x60 generator's body"},
		{"004-match.md", "and in any other \x60.vibe\x60 code it is \x60EK0401\x60"},
	} {
		text, err := os.ReadFile(SpecPath(rule.chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), rule.quote) {
			t.Fatalf("%s no longer says %q", rule.chapter, rule.quote)
		}
	}
}
func TestNativeGeneratorsQuoted(t *testing.T) { nativeGeneratorsChapter(t) }
func FuzzNativeGenerators(f *testing.F) {
	startShortBudget(f)
	nativeGeneratorsChapter(f)
	keys := []string{"declaration", "expression", "effect-gen", "effect-gen-named", "option-gen", "async", "annotated", "examples-pipeline", "examples-file-tree", "generator-argument", "computed-method"}
	bodies := []string{
		"export function* values() { yield 1; return 3 }\nexport const result = [...values()]",
		"export const values = function* named() { yield 1; return 3 }; export const result = [...values()]",
		"export const result = Effect.gen(function* () { return yield* Effect.succeed(7) })",
		"function* body() { return yield* Effect.succeed(7) }; export const result = Effect.gen(body)",
		"export const result = Option.gen(function* () { return yield* Option.some(7) })",
		"export async function* values() { yield 1; return 3 }",
		"export function* values(): Generator<number,number,unknown> { yield 1; return 3 }",
		"function* readings() { for (const celsius of [18,21,25]) yield celsius }; export const result = [...readings()]",
		"function* walk() { const files = [\"a\",\"b\"]; for (const file of files) yield file }; export const result = [...walk()]",
		"let made = 0; const makeGenerator = () => { made++; return function* () { yield* []; return 7 } }; export const result = Effect.gen(makeGenerator())",
		"const key = \"run\"; export class Worker { [key]() { return Effect.gen(function* () { return 1 }) } }",
	}
	keys = append(keys, "match-throw-plain", "match-throw-async")
	bodies = append(bodies,
		"export function* values() { return match (true) { default: throw \"bad\"; } }",
		"export async function* values() { return match (true) { default: throw \"bad\"; } }",
	)
	for _, key := range keys {
		f.Add([]byte(key))
		f.Add([]byte(key + ":trivia"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input []byte) {
		key, suffix, _ := strings.Cut(string(input), ":")
		n := 0
		if len(input) > 0 {
			n = int(input[0]) % len(keys)
		}
		for i, k := range keys {
			if k == key {
				n = i
				break
			}
		}
		for _, native := range []bool{true, false} {
			body := bodies[n]
			if native && keys[n] == "match-throw-plain" {
				body = "export function* values() { switch (true) { default: throw \"bad\"; } }"
			} else if native && keys[n] == "match-throw-async" {
				body = "export async function* values() { switch (true) { default: throw \"bad\"; } }"
			}
			if suffix == "trivia" {
				body = strings.ReplaceAll(body, "function*", "function /*native*/ *")
			}
			source := "import { Effect, Option } from \"effect\";\n" + body
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			var result *Result
			var err error
			within(t, "native generator admission", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if !native && keys[n] == "match-throw-plain" {
				errors, forbidden := 0, 0
				for _, d := range result.Diagnostics {
					if d.Category() == diagnostics.CategoryError {
						errors++
						if d.Code() == 401 {
							forbidden++
						}
					}
				}
				if errors != 1 || forbidden != 1 {
					Gap(t, nativeGeneratorsTarget, keys[n], "VIP-4/7: a plain generator's match throw needs exactly EK0401: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
				}
				continue
			}
			if HasError(result.Diagnostics) {
				if native {
					t.Fatalf("invalid TypeScript control: %v", SortedKeys(Keys(result.Dir, result.Diagnostics)))
				}
				Gap(t, nativeGeneratorsTarget, keys[n], "VIP-21 plain generator must keep native TypeScript admission: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
		}
	})
}
