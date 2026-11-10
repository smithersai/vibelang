package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const computedCoverageTarget = "FuzzComputedKeyMatchCoverage"
const computedCoverageQuote = "when every other property it tests is a bare key or a `let` or `const` binding that the member declares as required"
const computedCoverageTagQuote = "Each of those literals is a case of the member"
const computedCoverageGuardQuote = "Only an unguarded arm covers anything."
const computedCoverageObjectQuote = "first rejects non-objects (functions are objects too)"

func computedCoverageQuotes(t testing.TB) {
	t.Helper()
	for _, q := range []string{computedCoverageQuote, computedCoverageTagQuote, computedCoverageGuardQuote, computedCoverageObjectQuote} {
		if !strings.Contains(SpecText("004-match.md"), q) {
			t.Fatalf("computed coverage rule changed: %s", q)
		}
	}
}
func TestComputedKeyMatchCoverageQuoted(t *testing.T) { computedCoverageQuotes(t) }

var computedCoverageKeys = []string{"literal", "parameter", "getter", "required", "number", "symbol", "optional", "guarded", "union-key", "missing", "primitive", "primitive-complete"}

func FuzzComputedKeyMatchCoverage(f *testing.F) {
	startShortBudget(f)
	computedCoverageQuotes(f)
	for _, key := range computedCoverageKeys {
		for context := uint8(0); context < 4; context++ {
			f.Add(key, context)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, context uint8) {
		index := slices.Index(computedCoverageKeys, key)
		if index < 0 {
			index = int(context) % len(computedCoverageKeys)
			key = computedCoverageKeys[index]
		}
		prefix, extra := "", ""
		domain := `{_tag:"A"|"B"}`
		property := `"_tag"`
		payload := ""
		want := 0
		switch key {
		case "primitive", "primitive-complete":
			prefix = `export {};declare global{interface String{readonly _tag:"A"}};`
			domain = `"x"|{_tag:"A"}`
			extra = `,key:"_tag"`
			property = "key"
			if key == "primitive" {
				want = 1
			}
		case "parameter":
			extra = `,key:"_tag"`
			property = "key"
		case "getter":
			prefix = `const Key={get field():"_tag"{return "_tag"}};`
			property = "Key.field"
		case "required", "optional":
			mark := ""
			if key == "optional" {
				mark = "?"
				want = 1
			}
			domain = fmt.Sprintf(`{_tag:"A"|"B";value%s:number}`, mark)
			payload = `,["value"]:let value`
		case "number":
			domain = `{_tag:"A"|"B";1:number}`
			payload = `,[1]:let value`
		case "symbol":
			prefix = `declare const field:unique symbol;`
			domain = `{_tag:"A"|"B";[field]:number}`
			payload = `,[field]:let value`
		case "guarded", "missing":
			want = 1
		case "union-key":
			domain = `{_tag:"A"|"B";other:"A"|"B"}`
			extra = `,key:"_tag"|"other"`
			property = "key"
			want = 1
		}
		first := fmt.Sprintf(`when {[%s]:"A"%s}`, property, payload)
		if key == "guarded" {
			first += " and if(flag)"
		}
		arms := first + ":1;"
		if key != "missing" && key != "primitive" && key != "primitive-complete" {
			arms += fmt.Sprintf(`when {[%s]:"B"%s}:2;`, property, payload)
		}
		if key == "primitive-complete" {
			arms += `when "x":3;`
		}
		params := ""
		if context&1 != 0 {
			params = "<T extends " + domain + ">"
			domain = "T"
		}
		modifier := ""
		if context&2 != 0 {
			modifier = "effect "
		}
		source := prefix + fmt.Sprintf("export %sfunction f%s(s:%s,flag:boolean%s){return match(s){%s}}", modifier, params, domain, extra, arms)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if diagnosticKey(d) != "EK4701" {
				Gap(t, computedCoverageTarget, "diagnostic:"+key, "unexpected %s\n%s", specDiagnosticText(d), source)
				return
			}
			count++
		}
		if count != want {
			Gap(t, computedCoverageTarget, fmt.Sprintf("coverage:%s:%d", key, context%4), "%s: got %d EK4701, want %d\n%s", computedCoverageQuote, count, want, source)
		}
	})
}
