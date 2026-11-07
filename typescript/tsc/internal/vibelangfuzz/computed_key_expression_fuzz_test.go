package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const computedExpressionTarget = "FuzzComputedKeyExpressions"
const computedExpressionQuote = "the pinned draft with VIP-7's `when` prefix"
const computedExpressionGrammar = "PropertyName[?Yield, ?Await] `?`? `:` MatchPattern[?Yield, ?Await]"

func computedExpressionQuotes(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("004-match.md"), computedExpressionQuote) {
		t.Fatal("computed property grammar authority changed")
	}
	snapshot := filepath.Join(filepath.Dir(SpecPath("004-match.md")), "..", "vips", "tc39-pattern-matching", "spec.emu")
	data, err := os.ReadFile(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), computedExpressionGrammar) {
		t.Fatal("pinned property-name grammar changed")
	}
}
func TestComputedKeyExpressionsQuoted(t *testing.T) { computedExpressionQuotes(t) }

var computedExpressionRules = []struct{ key, prefix, domain, expression, parameters string }{
	{"do", "", `{field:number}`, `do { "field" as const }`, ""},
	{"call", `function key():"field"{return "field"};`, `{field:number}`, "key()", ""},
	{"parenthesized", `const key="field" as const;`, `{field:number}`, "(key)", ""},
	{"binary", "", `Record<string,number>`, `"fi"+"eld"`, ""},
	{"conditional", "", `Record<string,number>`, `flag?"field":"other"`, ",flag:boolean"},
	{"dynamic-index", `const keys=["field","other"] as const;`, `Record<string,number>`, "keys[index]", ",index:0|1"},
	{"template", "", `{field:number}`, "`field`", ""},
	{"sequence", `function tick():number{return 0};`, `{field:number}`, `(tick(),"field" as const)`, ""},
	{"coalesce", `declare const Box:{field?:"field"};`, `{field:number}`, `Box.field??"field"`, ""},
	{"method-local", `const box={key():"field"{return "field"}};`, `{field:number}`, "box.key()", ""},
	{"call-payload", `function key():"_tag"{return "_tag"};`, `{_tag:"A";a:number}|{_tag:"B";b:number}`, "key()", ""},
	{"method", `const Box={key():"field"{return "field"}};`, `{field:number}`, "Box.key()", ""},
	{"unique-symbol", `declare const token:unique symbol;function key():typeof token{return token};`, `{[token]:number}`, "key()", ""},
	{"overload", `function key(x:true):"field";function key(x:false):"other";function key(x:boolean):"field"|"other"{return x?"field":"other"};`, `{field:number}`, "key(true)", ""},
	{"generic", `function key<T extends "field"|"other">(x:T):T{return x};`, `{field:number}`, `key("field")`, ""},
}

// PropertyName admits a computed AssignmentExpression. These static checks
// exercise its grammar and source key type, without asserting runtime behavior.
func FuzzComputedKeyExpressions(f *testing.F) {
	startShortBudget(f)
	computedExpressionQuotes(f)
	for _, rule := range computedExpressionRules {
		for context := uint8(0); context < 8; context++ {
			f.Add(rule.key, context)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, context uint8) {
		index := slices.IndexFunc(computedExpressionRules, func(rule struct{ key, prefix, domain, expression, parameters string }) bool { return rule.key == key })
		if index < 0 {
			index = int(context) % len(computedExpressionRules)
			key = computedExpressionRules[index].key
		}
		source := computedExpressionSource(index, context)
		compiled, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer compiled.Remove()
		for _, d := range compiled.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, computedExpressionTarget, fmt.Sprintf("grammar:%s:%d", key, context%8), "%s: unexpected %s\n%s", computedExpressionGrammar, specDiagnosticText(d), source)
				return
			}
		}
	})
}

func computedExpressionSource(index int, context uint8) string {
	rule := computedExpressionRules[index]
	body := "match(subject){when {[" + rule.expression + "]:let value}:value;default:0;}"
	if rule.key == "call-payload" {
		body = `match(subject){when {[key()]:"A"}:subject.a;when {[key()]:"B"}:subject.b;}`
	}
	result, modifier := "number", ""
	switch context % 4 {
	case 1:
		body = "1+(" + body + ")"
	case 2:
		modifier = "effect "
		result += "!!"
	case 3:
		body = "subject is {[" + rule.expression + "]:let value}"
		if rule.key == "call-payload" {
			body = `subject is {[key()]:"A",a:let value}`
		}
		result = "boolean"
	}
	prefix := rule.prefix
	if context&4 != 0 {
		prefix = "const $matchKey1=11,$matchKey2=12,$matchKey3=13,$matchKey4=14,$matchKey5=15,$matchKey6=16,$matchKey7=17,$matchKey8=18;const $matchKey1Source=21,$matchKey2Source=22,$matchKey3Source=23,$matchKey4Source=24,$matchKey5Source=25,$matchKey6Source=26,$matchKey7Source=27,$matchKey8Source=28;" + prefix
	}
	return prefix + fmt.Sprintf("export %sfunction f(subject:%s%s):%s{return %s}", modifier, rule.domain, rule.parameters, result, body)
}
