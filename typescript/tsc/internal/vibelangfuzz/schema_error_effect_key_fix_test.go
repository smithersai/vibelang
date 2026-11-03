package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const schemaErrorLegacyDefectQuote = "`Effect.try` and `Effect.tryPromise` declare their thunk `@throws {unknown}` in both overloads"

func TestSchemaErrorLegacyKeyFixQuoted(t *testing.T) {
	schemaErrorEffectKeysQuoted(t)
	if !strings.Contains(SpecText("003-failures.md"), schemaErrorLegacyDefectQuote) {
		t.Fatalf("003-failures no longer says %q", schemaErrorLegacyDefectQuote)
	}
}

// The pre-fix class boundary emitted these calls as ordinary JavaScript.
// Chapter 3 admits throwing thunks in Effect.try; orDie preserves defects while the
// enclosing Effect's explicit empty E stays unchanged. The oracle checks
// both admitted and invalid JSON arguments and keeps each saved shape keyed.
func FuzzSchemaErrorLegacyKeyFix(f *testing.F) {
	startShortBudget(f)
	schemaErrorEffectKeysQuoted(f)
	if !strings.Contains(SpecText("003-failures.md"), schemaErrorLegacyDefectQuote) {
		f.Fatalf("missing rule: %s", schemaErrorLegacyDefectQuote)
	}
	shapes := []struct{ key, declaration string }{
		{"heritage", "class E extends JSON.parse(%s) {}"},
		{"struct", "schema error E { value: { readonly [JSON.parse(%s)]: string } }"},
		{"optional", "schema error E { value?: { readonly [JSON.parse(%s)]: string } }"},
		{"array", "schema error E { value: Array<{ readonly [JSON.parse(%s)]: string }> }"},
		{"tuple", "schema error E { value: [{ readonly [JSON.parse(%s)]: string }] }"},
	}
	type rule struct{ key, source string }
	var rules []rule
	for _, shape := range shapes {
		for _, input := range []struct{ key, text string }{{"valid", `"key"`}, {"invalid", "invalid"}} {
			arg := input.text
			if shape.key == "heritage" && input.key == "valid" {
				arg = "null"
			}
			declaration := fmt.Sprintf(shape.declaration, fmt.Sprintf("%q", arg))
			rules = append(rules, rule{shape.key + "/" + input.key,
				"export effect function main(): number!! {\n" + declaration + "\nreturn 1\n}\n"})
		}
	}
	// The keyed corpus covers every rule; keep one built-in smoke seed.
	f.Add("heritage/invalid")
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		selected := 0
		if len(key) > 0 {
			selected = int(key[0]) % len(rules)
		}
		for i, rule := range rules {
			if key == rule.key {
				selected = i
				break
			}
		}
		rule := rules[selected]
		toolsGuard(t, "FuzzSchemaErrorLegacyKeyFix", func() {
			r := toolsCompile(t, w, "FuzzSchemaErrorLegacyKeyFix", Single(rule.source).Files)
			defer r.Remove()
			if got := r4Errors(r.Diagnostics); !slices.Equal(got, []string{"EK9201"}) {
				Gap(t, "FuzzSchemaErrorLegacyKeyFix", "diagnostic:"+rule.key, "%s: got %v, want EK9201", rule.key, got)
			}
			var fixed *vibelang.FixResult
			toolsRun(t, "FuzzSchemaErrorLegacyKeyFix", "fix", rule.key, nil, func() {
				fixed = vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, r.Dir))
			})
			if fixed.Err != nil || len(fixed.Refused) != 0 || len(fixed.Files) != 1 {
				Gap(t, "FuzzSchemaErrorLegacyKeyFix", "rewrite:"+rule.key, "%s: missing preserving fix: %+v", rule.key, fixed)
			}
			var text string
			for _, file := range fixed.Files {
				text = file.Text
			}
			if !strings.Contains(text, "try Effect.orDie(Effect.try({ try: () => JSON.parse(") {
				Gap(t, "FuzzSchemaErrorLegacyKeyFix", "defect:"+rule.key, "%s: %s; got\n%s", rule.key, schemaErrorLegacyDefectQuote, text)
			}
			after := toolsCompile(t, w, "FuzzSchemaErrorLegacyKeyFix", Single(text).Files)
			defer after.Remove()
			if got := r4Errors(after.Diagnostics); len(got) != 0 {
				Gap(t, "FuzzSchemaErrorLegacyKeyFix", "compile:"+rule.key, "%s: fixed code reports %v", rule.key, got)
			}
			again := vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir))
			if again.Err != nil || len(again.Refused) != 0 || len(again.Files) != 0 {
				Gap(t, "FuzzSchemaErrorLegacyKeyFix", "fixed-point:"+rule.key, "%s: fix is not a fixed point: %+v", rule.key, again)
			}
		})
	})
}
