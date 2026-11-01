package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const migrationAssertedColdTarget = "FuzzMigrationAssertedCold"
const migrationAssertedColdQuote = "A function's kind is decided by a keyword on the function, never by its body or by a type."
const migrationPlainColdQuote = "| plain | `function f() { }`, `() => …` | its result, as in TypeScript | TypeScript |"

func TestMigrationAssertedColdQuoted(t *testing.T) {
	for _, quote := range []string{migrationAssertedColdQuote, migrationPlainColdQuote} {
		if !strings.Contains(SpecText("001-functions.md"), quote) {
			t.Fatalf("Chapter1 no longer says %q", quote)
		}
	}
}

func migrationAssertedColdPrograms() map[string][2]string {
	pairs := map[string][2]string{}
	native := func(source string) string {
		return "import {Effect} from \"effect\";\n" + strings.NewReplacer("number!E", "Effect.Effect<number,E>", "string!E", "Effect.Effect<string,E>").Replace(source)
	}
	original := "export const viaCast = <E>(e: number!E): { effect: string!E } => {\n  return { effect: Effect.map(e, (n) => String(n)) } as unknown as { effect: string!E }\n}\n"
	pairs["foldkit-asserted-cold-values"] = [2]string{original, native(original)}
	for _, home := range []string{"arrow", "function", "method"} {
		for _, cast := range []string{"none", "unknown", "satisfies", "parenthesized"} {
			for _, shape := range []string{"object", "array", "nested"} {
				typ := map[string]string{"object": "{effect: string!E}", "array": "ReadonlyArray<string!E>", "nested": "{nested: {effect: string!E}}"}[shape]
				effect := "Effect.map(e, (n: number) => String(n))"
				expression := map[string]string{"object": "{effect: " + effect + "}", "array": "[" + effect + "]", "nested": "{nested: {effect: " + effect + "}}"}[shape]
				switch cast {
				case "unknown":
					expression += " as unknown as " + typ
				case "satisfies":
					expression = "(" + expression + " satisfies " + typ + ")"
				case "parenthesized":
					expression = "((" + expression + ") as unknown) as " + typ
				}
				body := "{return " + expression + ";}\n"
				source := ""
				switch home {
				case "arrow":
					source = "export const build = <E>(e: number!E): " + typ + " => " + body
				case "function":
					source = "export function build<E>(e: number!E): " + typ + " " + body
				case "method":
					source = "export const factory = {build<E>(e: number!E): " + typ + " " + body + "};\n"
				}
				pairs[home+":"+cast+":"+shape] = [2]string{source, native(source)}
			}
		}
	}
	return pairs
}

// Foldkit-2: casts and container contexts never turn a plain function into
// an Effect runner. The .ts counterpart checks all generic/result controls.
func FuzzMigrationAssertedCold(f *testing.F) {
	startShortBudget(f)
	pairs := migrationAssertedColdPrograms()
	keys := make([]string, 0, len(pairs))
	for key := range pairs {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationAssertedColdQuoted(t)
		if _, ok := pairs[key]; !ok {
			if len(key) == 0 {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		pair := pairs[key]
		for _, index := range []int{1, 0} {
			file := "main.vibe"
			if index == 1 {
				file = "control.ts"
			}
			var result *Result
			var err error
			within(t, "check asserted cold Effect value", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: pair[index]}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				if index == 1 {
					t.Fatalf("invalid generic/container control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), pair[index])
				}
				Gap(t, migrationAssertedColdTarget, key, "VIP1 keyword decides plain callable despite casts; diagnostics=%v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), pair[index])
			}
		}
		ExpectPending(t, migrationAssertedColdTarget, key)
		ExpectPending(t, migrationAssertedColdTarget, specCorpusKey(t))
	})
}
