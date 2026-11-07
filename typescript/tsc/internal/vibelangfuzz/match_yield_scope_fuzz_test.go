package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const matchYieldScopeTarget = "FuzzMatchYieldScope"
const matchYieldScopeQuote = "It introduces no function or Effect boundary: its ordered tests and selected arm stay in the enclosing activation"

var matchYieldScopeHomes = []string{"arm", "subject", "statement", "expression", "initializer"}

func matchYieldScopeQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("004-match.md"), matchYieldScopeQuote) {
		t.Fatal("match activation authority changed")
	}
}
func TestMatchYieldScopeQuoted(t *testing.T) { matchYieldScopeQuoted(t) }

// These are static acceptance and lexical-scope checks. Runtime suspension is
// compared with ordinary TypeScript in the paired compiler case.
func FuzzMatchYieldScope(f *testing.F) {
	startShortBudget(f)
	matchYieldScopeQuoted(f)
	for _, home := range matchYieldScopeHomes {
		for mode := uint8(0); mode < 8; mode++ {
			f.Add(home, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(matchYieldScopeHomes, key) {
			key = matchYieldScopeHomes[int(mode)%len(matchYieldScopeHomes)]
		}
		mode %= 8
		modifier, iterator := "", "Generator"
		if mode&1 != 0 {
			modifier, iterator = "async ", "AsyncGenerator"
		}
		subject, next, arm := "source", "number", "yield value"
		if key == "subject" {
			subject, next, arm = "yield source.field", "{field:number}", "value"
		}
		expression := "match(" + subject + "){when {field:let value}:" + arm + ";default:0;}"
		if mode&2 != 0 {
			expression = "(" + expression + ")"
		}
		body := "return " + expression
		switch key {
		case "statement":
			body = expression + ";return 0"
		case "expression":
			body = "return 1+(" + expression + ")"
		case "initializer":
			body = "const result=" + expression + ";return result"
		}
		if mode&4 != 0 {
			body = "const $match1=31,$do1=32,$doMatch1=33;" + body
		}
		source := "export " + modifier + "function* select(source:{field:number}):" + iterator + "<number,number," + next + ">{" + body + "}"
		gapKey := fmt.Sprintf("scope:%s:%d", key, mode)
		defer func() {
			if value := recover(); value != nil {
				Gap(t, matchYieldScopeTarget, gapKey, "valid yielding match panicked: %v\n%s", value, source)
			}
		}()
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"files\":[\"main.vibe\"]}"})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, matchYieldScopeTarget, gapKey, "%s: unexpected %s\n%s", matchYieldScopeQuote, specDiagnosticText(d), source)
				return
			}
		}
	})
}
