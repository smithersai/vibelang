package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Fuzz coverage for spec loop round 5 OPUS-4 (lane sl5-apply; decided detail
// 254). Chapter 7's EK4834, EK4835 and EK4836 warn only on the direct operand
// of bare try in effect code. The neighbourhood: each family call, wrapped in
// nothing, parentheses, as or satisfies, spelled Effect.x or through a
// namespace import, at every consumer chapter 7 names. The target reads its
// rule from chapter 7 at test time (RULES.md 1, 4, 9, 10), takes a keyed input
// (RULES.md 11) and reports a disagreement through Gap under a precise key.

const (
	advisoryDirectQuote  = "In the `EK4834`, `EK4835` and `EK4836` rows, the call is the direct operand of bare `try` in effect code."
	advisoryWrapperQuote = "Parentheses and erased TypeScript expression forms (`as`, `satisfies`, `!`) around it still leave it the direct operand; the call is recognized by its resolved symbol, so an import alias counts and a local binding that shadows `Effect` does not."
	advisoryOthersQuote  = "An operand of `fork` in any form, of `join`, of `try.all`, `try.race`, `try.any` or `try.allSettled` or one of its elements, an argument of an Effect API, the head of a `catch`, and a stored or returned Effect are not direct operands, and these rows do not warn on them"
)

var advisoryFamilies = []struct{ name, code, call string }{
	{"succeed", "EK4834", "%s.succeed(1)"},
	{"fail", "EK4834", "%s.fail(\"x\")"},
	{"catch", "EK4835", "%s.catch(e, h)"},
	{"provide", "EK4836", "%s.provide(e, Layer.empty)"},
}

var advisoryWrappers = []struct{ name, form string }{
	{"bare", "%s"},
	{"parens", "(%s)"},
	{"as", "(%s as number!string)"},
	{"satisfies", "(%s satisfies number!string)"},
	{"non-null", "(%s)!"},
}

var advisoryAliases = []string{"Effect", "E", "Local", "Shadow"}

// Each consumer holds the call at %s; only "try" is a direct operand.
var advisoryConsumers = []struct{ name, stmt string }{
	{"try", "const v = try %s\n  void v"},
	{"fork", "const v = fork %s\n  void v"},
	{"try.all", "const v = try.all [%s, e]\n  void v"},
	{"try.allSettled", "const v = try.allSettled [%s]\n  void v"},
	{"try.any", "const v = try.any [%s, e]\n  void v"},
	{"returned", "return %s"},
	{"try.race", "const v = try.race [e, %s]\n  void v"},
	{"api-argument", "const v = try Effect.andThen(Effect.void, () => %s)\n  void v"},
	{"stored", "const v = %s\n  void v"},
	{"catch-head", "const v = %s catch () => 0\n  void v"},
}

func advisoryNames() []string {
	var names []string
	for _, f := range advisoryFamilies {
		for _, w := range advisoryWrappers {
			for _, a := range advisoryAliases {
				for _, c := range advisoryConsumers {
					names = append(names, f.name+"/"+w.name+"/"+a+"/"+c.name)
				}
			}
		}
	}
	return names
}

func advisoryPick(data []byte, names []string) int {
	if key, ok := strings.CutPrefix(string(data), "key:"); ok {
		if i := slices.Index(names, key); i >= 0 {
			return i
		}
	}
	if len(data) == 0 {
		return 0
	}
	index := uint64(0)
	for _, b := range data {
		index = index*131 + uint64(b)
	}
	return int(index % uint64(len(names)))
}

func advisoryQuoted(tb testing.TB) {
	tb.Helper()
	text := SpecText("007-tooling.md")
	for _, q := range []string{advisoryDirectQuote, advisoryWrapperQuote, advisoryOthersQuote} {
		if !strings.Contains(text, q) {
			tb.Fatalf("007-tooling.md no longer says %q", q)
		}
	}
}

func advisoryCodes(diags []*ast.Diagnostic) (warned, errs []string) {
	for _, d := range diags {
		code := fmt.Sprintf("%s%04d", d.Source(), d.Code())
		if d.Source() == "" {
			code = fmt.Sprintf("TS%04d", d.Code())
		}
		switch {
		case d.Category() == diagnostics.CategoryError:
			errs = append(errs, code)
		case code == "EK4834" || code == "EK4835" || code == "EK4836":
			warned = append(warned, code)
		}
	}
	return warned, errs
}

func TestDirectTryAdvisoriesQuoted(t *testing.T) { advisoryQuoted(t) }

func FuzzDirectTryAdvisories(f *testing.F) {
	startShortBudget(f)
	advisoryQuoted(f)
	names := advisoryNames()
	// Seeds: every consumer for each family as written, and every wrapper
	// and alias at the one consumer that warns.
	for _, name := range names {
		parts := strings.Split(name, "/")
		if (parts[1] == "bare" && parts[2] == "Effect") || parts[3] == "try" {
			f.Add([]byte("key:" + name))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := advisoryPick(data, names)
		parts := strings.Split(names[i], "/")
		fam := advisoryFamilies[slices.IndexFunc(advisoryFamilies, func(x struct{ name, code, call string }) bool { return x.name == parts[0] })]
		wrap := advisoryWrappers[slices.IndexFunc(advisoryWrappers, func(x struct{ name, form string }) bool { return x.name == parts[1] })]
		cons := advisoryConsumers[slices.IndexFunc(advisoryConsumers, func(x struct{ name, stmt string }) bool { return x.name == parts[3] })]
		alias, binding := parts[2], "Local"
		if alias == "Shadow" {
			alias, binding = "E", "E" // shadows the real namespace import
		}
		call := fmt.Sprintf(wrap.form, fmt.Sprintf(fam.call, alias))
		main := "import * as E from \"effect/Effect\"\n" +
			"export effect function f(e: number!string, h: (x: string) => number!!, " + binding + ": { succeed: (n: number) => number!!; fail: (e: string) => never!string; catch: (e: number!string, h: (x: string) => number!!) => number!!; provide: (e: number!string, layer: Layer.Layer<never>) => number!string }) {\n  " +
			fmt.Sprintf(cons.stmt, call) + "\n  void E\n  return 0\n}\n"
		r, err := w.Compile(t.Context(), Single(main))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		warned, errs := advisoryCodes(r.Diagnostics)
		if len(errs) > 0 {
			Gap(t, "FuzzDirectTryAdvisories", "errors:"+strings.Join(errs, "+")+"/"+wrap.name, "007-tooling: %s; %s: the program is valid, but the compiler gives %v:\n%s", advisoryWrapperQuote, names[i], errs, main)
		}
		want := cons.name == "try" && parts[2] != "Local" && parts[2] != "Shadow"
		got := slices.Contains(warned, fam.code)
		if want && !got {
			Gap(t, "FuzzDirectTryAdvisories", "missing:"+fam.code+"/"+wrap.name, "007-tooling: %s; %s: %s is the direct operand of try, but the compiler gives %v:\n%s", advisoryWrapperQuote, names[i], call, warned, main)
		}
		if got && !want {
			Gap(t, "FuzzDirectTryAdvisories", "extra:"+fam.code+"/"+cons.name, "007-tooling: %s; %s: %s is not a direct try operand, but the compiler gives %v:\n%s", advisoryOthersQuote, names[i], call, warned, main)
		}
		if others := slices.DeleteFunc(slices.Clone(warned), func(c string) bool { return want && c == fam.code }); len(others) > 0 && !(got && !want) {
			Gap(t, "FuzzDirectTryAdvisories", "extra:"+strings.Join(others, "+")+"/"+cons.name, "007-tooling: %s; %s: only %s may warn, the compiler gives %v:\n%s", advisoryDirectQuote, names[i], fam.code, warned, main)
		}
	})
}
