package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const reviewProducerScopeTarget = "FuzzReviewProducerScope"
const reviewProducerScopeHelper = "import { Context, Effect, Stream, Scope } from \"effect\"; export class Token extends Context.Service<Token, { readonly value: number }>()(\"Token\") {}; export declare const getValue: Effect.Effect<number, never, Token>; export declare const foreign: Stream.Stream<number, never, Scope.Scope>;\n"

type reviewProducerScopeRule struct {
	key, source string
	reject      bool
}

func reviewProducerScopeRules() []reviewProducerScopeRule {
	var rules []reviewProducerScopeRule
	for _, service := range []bool{false, true} {
		env, scoped, read, tag := "never", "Scope.Scope", "const n = 1;", "0"
		if service {
			env, scoped, read, tag = "Token", "Scope.Scope | Token", "const n = try getValue;", "1"
		}
		for _, operation := range []struct{ name, body string }{
			{"scope", "try Effect.scope;"},
			{"finalizer", "try Effect.addFinalizer(() => Effect.void);"},
		} {
			head := "import { Effect, Scope, Stream } from \"effect\"; import { Token, getValue, foreign } from \"./lib.js\";\n"
			add := func(context, program string, reject bool) {
				rules = append(rules, reviewProducerScopeRule{context + ":" + operation.name + ":" + tag, head + program + "\n", reject})
			}
			add("inferred", "effect function* values() { "+operation.body+read+" yield n }\nconst checked: Stream.Stream<number, never, "+env+"> = values();", false)
			add("written", "effect function* values(): Stream.Stream<number, never, "+scoped+"> { "+operation.body+read+" yield n }\nconst checked: Stream.Stream<number, never, "+scoped+"> = values();", false)
			add("effect-keeps-scope", "effect function values() { "+operation.body+read+" return n }\nconst checked: Effect.Effect<number, never, "+env+"> = values();", true)
		}
	}
	rules = append(rules, reviewProducerScopeRule{"foreign-keeps-scope", "import { Stream } from \"effect\"; import { foreign } from \"./lib.js\"; const checked: Stream.Stream<number, never, never> = foreign;\n", true})
	return rules
}

func TestReviewProducerScopeQuoted(t *testing.T) {
	for chapter, quotes := range map[string][]string{
		"002-running.md":   {"It compiles to `Stream.callback`", "A written `Stream.Stream<A, E, R>` return contract checks each `yield x` against `A`"},
		"001-functions.md": {"**Producer environments.** An inferred producer declaration exposes the environment `Exclude<RBody, Scope.Scope>` for its body requirements `RBody`, because the accepted `Stream.callback` provides `Scope`."},
	} {
		for _, quote := range quotes {
			if !strings.Contains(SpecText(chapter), quote) {
				t.Fatalf("%s no longer says %q", chapter, quote)
			}
		}
	}
}

// ASTRA-3 / detail225: the callback supplies Scope internally, so inferred
// Stream requirements exclude Scope while keeping every other service.
// Explicit annotations and ordinary Effect/foreign Stream requirements keep
// their own types. These are static admission tests, not a runtime oracle.
func FuzzReviewProducerScope(f *testing.F) {
	// Spec rule: docs/design/src/001-functions.md#f731202ef7a4c502
	// Chapter 001: inferred producer strips body Scope but preserves other services, explicit annotations and Scope values (FuzzReviewProducerScope).

	// Spec rule: docs/design/src/001-functions.md#4d8bfa513b8c716a
	// Chapter 001: inferred producer strips body Scope but preserves other services, explicit annotations and Scope values (FuzzReviewProducerScope).

	startShortBudget(f)
	rules := reviewProducerScopeRules()
	for _, rule := range rules {
		f.Add(rule.key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestReviewProducerScopeQuoted(t)
		index := slices.IndexFunc(rules, func(rule reviewProducerScopeRule) bool { return rule.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rules)
		}
		rule := rules[index]
		var result *Result
		var err error
		within(t, "check producer scope", func() {
			result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": rule.source, "lib.ts": reviewProducerScopeHelper}})
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var codes []int32
		for _, d := range result.Diagnostics {
			if d.Category().Name() == "error" {
				codes = append(codes, d.Code())
			}
		}
		key = "scope:" + rule.key
		if rule.reject {
			if len(codes) != 1 || codes[0] != 2322 {
				Gap(t, reviewProducerScopeTarget, key, "ordinary Effect/foreign Stream controls must retain Scope and reject the unscoped assignment with TS2322; got %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), rule.source)
			}
		} else if len(codes) > 0 {
			Gap(t, reviewProducerScopeTarget, key, "Chapter 2 uses Stream.callback; detail225 excludes internally supplied Scope from inferred producers, preserving other requirements and written annotations; got %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), rule.source)
		}
		if strings.HasPrefix(rule.key, "written:") && len(codes) == 0 {
			env := "never"
			if strings.HasSuffix(rule.key, ":1") {
				env = "Token"
			}
			source := rule.source + "\nconst lostScope: Stream.Stream<number, never, " + env + "> = values();\n"
			var checked *Result
			within(t, "check written Scope retention", func() {
				checked, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "lib.ts": reviewProducerScopeHelper}})
			})
			if err != nil {
				t.Fatal(err)
			}
			var errors []int32
			for _, d := range checked.Diagnostics {
				if d.Category().Name() == "error" {
					errors = append(errors, d.Code())
				}
			}
			diagnostics := SortedKeys(Keys(checked.Dir, checked.Diagnostics))
			checked.Remove()
			if len(errors) != 1 || errors[0] != 2322 {
				Gap(t, reviewProducerScopeTarget, "written-retention:"+rule.key, "detail225 preserves written requirements: assigning the explicitly scoped producer to an unscoped Stream must report TS2322; got %v\n%s", diagnostics, source)
			}
		}
		ExpectPending(t, reviewProducerScopeTarget, key)
		ExpectPending(t, reviewProducerScopeTarget, specCorpusKey(t))
	})
}
