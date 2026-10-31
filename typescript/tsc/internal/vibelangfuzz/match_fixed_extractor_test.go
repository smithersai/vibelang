package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const fixedExtractorTarget = "FuzzMatchFixedExtractorTypes"

var fixedExtractorQuotes = []string{
	"A `let` binding has the type TypeScript gives the value it is bound to in the counterpart.",
	"| fixed `Option.Some(let v)` | `Option.isOption(s) && Option.isSome(s)` | `v`: `A` for `Option<A>`; `unknown` for an `unknown` subject |",
	"| fixed `Exit.Failure(let c)`, `Result.Success(let v)` | the module guards ([Retained fixed patterns](#retained-fixed-patterns)) | `c`: `Cause.Cause<E>`; `v`: `A` |",
}

func TestMatchFixedExtractorTypesQuoted(t *testing.T) {
	chapter := SpecText("004-match.md")
	for _, quote := range fixedExtractorQuotes {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Chapter 4 no longer says %q", quote)
		}
	}
}

type fixedExtractorRule struct{ key, imports, subject, pattern, result string }

var fixedExtractorRules = []fixedExtractorRule{
	{"option", "import { Option } from \"effect\"", "Option.Option<A>", "Option.Some", "A"},
	{"option-alias", "import { Option as O } from \"effect\"", "O.Option<A>", "O.Some", "A"},
	{"option-submodule", "import * as O from \"effect/Option\"", "O.Option<A>", "O.Some", "A"},
	{"exit-success", "import { Exit } from \"effect\"", "Exit.Exit<A, E>", "Exit.Success", "A"},
	{"exit-failure", "import { Exit, Cause } from \"effect\"", "Exit.Exit<A, E>", "Exit.Failure", "Cause.Cause<E>"},
	{"result-success", "import { Result } from \"effect\"", "Result.Result<A, E>", "Result.Success", "A"},
	{"result-failure", "import { Result } from \"effect\"", "Result.Result<E, A>", "Result.Failure", "A"},
}

// VIP-7 binds the successful extractor's actual value, including its position
// and presence. noUncheckedIndexedAccess must not add undefined. Vary generic,
// object, union and genuinely optional payloads, binding kind and plain/effect
// contexts. Foldkit's minimized generic witness is a named, keyed corpus seed.
func FuzzMatchFixedExtractorTypes(f *testing.F) {
	startShortBudget(f)
	for _, rule := range fixedExtractorRules {
		f.Add(rule.key, uint8(0))
		f.Add(rule.key, uint8(5))
		f.Add(rule.key, uint8(11))
	}
	foldkit, err := os.ReadFile(filepath.Join("testdata", "match-fixed-extractors", "foldkit-option-extractor-undefined.vibe"))
	if err != nil {
		f.Fatal(err)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestMatchFixedExtractorTypesQuoted(t)
		foldkitSeed := key == "foldkit-option"
		if foldkitSeed {
			key = "option"
		}
		i := slices.IndexFunc(fixedExtractorRules, func(r fixedExtractorRule) bool { return r.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(fixedExtractorRules)
		}
		rule := fixedExtractorRules[i]
		typ := []string{"A", "{ readonly count: number }", "number | string", "number | undefined"}[int(variant)%4]
		subject := strings.ReplaceAll(rule.subject, "<A>", "<"+typ+">")
		subject = strings.ReplaceAll(subject, "<A, E>", "<"+typ+", E>")
		subject = strings.ReplaceAll(subject, "<E, A>", "<E, "+typ+">")
		resultType := strings.ReplaceAll(rule.result, "A", typ)
		binding := "let"
		if variant&4 != 0 {
			binding = "const"
		}
		use := "value"
		if variant%4 == 1 && rule.result == "A" {
			resultType, use = "number", "value.count"
		}
		prefix, annotation := "", resultType
		if variant&8 != 0 {
			// VIP-3 requires explicit grouping when the payload is a union.
			prefix, annotation = "effect ", "("+resultType+")!!"
		}
		source := fmt.Sprintf("%s\nexport %sfunction read<A, E>(input: %s, fallback: %s): %s {\n  return match (input) { when %s(%s value): %s; default: fallback; }\n}\n",
			rule.imports, prefix, subject, resultType, annotation, rule.pattern, binding, use)
		// A real undefined payload must survive extraction: using it as number
		// is an error. This also catches an unused @ts-expect-error (TS2578)
		// if a future extraction incorrectly removes undefined.
		if variant%4 == 3 && rule.result == "A" {
			source = strings.Replace(source, ": value;", ": do {\n// @ts-expect-error: the payload may itself be undefined\nconst required: number = value;\nvalue; };", 1)
		}
		if foldkitSeed && variant == 0 {
			source = string(foldkit)
		}
		config := strings.Replace(DefaultConfig, "\"strict\": true,", "\"strict\": true,\n    \"noUncheckedIndexedAccess\": true,", 1)
		var result *Result
		var err error
		within(t, "compile", func() {
			result, err = w.Compile(t.Context(), Project{Config: config, Files: map[string]string{"main.vibe": source}})
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		gapKey := fmt.Sprintf("binding:%s:%d", rule.key, variant%16)
		if HasError(result.Diagnostics) {
			Gap(t, fixedExtractorTarget, gapKey, "VIP-7: %s; successful extraction must preserve its payload type under noUncheckedIndexedAccess; got %v\n%s",
				fixedExtractorQuotes[0], Keys(result.Dir, result.Diagnostics), source)
		}
		ExpectPending(t, fixedExtractorTarget, gapKey)
		ExpectPending(t, fixedExtractorTarget, specCorpusKey(t))
	})
}
