package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// Fuzz coverage for the effect-code half of chapter 7's EK4834-EK4836 rule
// (lane pmfix-ek4834). 9421d41b dropped the check that try runs the call, so
// try Effect.succeed(1) in a plain arrow warned beside its EK0501. The
// neighbourhood: each family, wrapped or not, as the direct try operand in
// every kind of code a try can stand in. Only effect code may warn. The rule
// is read from chapter 7 at test time and inputs are keyed (RULES.md 1, 11).

const advisoryEffectCodeQuote = "the call is the direct operand of bare `try` in effect code"

// advisoryCodeKind holds the direct try at %s; effect says whether it stands
// in effect code.
type advisoryCodeKind struct {
	name, form string
	effect     bool
}

var advisoryCodeKinds = []advisoryCodeKind{
	{"plain-arrow", "export const f = (e: number!string, h: (x: string) => number!!) => try %s", false},
	{"plain-function", "export function f(e: number!string, h: (x: string) => number!!) { return try %s }", false},
	{"async-function", "export async function f(e: number!string, h: (x: string) => number!!) { return try %s }", false},
	{"plain-in-effect", "export effect function f(e: number!string, h: (x: string) => number!!) {\n  const g = () => try %s\n  void g\n  return 0\n}", false},
	{"effect-arrow", "export const f = effect (e: number!string, h: (x: string) => number!!) => try %s", true},
	{"effect-function", "export effect function f(e: number!string, h: (x: string) => number!!) {\n  const v = try %s\n  return v\n}", true},
	{"effect-in-plain", "export function f(e: number!string, h: (x: string) => number!!) {\n  return effect {\n    const v = try %s\n    return v\n  }\n}", true},
}

func advisoryCodeKindNames() []string {
	var names []string
	for _, f := range advisoryFamilies {
		for _, w := range advisoryWrappers {
			for _, k := range advisoryCodeKinds {
				names = append(names, f.name+"/"+w.name+"/"+k.name)
			}
		}
	}
	return names
}

func TestDirectTryEffectCodeQuoted(t *testing.T) { advisoryEffectCodeQuoted(t) }

func advisoryEffectCodeQuoted(tb testing.TB) {
	tb.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), advisoryEffectCodeQuote) {
		tb.Fatalf("007-tooling.md no longer says %q", advisoryEffectCodeQuote)
	}
}

func FuzzDirectTryAdvisoryCodeKinds(f *testing.F) {
	startShortBudget(f)
	advisoryEffectCodeQuoted(f)
	names := advisoryCodeKindNames()
	// Seeds: every family in every kind unwrapped, and every wrapper in a
	// plain arrow, the witness of vip1-accept-try-paren-call-plain.
	for _, name := range names {
		parts := strings.Split(name, "/")
		if parts[1] == "bare" || parts[2] == "plain-arrow" {
			f.Add([]byte("key:" + name))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := advisoryPick(data, names)
		parts := strings.Split(names[i], "/")
		fam := advisoryFamilies[slices.IndexFunc(advisoryFamilies, func(x struct{ name, code, call string }) bool { return x.name == parts[0] })]
		wrap := advisoryWrappers[slices.IndexFunc(advisoryWrappers, func(x struct{ name, form string }) bool { return x.name == parts[1] })]
		kind := advisoryCodeKinds[slices.IndexFunc(advisoryCodeKinds, func(x advisoryCodeKind) bool { return x.name == parts[2] })]
		call := fmt.Sprintf(wrap.form, fmt.Sprintf(fam.call, "Effect"))
		main := fmt.Sprintf(kind.form, call) + "\n"
		r, err := w.Compile(t.Context(), Single(main))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		warned, errs := advisoryCodes(r.Diagnostics)
		if kind.effect && len(errs) > 0 {
			Gap(t, "FuzzDirectTryAdvisoryCodeKinds", "errors:"+strings.Join(errs, "+")+"/"+kind.name, "007-tooling: %s; %s: the program is valid, but the compiler gives %v:\n%s", advisoryEffectCodeQuote, names[i], errs, main)
		}
		got := slices.Contains(warned, fam.code)
		if kind.effect && !got {
			Gap(t, "FuzzDirectTryAdvisoryCodeKinds", "missing:"+fam.code+"/"+kind.name, "007-tooling: %s; %s: %s is the direct try operand in effect code, but the compiler gives %v:\n%s", advisoryEffectCodeQuote, names[i], call, warned, main)
		}
		if !kind.effect && len(warned) > 0 {
			Gap(t, "FuzzDirectTryAdvisoryCodeKinds", "extra:"+strings.Join(warned, "+")+"/"+kind.name, "007-tooling: %s; %s: this try is not in effect code (EK0501), but the compiler gives %v:\n%s", advisoryEffectCodeQuote, names[i], warned, main)
		}
	})
}
