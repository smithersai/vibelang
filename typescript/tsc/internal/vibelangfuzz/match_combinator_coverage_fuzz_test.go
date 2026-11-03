package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const combinatorCoverageQuote = "`and`, `not`, regex, relational, array, built-in matcher and user-matcher patterns cover nothing"

func TestMatchCombinatorCoverageQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), combinatorCoverageQuote) {
		t.Fatal("VIP-7 coverage quote changed")
	}
}

var combinatorCoverageKeys = []string{"and", "not", "binding-right", "binding-left", "nested-or", "or-alternative", "default", "independent-cover", "plain-or", "open", "field-bindings", "extractor-bindings"}

// The key chooses a rule, the bytes vary finite domains, binding placement,
// parentheses, trivia and source contexts. Only independent literal arms or
// a default discharge coverage; the actual combinator test still narrows.
func FuzzMatchCombinatorCoverage(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("004-match.md"), combinatorCoverageQuote) {
		f.Fatal("VIP-7 coverage quote changed")
	}
	for _, key := range combinatorCoverageKeys {
		for domain := uint8(0); domain < 4; domain++ {
			f.Add(key, domain, domain)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, domain, shape uint8) {
		if !strings.Contains("|"+strings.Join(combinatorCoverageKeys, "|")+"|", "|"+key+"|") {
			key = combinatorCoverageKeys[int(shape)%len(combinatorCoverageKeys)]
		}
		typ, yes, no := "boolean", "true", "false"
		switch domain % 4 {
		case 1:
			typ, yes, no = "1 | 2", "1", "2"
		case 2:
			typ, yes, no = `"a" | "b"`, `"a"`, `"b"`
		case 3:
			typ, yes, no = `{_tag:"A"}|{_tag:"B"}`, `{_tag:"A"}`, `{_tag:"B"}`
		}
		prefix := ""
		pattern := yes + " and " + yes
		switch key {
		case "not":
			pattern = "not " + no
		case "binding-right":
			pattern = yes + " and let value"
		case "binding-left":
			pattern = "const value and " + yes
		case "nested-or":
			pattern = "(" + pattern + ") or (" + no + " and " + no + ")"
		case "or-alternative":
			pattern = "(" + pattern + ") or " + no
		case "plain-or":
			pattern = yes + " or " + no
		case "open":
			typ = "unknown"
		case "field-bindings":
			typ, no, pattern = `{_tag:"A";n:number}|{_tag:"B"}`, `{_tag:"B"}`, `{_tag:"A",n:(let a and let b)}`
		case "extractor-bindings":
			prefix, typ, no, pattern = "error A;error B;", "A|B", "B", "A(let a and let b)"
		}
		arms := fmt.Sprintf("when (%s): 1;", pattern)
		// These alternatives already accept both values at runtime. Repeating
		// the no arm would test a property of never on tagged subjects, an
		// independent native error unrelated to the coverage rule.
		if key != "nested-or" && key != "or-alternative" && key != "plain-or" {
			arms += fmt.Sprintf(" when %s: 0;", no)
		}
		if key == "default" {
			arms += " default: 2;"
		}
		if key == "independent-cover" {
			arms += " when let remaining: 3;"
		}
		expr := "match(x){" + arms + "}"
		source := fmt.Sprintf("export function f(x:%s){return %s}", typ, expr)
		switch shape % 4 {
		case 1:
			source = fmt.Sprintf("export const f=(x:%s)=>%s", typ, expr)
		case 2:
			source = fmt.Sprintf("export effect function f(x:%s){return %s}", typ, expr)
		case 3:
			source = fmt.Sprintf("export function f(x:%s){const value=do{%s};return value}", typ, expr)
		}
		source = strings.Repeat("/* coverage */\n", int(shape)%3) + prefix + source
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if diagnosticKey(d) == "EK4701" {
				count++
			} else {
				t.Errorf("unexpected %s\n%s", specDiagnosticText(d), source)
			}
		}
		want := 1
		if key == "default" || key == "independent-cover" || key == "plain-or" || key == "open" {
			want = 0
		}
		if count != want {
			Gap(t, "FuzzMatchCombinatorCoverage", "coverage:"+key, "VIP-7 %s: want %d EK4701, got %d\n%s", combinatorCoverageQuote, want, count, source)
		}
	})
}
