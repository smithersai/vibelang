package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const errorMemberTarget = "FuzzErrorInstanceMemberMatcher"
const errorMemberQuote = "Fields, methods and getters may be interleaved, as in a TypeScript class"
const errorMemberExtractQuote = "returns `[subject]`"
const errorMemberArityQuote = "its known length lies outside the admitted interval"

func errorMemberQuotes(t testing.TB) {
	t.Helper()
	for _, rule := range []struct{ chapter, quote string }{
		{"003-failures.md", errorMemberQuote},
		{"004-match.md", errorMemberExtractQuote},
		{"004-match.md", errorMemberArityQuote},
	} {
		if !strings.Contains(SpecText(rule.chapter), rule.quote) {
			t.Fatalf("error-member matcher rule changed: %s", rule.quote)
		}
	}
}
func TestErrorInstanceMemberMatcherQuoted(t *testing.T) { errorMemberQuotes(t) }

var errorMemberKeys = []string{"plain-field", "plain-method-first", "plain-method-last", "plain-getter", "plain-both", "schema-field", "schema-method-first", "schema-method-last", "schema-getter", "schema-both"}
var errorMemberBodies = []string{
	"code:number",
	"label():number{return this.code};code:number",
	"code:number;label():number{return this.code}",
	"get label():number{return this.code};code:number",
	"code:number;label():number{return this.code};get other():number{return this.code}",
}
var errorMemberArgs = []string{"", "let item", "let first,let second", "...let items", "let first,...let rest", "let first,let second,...let rest"}

// Member order and ordinary instance behavior do not alter the declaration's
// own tag matcher. Its extraction remains a singleton, including rest arities.
func FuzzErrorInstanceMemberMatcher(f *testing.F) {
	startShortBudget(f)
	errorMemberQuotes(f)
	for index, key := range errorMemberKeys {
		for shape := uint8(0); shape < 6; shape++ {
			f.Add(key, shape, uint8(index+int(shape))%4)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, shape, context uint8) {
		index := slices.Index(errorMemberKeys, key)
		if index < 0 {
			index = int(shape) % len(errorMemberKeys)
			key = errorMemberKeys[index]
		}
		kind := "error"
		if index >= 5 {
			kind = "schema error"
		}
		prefix := kind + " Boom{" + errorMemberBodies[index%5] + "};"
		modifier := ""
		if context&1 != 0 {
			modifier = "effect "
		}
		domain := "unknown"
		arms := fmt.Sprintf("when Boom(%s):1;default:0;", errorMemberArgs[shape%6])
		want := 0
		if shape%6 == 0 || shape%6 == 2 || shape%6 == 5 {
			want = 1
		}
		if context&2 != 0 {
			domain = `{_tag:"Boom";payload:7}|{_tag:"Other";payload:9}`
			pattern, value := "Boom", "subject.payload"
			if shape&1 != 0 {
				pattern, value = "Boom(let item)", "item.payload"
			}
			arms = fmt.Sprintf(`when %s:%s;when {_tag:"Other"}:subject.payload;`, pattern, value)
			want = 0
		}
		source := prefix + fmt.Sprintf("export %sfunction f(subject:%s){return match(subject){%s}}", modifier, domain, arms)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if diagnosticKey(d) == "EK0703" {
				count++
				if d.Category() != diagnostics.CategoryWarning {
					Gap(t, errorMemberTarget, "severity:"+key, "EK0703 is not a warning: %s", specDiagnosticText(d))
					return
				}
			} else if d.Category() == diagnostics.CategoryError {
				Gap(t, errorMemberTarget, "diagnostic:"+key, "unexpected %s\n%s", specDiagnosticText(d), source)
				return
			}
		}
		if count != want {
			Gap(t, errorMemberTarget, fmt.Sprintf("arity:%s:%d:%d", key, shape%6, context%4), "%s; %s: got %d EK0703, want %d\n%s", errorMemberQuote, errorMemberArityQuote, count, want, source)
		}
	})
}
