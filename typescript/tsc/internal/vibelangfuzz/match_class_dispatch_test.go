package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// Chapter 004, Class patterns: "An ordinary-class extractor without an own matcher is
// `EK0704`, with any argument count, including `()`", and "a construct signature selects
// `instanceof`; ... A bare call-only pattern requires a return type assignable to
// `boolean`; an extractor requires `Iterable<unknown> | false`. Other return types, and
// callees with neither signature (`any`, `unknown`, `Function`, non-callable objects), are
// `EK0702`".
var classDispatchCallees = []struct {
	name, decl     string
	bare, extract  int32 // the diagnostic code; 0 when the pattern compiles
}{
	{"Point", "class Point { constructor(readonly x: number) {} }", 0, 704},
	{"Empty", "class Empty {}", 0, 704},
	{"Derived", "class Base { static [customMatcher](s: unknown) { return [s] } }\nclass Derived extends Base {}", 0, 704},
	{"Own", "class Own { static [customMatcher](s: unknown) { return [s] } }", 0, 0},
	{"Ctor", "declare const Ctor: new () => { readonly a: number }", 0, 704},
	{"object", "const object = { [customMatcher](s: unknown) { return [s] } }", 0, 0},
	{"pred", "function pred(s: unknown): s is string { return typeof s === \"string\" }", 0, 702},
	{"flag", "function flag(s: unknown): boolean { return s === 1 }", 0, 702},
	{"list", "function list(s: unknown): false | [unknown] { return [s] }", 702, 0},
	{"iter", "function iter(s: unknown): Iterable<unknown> { return [s] }", 702, 0},
	{"count", "function count(s: unknown): number { return 1 }", 702, 702},
	{"text", "function text(s: unknown): string { return \"\" }", 702, 0},
	{"anything", "declare const anything: any", 702, 702},
	{"mystery", "declare const mystery: unknown", 702, 702},
	{"plain", "const plain = { b: 1 }", 702, 702},
	{"Map", "", 0, 0},
	{"Array", "", 0, 0},
	{"Date", "", 0, 0},
	{"Function", "", 107, 107},
}

func TestClassPatternDispatch(t *testing.T) {
	w := NewWorkspace(t)
	for _, callee := range classDispatchCallees {
		for _, args := range []string{"", "()", "(let a)", "(let a, let b)", "(...let r)"} {
			name := fmt.Sprintf("%s%s", callee.name, args)
			t.Run(name, func(t *testing.T) {
				want := callee.extract
				if args == "" {
					want = callee.bare
				}
				source := "import { customMatcher } from \"vibelang-runtime\"\n" + callee.decl +
					"\nexport function f(s: unknown) { return match (s) { when " + callee.name + args + ": 1; default: 0; } }\n"
				r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
				if err != nil {
					t.Fatal(err)
				}
				defer r.Remove()
				var codes []string
				found := want == 0
				for _, d := range r.Diagnostics {
					if d.Code() >= 700 && d.Code() <= 707 && d.Code() != 703 || d.Code() == 107 {
						codes = append(codes, fmt.Sprint(d.Code()))
						if d.Code() == want {
							found = true
						}
					}
				}
				if !found || (want == 0 && len(codes) > 0) {
					t.Fatalf("%s: want EK%04d, got [%s]\n%s", name, want, strings.Join(codes, " "), source)
				}
			})
		}
	}
}
