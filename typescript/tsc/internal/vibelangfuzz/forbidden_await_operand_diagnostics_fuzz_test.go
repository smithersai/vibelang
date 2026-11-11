package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const forbiddenAwaitOperandTarget = "FuzzForbiddenAwaitOperandDiagnostics"
const forbiddenAwaitOperandQuote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."
const forbiddenAwaitPlacementQuote = "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block"

type forbiddenAwaitOperandRule struct {
	key, source string
	nativeCode  int32
	effect      bool
}

func TestForbiddenAwaitOperandDiagnosticsQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", forbiddenAwaitOperandQuote)
	chapterSays(t, "001-functions.md", forbiddenAwaitPlacementQuote)
}

// Rejected await retains independent operand errors across source activations
// and parameter initialization. Native async functions keep their own rules.
func forbiddenAwaitOperandRules() []forbiddenAwaitOperandRule {
	hosts := []struct{ key, source string }{
		{"declaration", "export effect function f(){void (await EXPR)}"},
		{"expression", "export const f=effect function(){void (await EXPR)}"},
		{"arrow", "export const f=effect ()=>{void (await EXPR)}"},
		{"block", "export const f=effect {void (await EXPR)}"},
		{"producer", "export effect function* f(){void (await EXPR);yield 1}"},
		{"method", "export class C{effect f(){void (await EXPR)}}"},
		{"object-method", "export const o={effect f(){void (await EXPR)}}"},
		{"parameter", "export effect function f(value=await EXPR){void value}"},
		{"arrow-parameter", "export const f=effect (value=await EXPR)=>{void value}"},
		{"producer-parameter", "export effect function* f(value=await EXPR){yield value}"},
		{"static-nested", "export class C{static {void (()=>{void (effect ()=>{void (await EXPR)})})}}"},
		{"region", "export effect function f(){uninterruptible {void (await EXPR)}}"},
		{"concurrent", "export effect function f(){for concurrent(const n of [1]){void (await EXPR)}}"},
		{"do", "export effect function f(){const value=do{await EXPR;0};return value}"},
		{"async-control", "export async function f(){void (await EXPR)}"},
	}
	operands := []struct {
		key, source string
		code        int32
	}{
		{"missing", "missingValue", 2304},
		{"property", "({n:1}).missingValue", 2339},
		{"argument", "((n:number)=>n)(\"bad\")", 2345},
		{"assertion", "(1 as string)", 2352},
		{"satisfies", "(1 satisfies string)", 1360},
		{"arity", "((n:number)=>n)(1,2)", 2554},
		{"callback-body", "(()=>missingValue)", 2304},
		{"valid", "1", 0},
	}

	var rules []forbiddenAwaitOperandRule
	for _, host := range hosts {
		for _, operand := range operands {
			rules = append(rules, forbiddenAwaitOperandRule{
				key:        host.key + "/" + operand.key,
				source:     strings.ReplaceAll(host.source, "EXPR", operand.source),
				nativeCode: operand.code,
				effect:     host.key != "async-control",
			})
		}
	}
	return rules
}

func checkForbiddenAwaitOperand(t *testing.T, w *Workspace, r forbiddenAwaitOperandRule, source string) {
	t.Helper()
	result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var got, want []int32
	if r.effect {
		want = append(want, 102)
	}
	if r.nativeCode != 0 {
		want = append(want, r.nativeCode)
	}
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		got = append(got, d.Code())
		if IsEK(d) && d.Code() == 102 {
			if d.File() == nil || d.Pos() < 0 || d.End() > len(d.File().Text()) || d.File().Text()[d.Pos():d.End()] != "await" {
				t.Fatalf("await placement lost its keyword range: %v", d)
			}
		}
	}
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		Gap(t, forbiddenAwaitOperandTarget, r.key, "%s; want %v, got %v: %s", forbiddenAwaitOperandQuote, want, got, source)
	}
}

func TestForbiddenAwaitOperandDiagnosticsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, r := range forbiddenAwaitOperandRules() {
		t.Run(r.key, func(t *testing.T) { checkForbiddenAwaitOperand(t, w, r, r.source) })
	}
}

func FuzzForbiddenAwaitOperandDiagnostics(f *testing.F) {
	startShortBudget(f)
	rules := forbiddenAwaitOperandRules()
	for i, r := range rules {
		f.Add(r.key, uint8(i%4))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		TestForbiddenAwaitOperandDiagnosticsQuoted(t)
		i := slices.IndexFunc(rules, func(r forbiddenAwaitOperandRule) bool { return r.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		r := rules[i]
		source := strings.Repeat("/* operand diagnostics */\n", int(trivia)%4) + r.source
		checkForbiddenAwaitOperand(t, w, r, source)
		ExpectPending(t, forbiddenAwaitOperandTarget, r.key)
		ExpectPending(t, forbiddenAwaitOperandTarget, specCorpusKey(t))
	})
}
