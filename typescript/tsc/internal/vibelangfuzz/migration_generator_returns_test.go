package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const migrationGeneratorTarget = "FuzzMigrationGeneratorReturns"
const migrationGeneratorQuote = "| `return value` in a producer, `effect function* p() { return 1 }` (a bare `return` is allowed and ends the stream) | `EK2128` |"

// A migration renames Effect TypeScript to .vibe, where a function* passed to
// a generator API keeps its return value: it is no producer, which chapter 2
// writes effect function*, so EK2128 and its fix, which drops the value, never
// apply to it. drive-t3code's Effect.fn("load")(function* …, Effect.orElse…)
// lost its return value to that fix when the pipeline argument failed overload
// resolution. The oracle reads the chapter only; it does not ask the compiler
// which diagnostic replaces EK2128.
type migrationGeneratorRule struct{ key, call string }

func migrationGeneratorRules() []migrationGeneratorRule {
	return []migrationGeneratorRule{
		{"effect-gen", "Effect.gen(%s)"},
		{"effect-fn-named", "Effect.fn(\"load\")(%s%s)"},
		{"effect-fn", "Effect.fn(%s%s)"},
		{"option-gen", "Option.gen(%s)"},
	}
}

func TestMigrationGeneratorReturnsQuoted(t *testing.T) {
	if chapter := SpecText("002-running.md"); !strings.Contains(chapter, migrationGeneratorQuote) {
		t.Fatalf("Chapter 2 no longer says %q", migrationGeneratorQuote)
	}
}

// pipelines are Effect.fn's pipeline arguments; the variant picks how many.
var migrationGeneratorPipelines = []string{
	"",
	", Effect.orElseSucceed(() => Option.none<number>())",
	", Effect.map((x) => x), Effect.orElseSucceed(() => Option.none<number>())",
}

func checkMigrationGeneratorReturn(t *testing.T, w *Workspace, rule migrationGeneratorRule, variant uint8) {
	t.Helper()
	TestMigrationGeneratorReturnsQuoted(t)
	pipeline := migrationGeneratorPipelines[int(variant)%len(migrationGeneratorPipelines)]
	yield, value := "yield* Effect.void", "n ? Option.some(n) : Option.none<number>()"
	if rule.key == "option-gen" {
		yield, value = "yield* Option.some(1)", "Option.some(n)"
	}
	generator := "function* (" + map[bool]string{true: "", false: "n: number"}[strings.HasSuffix(rule.key, "-gen")] + ") {\n  " + yield + "\n  return " + value + "\n}"
	if strings.HasSuffix(rule.key, "-gen") {
		generator = strings.Replace(generator, "return "+value, "const n = 1\n  return "+value, 1)
	}
	var call string
	if strings.Count(rule.call, "%s") == 2 {
		call = fmt.Sprintf(rule.call, generator, pipeline)
	} else {
		call = fmt.Sprintf(rule.call, generator)
	}
	source := "import * as Effect from \"effect/Effect\"\nimport * as Option from \"effect/Option\"\nexport const load = " + call + "\n"
	var result *Result
	var err error
	within(t, "compile", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}}) })
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	key := fmt.Sprintf("feature:%s:%d", rule.key, strings.Count(pipeline, "Effect."))
	if slices.ContainsFunc(result.Diagnostics, func(d *ast.Diagnostic) bool { return d.Source() == "EK" && d.Code() == 2128 }) {
		Gap(t, migrationGeneratorTarget, key, "Chapter 2: %q; a function* passed to a generator API is no producer, but got EK2128\n%s", migrationGeneratorQuote, source)
	}
	ExpectPending(t, migrationGeneratorTarget, key)
	ExpectPending(t, migrationGeneratorTarget, specCorpusKey(t))
}

func FuzzMigrationGeneratorReturns(f *testing.F) {
	startShortBudget(f)
	rules := migrationGeneratorRules()
	for _, rule := range rules {
		f.Add(rule.key, uint8(0))
	}
	f.Add("effect-fn-named", uint8(1))
	f.Add("effect-fn", uint8(2))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		i := slices.IndexFunc(rules, func(rule migrationGeneratorRule) bool { return rule.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		checkMigrationGeneratorReturn(t, w, rules[i], variant)
	})
}
