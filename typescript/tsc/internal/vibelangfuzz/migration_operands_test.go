package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const migrationOperandTarget = "FuzzMigrationEffectOperands"
const migrationOperandQuote = "`e` is an Effect when its type is assignable to `Effect.Effect<any, any, any>`."
const migrationOperandConsumersQuote = "Only the [operand test](#operand-test) of `try` (`EK0502`), `catch` (`EK0506`), `try.all` (`EK1801`) and `fork` (`EK1703`) uses assignability to `Effect.Effect<any, any, any>`, which `never` and `any` pass."

type migrationOperandRule struct {
	key, declarations string
	allowed           bool
}

// These types meet (or explicitly fail) the spec's structural assignability
// test. The oracle does not ask today's compiler to decide the expected side.
// alchemy-20 supplies the Config, inherited, branded and callable witnesses;
// alchemy-14 supplies the yieldable error.
func migrationOperandRules() []migrationOperandRule {
	return []migrationOperandRule{
		{"exact", "declare const input: Effect.Effect<number, string>;", true},
		{"config", "declare const input: Config.Config<string>;", true},
		{"inherited", "interface Sub extends Effect.Effect<number> { readonly tag: \"Sub\" }; declare const input: Sub;", true},
		{"branded", "declare const input: Effect.Effect<number> & { readonly brand: \"Service\" };", true},
		{"callable", "type Operation = ((id:string) => Effect.Effect<number, string>) & Effect.Effect<(id:string) => Effect.Effect<number, string>>; declare const input: Operation;", true},
		{"generic", "type Wrapped<T> = Effect.Effect<T, string>; declare const input: Wrapped<number>;", true},
		{"tagged-error", "error Missing { id:string }; const input = new Missing({id:\"x\"});", true},
		{"any", "declare const input: any;", true},
		{"never", "declare const input: never;", true},
		{"unknown", "declare const input: unknown;", false},
		{"number", "declare const input: number;", false},
		{"option", "declare const input: Option.Option<number>;", false},
	}
}

func TestMigrationEffectOperandsQuoted(t *testing.T) {
	chapter := SpecText("002-running.md")
	for _, quote := range []string{migrationOperandQuote, migrationOperandConsumersQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Chapter 2 no longer says %q", quote)
		}
	}
}

func checkMigrationEffectOperand(t *testing.T, w *Workspace, rule migrationOperandRule, variant uint8) {
	t.Helper()
	TestMigrationEffectOperandsQuoted(t)
	operand, shape := "input", "value"
	if variant&4 != 0 {
		operand, shape = "make()", "call"
	}
	operators := []string{"try", "catch", "try.all", "fork"}
	codes := []int32{502, 506, 1801, 1703}
	op := int(variant & 3)
	expression := []string{
		"return try " + operand,
		"return " + operand + " catch (() => 0)",
		"return try.all [" + operand + "]",
		"const fiber = fork " + operand + "; return 0",
	}[op]
	body := "export effect function probe() { " + expression + " }"
	source := rule.declarations + "\n/** @throws {never} */\ndeclare function make(): typeof input;\n" + body + "\n"
	var result *Result
	var err error
	within(t, "compile", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}}) })
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var errors []string
	matched := false
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		errors = append(errors, fmt.Sprintf("%s%d", d.Source(), d.Code()))
		if d.Source() == "EK" && d.Code() == codes[op] {
			matched = true
		}
	}
	key := fmt.Sprintf("feature:%s:%s:%s", rule.key, operators[op], shape)
	if rule.allowed && len(errors) > 0 || !rule.allowed && !matched {
		Gap(t, migrationOperandTarget, key, "Chapter 2: %q; %s accepts operand=%t, got %v\n%s", migrationOperandQuote, operators[op], rule.allowed, errors, source)
	}
	ExpectPending(t, migrationOperandTarget, key)
	ExpectPending(t, migrationOperandTarget, specCorpusKey(t))
}

func FuzzMigrationEffectOperands(f *testing.F) {
	startShortBudget(f)
	rules := migrationOperandRules()
	for _, rule := range rules {
		f.Add(rule.key, uint8(0))
	}
	// Other operators and call operands enter the short seeds too.
	for _, variant := range []uint8{1, 2, 3, 4, 5, 6, 7} {
		f.Add("branded", variant)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		i := slices.IndexFunc(rules, func(rule migrationOperandRule) bool { return rule.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		checkMigrationEffectOperand(t, w, rules[i], variant)
	})
}
