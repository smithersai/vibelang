package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const doPatternAssignmentTarget = "FuzzDoPatternDefiniteAssignment"
const doPatternAssignmentQuote = "A test binding is available to its following body"
const doPatternTDZQuote = "Each binding stays in TDZ until its pattern runs"

func doPatternAssignmentQuotes(t testing.TB) {
	t.Helper()
	for _, quote := range []string{doPatternAssignmentQuote, doPatternTDZQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			t.Fatalf("pattern initialization authority changed: %s", quote)
		}
	}
}
func TestDoPatternDefiniteAssignmentQuoted(t *testing.T) { doPatternAssignmentQuotes(t) }

var doPatternAssignmentRules = []struct {
	key, condition string
	missing        int
}{
	{"binding-before-do", "(s is {field:let value}) && do {true}", 0},
	{"binding-after-do", "do {true} && (s is {field:let value})", 0},
	{"nested-and", "((s is {field:let value}) && do {true}) && true", 0},
	{"flag-result", "(s is {field:let value}) && do {flag}", 0},
	{"negated-or", "!(!(s is {field:let value}) || do {false})", 0},
	{"do-skips-binding", "do {true} || (s is {field:let value})", 1},
	{"binding-may-fail", "(s is {field:let value}) || do {true}", 1},
	{"source-skips-binding", "(flag || (s is {field:let value})) && do {true}", 1},
	{"nested-skip", "((flag || (s is {field:let value})) && do {true}) && true", 1},
	{"negated-skip", "!(!(flag || (s is {field:let value})) || do {false})", 1},
}

func FuzzDoPatternDefiniteAssignment(f *testing.F) {
	startShortBudget(f)
	doPatternAssignmentQuotes(f)
	for _, rule := range doPatternAssignmentRules {
		for context := uint8(0); context < 4; context++ {
			f.Add(rule.key, context)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, context uint8) {
		index := slices.IndexFunc(doPatternAssignmentRules, func(rule struct {
			key, condition string
			missing        int
		}) bool {
			return rule.key == key
		})
		if index < 0 {
			index = int(context) % len(doPatternAssignmentRules)
			key = doPatternAssignmentRules[index].key
		}
		rule := doPatternAssignmentRules[index]
		prefix := ""
		if context&1 != 0 {
			prefix = "const $do_v1=1,$do_guard2=2,$do_v3=3,$do_guard4=4;"
		}
		field := "number"
		if context&2 != 0 {
			field = "string"
		}
		source := prefix + fmt.Sprintf("export function f(s:{field:%s}|null,flag:boolean){if(%s)return value;return 0}", field, rule.condition)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		missing := 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if d.Code() == 2454 {
				missing++
			} else {
				Gap(t, doPatternAssignmentTarget, fmt.Sprintf("diagnostic:%s:%d", key, context%4), "unexpected %s\n%s", specDiagnosticText(d), source)
				return
			}
		}
		if missing != rule.missing {
			Gap(t, doPatternAssignmentTarget, fmt.Sprintf("initialized:%s:%d", key, context%4), "%s; %s: got %d TS2454, want %d\n%s", doPatternAssignmentQuote, doPatternTDZQuote, missing, rule.missing, source)
		}
	})
}
