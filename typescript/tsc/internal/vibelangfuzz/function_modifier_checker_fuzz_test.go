package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

const functionModifierIndependentQuote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."

func requireFunctionModifierIndependentQuote(t testing.TB) {
	t.Helper()
	tooling, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(tooling), functionModifierIndependentQuote) {
		t.Fatalf("chapter 7 no longer says %q", functionModifierIndependentQuote)
	}
	requireEffectRestrictedMembersQuote(t)
	requireEffectRestrictedErrorPriority(t)
}

func TestFunctionModifierIndependentQuoted(t *testing.T) { requireFunctionModifierIndependentQuote(t) }

// A Functions modifier error (EK0104, EK0105) rejects one member or function
// head and keeps the rest of the file intact. Through the command line's own
// diagnostic order, an independent type error (TS2322) or error-body rule
// (EK1301) elsewhere in the file is still reported, as tsc reports TS2322
// beside its TS1042 modifier error.
func FuzzFunctionModifierIndependentErrors(f *testing.F) {
	startShortBudget(f)
	requireFunctionModifierIndependentQuote(f)
	keys := []string{"getter", "setter", "constructor", "object-getter", "async-function", "async-arrow", "async-block", "async-method", "async-getter"}
	for _, key := range keys {
		for mode := range uint8(4) {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		known := false
		for _, k := range keys {
			known = known || k == key
		}
		if !known {
			key = keys[int(mode)%len(keys)]
		}
		var head string
		var want []int32
		switch key {
		case "getter":
			head, want = "class C { effect get x() { return 1 } }", []int32{104}
		case "setter":
			head, want = "class C { effect set x(v: number) {} }", []int32{104}
		case "constructor":
			head, want = "class C { effect constructor() {} }", []int32{104}
		case "object-getter":
			head, want = "const o = { effect get x() { return 1 } }", []int32{104}
		case "async-function":
			head, want = "function f() { async effect function g() { return 1 } }", []int32{105}
		case "async-arrow":
			head, want = "const h = async effect () => 1", []int32{105}
		case "async-block":
			head, want = "const b = effect async { return 7 }", []int32{105}
		case "async-method":
			head, want = "class M { effect async m() {} }", []int32{105}
		case "async-getter":
			head, want = "class K { async effect get x() { return 1 } }", []int32{104, 105}
		}
		independent, code, native := "const independent: number = \"x\"", int32(2322), true
		if mode&1 != 0 {
			independent, code, native = "error E8 { constructor() {} }", 1301, false
		}
		source := head + "\n" + independent + "\nexport {}\n"
		if mode&2 != 0 {
			source = independent + "\n" + head + "\nexport {}\n"
		}
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		p := r.Program
		ds := compiler.GetDiagnosticsOfAnyProgram(context.Background(), p, nil, false, p.GetBindDiagnostics, p.GetSemanticDiagnostics)
		count := func(ek bool, c int32) int {
			n := 0
			for _, d := range ds {
				if d.Code() == c && (d.Source() == "EK") == ek {
					n++
				}
			}
			return n
		}
		for _, c := range want {
			if count(true, c) != 1 {
				Gap(t, "FuzzFunctionModifierIndependentErrors", "modifier:"+key, "want one EK%04d\n%s\n%v", c, source, Keys(r.Dir, ds))
			}
		}
		if count(!native, code) != 1 {
			Gap(t, "FuzzFunctionModifierIndependentErrors", "independent:"+key, "%s\nwant the independent %s%04d beside the modifier error\n%s\n%v", functionModifierIndependentQuote, map[bool]string{true: "TS", false: "EK"}[native], code, source, Keys(r.Dir, ds))
		}
	})
}
