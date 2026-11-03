package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const doMethodBindTarget = "FuzzDoMethodBind"
const doMethodBindQuote = "Calls keep ECMA-262's `EvaluateCall` and `ArgumentListEvaluation`, and lowering adds no observable helper lookup"
const doMethodBindDeclarationQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func TestDoMethodBindQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", doMethodBindQuote)
	chapterSays(t, "001-functions.md", doMethodBindDeclarationQuote)
}

var doMethodBindKeys = []string{"wrong-return", "noncallable", "nullable", "getter", "generic", "overload", "explicit-this", "element", "tag", "super", "loose-bind", "written-bind"}

// Compare the compiler with itself on the TypeScript twin: the quoted rules
// require identical diagnostics and declarations for an immediate do operand
// and its ordinary argument. The stock tsc witness is also covered by the
// native case. This static oracle does not duplicate runtime differential tests.
func FuzzDoMethodBind(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", doMethodBindQuote)
	chapterSays(f, "001-functions.md", doMethodBindDeclarationQuote)
	w := NewWorkspace(f)
	for _, key := range doMethodBindKeys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		if !slices.Contains(doMethodBindKeys, key) {
			key = doMethodBindKeys[int(variant)%len(doMethodBindKeys)]
		}
		argument := "2"
		for i := 0; i < int(variant>>1)%4+1; i++ {
			argument = "(do { " + argument + " })"
		}
		vibe, twin := doMethodBindProgram(key, argument)
		if variant&1 != 0 {
			vibe += "\nexport const reject: boolean = probe()"
			twin += "\nexport const reject: boolean = probe()"
		}
		config := func(file string) string {
			cfg := fmt.Sprintf(errorTwinConfig, file)
			if key == "loose-bind" {
				cfg = strings.Replace(cfg, `"strict":true`, `"strict":true,"strictBindCallApply":false`, 1)
			}
			return cfg
		}
		baseline, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.ts": twin}, Config: config("main.ts")}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer baseline.Remove()
		var want []string
		for _, d := range baseline.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				want = append(want, fmt.Sprintf("TS%d", d.Code()))
			}
		}
		result, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.vibe": vibe}, Config: config("main.vibe")}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var got []string
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				prefix := "TS"
				if IsEK(d) {
					prefix = "EK"
				}
				got = append(got, fmt.Sprintf("%s%d", prefix, d.Code()))
			}
		}
		slices.Sort(got)
		slices.Sort(want)
		gap := fmt.Sprintf("%s:variant-%d", key, variant%8)
		if !slices.Equal(got, want) {
			Gap(t, doMethodBindTarget, "diagnostics:"+gap, "%s\nVibe %v; TypeScript %v\n%s\n%s", doMethodBindQuote, got, want, vibe, twin)
		}
		if len(want) == 0 {
			expected, ok := baseline.Outputs["__identity_out/main.d.ts"]
			if !ok {
				t.Fatal("missing TypeScript declaration", baseline.Outputs)
			}
			actual, ok := result.Outputs["__identity_out/main.d.ts"]
			if !ok {
				t.Fatal("missing declaration", result.Outputs)
			}
			if actual != expected {
				Gap(t, doMethodBindTarget, "declarations:"+gap, "%s\nVibe:\n%s\nTypeScript:\n%s\n%s", doMethodBindDeclarationQuote, actual, expected, vibe)
			}
		}
		ExpectPending(t, doMethodBindTarget, "diagnostics:"+gap)
		ExpectPending(t, doMethodBindTarget, "declarations:"+gap)
		ExpectPending(t, doMethodBindTarget, specCorpusKey(t))
	})
}

func doMethodBindProgram(key, argument string) (string, string) {
	fn, bind, access := "(n: number): number => n + 1", "(_self: unknown) => (n: number): string => 'wrong'", "obj.f(%s)"
	prefix := ""
	switch key {
	case "noncallable", "loose-bind":
		bind = "0"
	case "nullable":
		bind = "null"
	case "generic":
		fn, bind = "<T>(n: T): T => n", "false"
	case "overload":
		prefix = "function select(n: number): number; function select(n: string): string; function select(n: number | string): number | string { return n }; "
		fn, bind = "select", "false"
	case "explicit-this":
		fn = "function(this: {base: number}, n: number): number { return this.base + n }"
	case "element":
		access = "obj['f'](%s)"
	case "tag":
		fn, access = "(parts: TemplateStringsArray, n: number): number => n + parts.length", "obj.f`head${%s}tail`"
	case "written-bind":
		access = "obj.f.bind(obj)(%s)"
	}
	property := "bind: " + bind
	if key == "getter" {
		property = "get bind(): false { return false }"
	}
	prefix += "const f = Object.assign(" + fn + ", {" + property + "}); const obj = { f, base: 10 }; "
	call := fmt.Sprintf(access, argument)
	if key == "super" {
		// A method (rather than a class field) supplies super's property lookup.
		prefix = "class Base { f(n: number): number { return n + 1 } }; Object.assign(Base.prototype.f, { bind: 0 }); class Derived extends Base { probe() { return " + fmt.Sprintf("super.f(%s)", argument) + " } }; "
		call = "new Derived().probe()"
	}
	vibe := prefix + "export function probe() { return " + call + " }"
	twin := strings.ReplaceAll(vibe, argument, "2")
	twin = strings.Replace(twin, "export function probe()", "\n/** @throws {never} */\nexport function probe()", 1)
	return vibe, twin
}
