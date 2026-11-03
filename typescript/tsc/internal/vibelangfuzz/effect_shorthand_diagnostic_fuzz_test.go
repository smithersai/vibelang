package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

const effectShorthandDiagnosticQuote = "There is no top-level shorthand: `effect load() { }` and `async load() { }` outside a class or object literal are syntax errors, with a quick fix that inserts `function`."

func TestEffectShorthandDiagnosticQuoted(t *testing.T) {
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), effectShorthandDiagnosticQuote) {
		t.Fatal("stale VIP-1 shorthand quote")
	}
}

func FuzzEffectShorthandDiagnostic(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(string(chapter), effectShorthandDiagnosticQuote) {
		f.Fatal("stale VIP-1 shorthand quote")
	}
	code := chapterCode(f, chapter, effectShorthandDiagnosticQuote)
	for _, key := range []string{"effect", "async"} {
		for _, bits := range []uint8{0, 1, 2, 4, 8, 15} {
			f.Add(key, bits)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, bits uint8) {
		modifier := "effect"
		if key == "async" || key != "effect" && bits&16 != 0 {
			modifier = "async"
		}
		head, tail := "", ""
		switch bits % 3 {
		case 1:
			head = "export "
		case 2:
			head, tail = "function outer() { ", " }"
		}
		trivia, parameters := " ", "()"
		if bits&4 != 0 {
			trivia = " /* keep */ "
		}
		if bits&8 != 0 {
			parameters = "<T>(n: T)"
		}
		compile := func(source string) *Result {
			result, err := w.Compile(context.Background(), Single(source+"\nexport {}"))
			if err != nil {
				t.Fatal(err)
			}
			return result
		}
		source := head + modifier + trivia + "load" + parameters + " {}" + tail
		result := compile(source)
		defer result.Remove()
		found := 0
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == code {
				found++
			}
			if IsEK(d) && d.Code() == 4618 {
				Gap(t, "FuzzEffectShorthandDiagnostic", "owner:"+modifier, "retired EK4618: %v", Keys(result.Dir, result.Diagnostics))
			}
		}
		if found != 1 {
			Gap(t, "FuzzEffectShorthandDiagnostic", "owner:"+modifier, "%s; expected exactly one EK%04d\n%s\n%v", effectShorthandDiagnosticQuote, code, source, Keys(result.Dir, result.Diagnostics))
		}
		fixed := compile(head + modifier + trivia + "function load" + parameters + " {}" + tail)
		defer fixed.Remove()
		if HasError(fixed.Diagnostics) {
			Gap(t, "FuzzEffectShorthandDiagnostic", "repair:"+modifier, "canonical declaration rejected: %v", Keys(fixed.Dir, fixed.Diagnostics))
		}
		method := compile("const o = { " + modifier + trivia + "load" + parameters + " {} }; class C { " + modifier + trivia + "load" + parameters + " {} }")
		defer method.Remove()
		if HasError(method.Diagnostics) {
			Gap(t, "FuzzEffectShorthandDiagnostic", "method:"+modifier, "method control rejected: %v", Keys(method.Dir, method.Diagnostics))
		}
	})
}
