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

type computedExpressionRule struct {
	key, prefix, domain, expression, parameters string
	assignType, fallback                        string
	wantCode                                    int32
}

var computedExpressionRules = []computedExpressionRule{
	{key: "do", domain: `{field:number}`, expression: `do { "field" as const }`},
	{key: "call", prefix: `function key():"field"{return "field"};`, domain: `{field:number}`, expression: "key()"},
	{key: "parenthesized", prefix: `const key="field" as const;`, domain: `{field:number}`, expression: "(key)"},
	{key: "binary", domain: `Record<string,number>`, expression: `"fi"+"eld"`},
	{key: "conditional", domain: `Record<string,number>`, expression: `flag?"field":"other"`, parameters: ",flag:boolean"},
	{key: "dynamic-index", prefix: `const keys=["field","other"] as const;`, domain: `Record<string,number>`, expression: "keys[index]", parameters: ",index:0|1"},
	{key: "template", domain: `{field:number}`, expression: "`field`"},
	{key: "sequence", prefix: `function tick():number{return 0};`, domain: `{field:number}`, expression: `(tick(),"field" as const)`},
	{key: "coalesce", prefix: `declare const Box:{field?:"field"};`, domain: `{field:number}`, expression: `Box.field??"field"`},
	{key: "method-local", prefix: `const box={key():"field"{return "field"}};`, domain: `{field:number}`, expression: "box.key()"},
	{key: "call-payload", prefix: `function key():"_tag"{return "_tag"};`, domain: `{_tag:"A";a:number}|{_tag:"B";b:number}`, expression: "key()"},
	{key: "method", prefix: `const Box={key():"field"{return "field"}};`, domain: `{field:number}`, expression: "Box.key()"},
	{key: "unique-symbol", prefix: `declare const token:unique symbol;function key():typeof token{return token};`, domain: `{[token]:number}`, expression: "key()"},
	{key: "overload", prefix: `function key(x:true):"field";function key(x:false):"other";function key(x:boolean):"field"|"other"{return x?"field":"other"};`, domain: `{field:number}`, expression: "key(true)"},
	{key: "generic", prefix: `function key<T extends "field"|"other">(x:T):T{return x};`, domain: `{field:number}`, expression: `key("field")`},
	// Negative controls: a compiler that widens computed keys to any loses these errors.
	{key: "wrong-key", prefix: `function key():"other"{return "other"};`, domain: `{field:number}`, expression: "key()", assignType: "number", fallback: "0", wantCode: 2322},
	{key: "wrong-value-type", domain: `Record<string,number>`, expression: `"fi"+"eld"`, assignType: "string", fallback: `""`, wantCode: 2322},
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
		index := slices.IndexFunc(computedExpressionRules, func(rule computedExpressionRule) bool { return rule.key == key })
		if index < 0 {
			index = int(context) % len(computedExpressionRules)
			key = computedExpressionRules[index].key
		}
		rule := computedExpressionRules[index]
		source := computedExpressionSource(index, context)
		compiled, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer compiled.Remove()
		if rule.wantCode == 0 {
			for _, d := range compiled.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, computedExpressionTarget, fmt.Sprintf("grammar:%s:%d", key, context%8), "%s: unexpected %s\n%s", computedExpressionGrammar, specDiagnosticText(d), source)
					return
				}
			}
			return
		}
		if countCode(compiled.Diagnostics, rule.wantCode) == 0 {
			Gap(t, computedExpressionTarget, fmt.Sprintf("grammar:%s:%d", key, context%8), "%s: want TS%d, got %v\n%s", computedExpressionGrammar, rule.wantCode, Keys(compiled.Dir, compiled.Diagnostics), source)
		}
	})
}

func computedExpressionSource(index int, context uint8) string {
	rule := computedExpressionRules[index]
	prefix := rule.prefix
	if context&4 != 0 {
		prefix = "const $matchKey1=11,$matchKey2=12,$matchKey3=13,$matchKey4=14,$matchKey5=15,$matchKey6=16,$matchKey7=17,$matchKey8=18;const $matchKey1Source=21,$matchKey2Source=22,$matchKey3Source=23,$matchKey4Source=24,$matchKey5Source=25,$matchKey6Source=26,$matchKey7Source=27,$matchKey8Source=28;" + prefix
	}
	if rule.wantCode != 0 {
		matchExpr := "match(subject){when {[" + rule.expression + "]:let value}:value;default:" + rule.fallback + ";}"
		switch context % 4 {
		case 1:
			return prefix + fmt.Sprintf("export function f(subject:%s%s):%s{const out:%s=%s;return out}", rule.domain, rule.parameters, rule.assignType, rule.assignType, matchExpr)
		case 2:
			return prefix + fmt.Sprintf("export effect function f(subject:%s%s):%s!!{return %s}", rule.domain, rule.parameters, rule.assignType, matchExpr)
		case 3:
			return prefix + fmt.Sprintf("export function f(subject:%s%s):boolean{if(subject is {[%s]:let value}){const out:%s=value;return Boolean(out)}return false}", rule.domain, rule.parameters, rule.expression, rule.assignType)
		default:
			return prefix + fmt.Sprintf("export function f(subject:%s%s):%s{return %s}", rule.domain, rule.parameters, rule.assignType, matchExpr)
		}
	}
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
	return prefix + fmt.Sprintf("export %sfunction f(subject:%s%s):%s{return %s}", modifier, rule.domain, rule.parameters, result, body)
}
