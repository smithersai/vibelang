package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 004, Class patterns: "an extractor whose argument count can never
// match its pattern's list" is the lint warning EK0703. Each matcher's
// extracted list has a statically known length; the pattern admits exactly
// its item count, or at least its item count before a rest pattern.
var arityMatchers = []struct {
	name, decl, subject string
	extracts            int
}{
	{"NotFound", "error NotFound { id: string }", "unknown", 1},
	{"Cause.TimeoutError", `import * as Cause from "effect/Cause"`, "unknown", 1},
	{"Option.Some", `import * as Option from "effect/Option"`, "Option.Option<number>", 1},
	{"Option.None", `import * as Option from "effect/Option"`, "Option.Option<number>", 0},
	{"Exit.Success", `import * as Exit from "effect/Exit"`, "Exit.Exit<number, string>", 1},
	{"Result.Failure", `import * as Result from "effect/Result"`, "Result.Result<number, string>", 1},
}

const arityTarget = "FuzzExtractorArity"

// Chapter 007 / impossible extraction-list arity is an EK0703 warning: docs/design/src/007-tooling.md#5b401d8ac9c29f02

func FuzzExtractorArity(f *testing.F) {
	startShortBudget(f)
	for i := range arityMatchers {
		for k := 0; k <= 2; k++ {
			f.Add(uint8(i), uint8(k), false)
			f.Add(uint8(i), uint8(k), true)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, which, items uint8, rest bool) {
		m := arityMatchers[int(which)%len(arityMatchers)]
		k := int(items % 4)
		var bindings []string
		for i := 0; i < k; i++ {
			bindings = append(bindings, fmt.Sprintf("let v%d", i))
		}
		if rest {
			bindings = append(bindings, "...let rest")
		}
		source := m.decl + "\nexport function f(s: " + m.subject + ") { return match (s) { when " + m.name + "(" + strings.Join(bindings, ", ") + "): 1; default: 0; } }\n"
		never := k != m.extracts
		if rest {
			never = k > m.extracts
		}
		files := map[string]string{"main.vibe": source}
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := false
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 703 {
				got = true
				if d.Category() != diagnostics.CategoryWarning {
					t.Errorf("EK0703 is a warning, got category %v", d.Category())
				}
			} else if d.Category() == diagnostics.CategoryError {
				t.Fatalf("unexpected error %s in\n%s", specDiagnosticText(d), source)
			}
		}
		key := fmt.Sprintf("arity:%s:%d:%v", m.name, k, rest)
		if got != never {
			Gap(t, arityTarget, key, "chapter 004 %q: want EK0703=%v, got %v\n%s", "an extractor whose argument count can never match its pattern's list", never, got, Archive(files))
		}
		ExpectPending(t, arityTarget, key)
	})
}
