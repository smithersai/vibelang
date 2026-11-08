package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const grammarInitializerContextQuote = "Class field and enum member initializers parse with `[~Effect]`, even inside an effect function."
const grammarServiceInitializerContextQuote = "A `DefaultMember` initializer uses the source class-field context: the enclosing Effect execution and `fork`/`join` reservation reset."

func TestGrammarAdmissionInitializerContextQuoted(t *testing.T) {
	for _, quote := range []string{grammarInitializerContextQuote, grammarServiceInitializerContextQuote} {
		if !strings.Contains(SpecText(grammarAppendix), quote) {
			t.Fatalf("Appendix A initializer context changed: %s", quote)
		}
	}
}

func TestGrammarAdmissionInitializerContext(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	valid := []string{
		// The case-seeded campaign put a coalesce after join in a service default.
		"import { Effect } from \"effect\"\nfunction join(n: number) { return () => ({ value: n }) } export effect function main() { service Flags { static readonly key = \"app/Flags\"; static readonly defaultValue = join ?? (7); value: number } return (try Flags).value }",
		"effect function f() { class C { value = effect { return try k() } } }",
		"effect function f() { class C { [try k()] = join ?? 7 } }",
		"effect function f() { const o = { value: try k() }; }",
	}
	invalid := []string{
		"effect function f() { class C { value = try k() } }",
		"effect function f() { enum E { A = try k() } }",
		"effect function f() { service S { static readonly defaultValue = try k() } }",
		"effect function f() { class C { value = join 1 } }",
		"effect function f() { enum E { A = fork 1 } }",
		"effect function f() { service S { static readonly defaultValue = join 1 } }",
		// Static blocks inherit reservation, and computed names keep Effect.
		"effect function f() { class C { static { const join = 1 } } }",
		"effect function f() { class C { [join ?? 7] = 1 } }",
	}
	// Exercise both reserved names and the continuation forms that distinguish
	// an ordinary identifier from a prefix operation, across all three homes.
	for _, name := range []string{"fork", "join"} {
		for _, expression := range []string{name + " ?? 7", name + "(1)", name + ".value", name + "?.(1)", name + "[0]"} {
			for _, home := range []string{
				"class C { value = %s }",
				"class C { static value = %s }",
				"enum E { A = %s }",
				"service S { static readonly defaultValue = %s }",
			} {
				valid = append(valid, "effect function f() { "+fmt.Sprintf(home, expression)+" }")
			}
		}
	}
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range valid {
		if lab.read(lab.g, grammarLexSource(source), mode).count == 0 {
			t.Errorf("ordinary or nested Effect initializer has no derivation: %q", source)
		}
	}
	for _, source := range invalid {
		reading := lab.read(lab.g, grammarLexSource(source), mode)
		if reading.count != 0 {
			t.Errorf("initializer or computed-name context leaked: %q\nderivation: %s", source, reading.p.render(reading.trees[0], false))
		}
	}
	w := NewWorkspace(t)
	for _, source := range append(valid, invalid...) {
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
