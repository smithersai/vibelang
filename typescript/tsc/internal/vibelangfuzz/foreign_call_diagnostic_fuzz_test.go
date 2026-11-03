package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const foreignDiagnosticTarget = "FuzzForeignCallDiagnostic"
const foreignDiagnosticDefault = "Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload."
const foreignDiagnosticRule = "| In effect code or a plain `catch` handler's parameter/default/destructuring initialization or body, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |"

func TestForeignCallDiagnosticQuoted(t *testing.T) {
	for _, quote := range []string{foreignDiagnosticDefault, foreignDiagnosticRule} {
		if !strings.Contains(SpecText(failuresChapter), quote) {
			t.Fatalf("%s no longer says %q", failuresChapter, quote)
		}
	}
}

// Reuse chapter 3's foreign-call forms, varying source versus declarations,
// call positions. Each keyed seed requires exactly EK0403,
// excluding the legacy trust gate rather than merely requiring rejection.
func FuzzForeignCallDiagnostic(f *testing.F) {
	startShortBudget(f)
	keys := []string{"library-unannotated", "library-unknown-tag", "interface-member", "foreign-const", "foreign-method", "foreign-overload", "foreign-function-property", "foreign-function-field"}
	var cases []*failCase
	for _, key := range keys {
		i := slices.IndexFunc(failuresCases(), func(c *failCase) bool { return c.Name == key })
		if i < 0 {
			f.Fatalf("missing foreign-call case %s", key)
		}
		cases = append(cases, failuresCases()[i])
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		TestForeignCallDiagnosticQuoted(t)
		i := slices.Index(keys, key)
		if i < 0 {
			i = len(key) % len(keys)
		}
		c := *cases[i]
		c.Lib += "\n/** @throws {never} */\nexport declare function safeControl(s: string): string\n"
		// The marker remains around the native invocation in every position.
		switch choice % 4 {
		case 1:
			c.Body = "const held = " + c.Body
		case 2:
			c.Body = "if (s.length > 0) { " + c.Body + " }"
		case 3:
			c.Body = "void (" + c.Body + ")"
		}
		c.Body += "\nsafeControl(s)"
		files, span := failuresProject(&c, choice)
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var errors []string
		matched := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 403 && d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "/main.vibe") && d.Pos() <= span[1] && d.End() >= span[0] {
				matched++
			} else {
				errors = append(errors, describe(d))
			}
		}
		gapKey := fmt.Sprintf("foreign:%s:%d", keys[i], choice%4)
		if matched != 1 || len(errors) != 0 {
			Gap(t, foreignDiagnosticTarget, gapKey, "VIP-4: %s; %s: got %d EK0403 diagnostics, other errors %v\n%s", foreignDiagnosticDefault, foreignDiagnosticRule, matched, errors, Archive(files))
		}
		ExpectPending(t, foreignDiagnosticTarget, gapKey)
	})
}
