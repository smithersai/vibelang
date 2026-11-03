package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

const doBindingTypesTarget = "FuzzDoBindingTypes"
const doBindingTypesQuote = "Anything TypeScript or the pinned TC39 proposal already defines (evaluation order, binding, types, modules, resolution, declaration emit) is as in TypeScript and is not restated."

func TestDoBindingTypesQuoted(t *testing.T) {
	chapterSays(t, "000-intro.md", doBindingTypesQuote)
	for _, key := range []string{"vip02.do-binding-default-plain", "vip02.do-binding-default-effect"} {
		construct := vipgen.Lookup(key)
		for _, citation := range construct.Citations {
			text, err := vipText(citation.VIP)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(text, citation.Quote) {
				t.Fatalf("VIP-%d no longer says %q", citation.VIP, citation.Quote)
			}
			if !vipInOrder(vipTokens(citation.Template), vipTokens(vipgen.PrintEffect(vipgen.Probe(construct.Key)))) {
				t.Fatal("reference no longer contains its cited template")
			}
		}
	}
}

// This static oracle compares the compiler with itself on an ordinary .ts
// counterpart, as chapter 000 requires. Defaults have the same normal
// result; the do additionally has an outward return to exercise its lowering.
// TypeScript 5.9.3 independently confirms TS2493 for a missing non-default tuple
// slot, and TS2322 for an incompatible written default (lane native receipt).
func FuzzDoBindingTypes(f *testing.F) {
	startShortBudget(f)
	type witness struct{ key, setup, pattern, rhs, suffix string }
	cases := []witness{
		{"tuple-overflow", "", "[x = DEFAULT, y]", "[1] as [number]", ""},
		{"literal-overflow", "", "[x = DEFAULT, y]", "[1]", ""},
		{"alias-overflow", "type One = [number]", "[x = DEFAULT, y]", "[1] as One", ""},
		{"readonly-overflow", "", "[x = DEFAULT, y]", "[1] as const", ""},
		{"defaulted-tuple-slot", "", "[x = DEFAULT, y = 0]", "[1] as [number]", "const check: number = y"},
		{"empty-default", "", "[x = DEFAULT]", "[] as []", "const check: number = x"},
		{"array-missing", "", "[x = DEFAULT, y]", "[] as number[]", "const check: number = y"},
		{"literal-element", "", "[x = DEFAULT, y]", "[1, 's']", "const check: string = y"},
		{"tuple-rest", "", "[x = DEFAULT, ...rest]", "[1, 's'] as [number, string]", "const check: [string] = rest"},
		{"literal-rest-wide", "", "[x = DEFAULT, y, ...rest]", "[1, 's', true]", "const check: boolean[] = rest"},
		{"typed-prefix", "", "[prefix, x = DEFAULT]", "[1, undefined] as [number, number?]", "const check: number = x"},
		{"typed-default", "", "[x = DEFAULT, y = 'bad']: [number?, number?]", "[]", ""},
		{"mutable-empty-default", "", "[x = DEFAULT]", "[] as []", "x = 1"},
		{"annotated-assignment", "", "[x = DEFAULT]: (number | undefined)[]", "[]", "x = undefined"},
		{"noniterable", "", "[x = DEFAULT]", "42", ""},
		{"annotated-function", "type Fn = (n:number)=>number", "[x = DEFAULT]: Fn[]", "[]", "const check: Fn = x"},
		{"asserted-function", "type Fn = (n:number)=>number", "[x = DEFAULT]", "[] as Fn[]", "const check: Fn = x"},
	}
	keys := make([]string, len(cases))
	for i, item := range cases {
		keys[i] = item.key
		f.Add([]byte(item.key))
		f.Add([]byte(item.key + ":\x01"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		chapterSays(t, "000-intro.md", doBindingTypesQuote)
		index, rest := keyedChoice(keys, data)
		item := cases[index]
		normal := "do { if (flag) { return 0 }; 0 }"
		source := func(value string) string {
			kind := "const"
			if item.key == "mutable-empty-default" || item.key == "annotated-assignment" {
				kind = "let"
			}
			return fmt.Sprintf("%s\nexport function check(flag:boolean):number { %s %s = %s; %s; return 0 }", item.setup, kind, strings.ReplaceAll(item.pattern, "DEFAULT", value), item.rhs, item.suffix)
		}
		nativeDefault := "0"
		if strings.HasSuffix(item.key, "function") {
			normal = "do { if (flag) { return 0 }; (n) => n }"
			nativeDefault = "(n) => n"
		}
		if len(rest) > 0 && rest[0]&1 != 0 {
			normal = "match (flag) { default: " + normal + "; }"
		}
		actualSource, nativeSource := source(normal), source(nativeDefault)
		native := doContextualNegativeCodes(t, w, "main.ts", nativeSource)
		actual := doContextualNegativeCodes(t, w, "main.vibe", actualSource)
		key := "binding:" + item.key
		if !slices.Equal(actual, native) {
			Gap(t, doBindingTypesTarget, key, "%s Native %v; Vibe %v\n%s\n%s", doBindingTypesQuote, native, actual, nativeSource, actualSource)
		}
		ExpectPending(t, doBindingTypesTarget, key)
		ExpectPending(t, doBindingTypesTarget, specCorpusKey(t))
	})
}
