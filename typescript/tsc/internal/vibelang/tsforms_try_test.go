package vibelang

import (
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Detail 254 limits these advisories to the written bare-try operand; an
// eventual execution in a child, callback or collection is not that consumer.
func TestDirectTryFormWarnings(t *testing.T) {
	families := []struct {
		name, call string
		code       int32
	}{
		{"succeed", "%s.succeed(1)", 4834},
		{"fail", "%s.fail(\"boom\")", 4834},
		{"catch", "%s.catch(e, h)", 4835},
		{"provide", "%s.provide(e, Layer.empty)", 4836},
	}
	consumers := []struct {
		name, form string
		warn       bool
	}{
		{"bare", "const v = try %s; void v", true},
		{"parenthesized", "const v = try ((%s)); void v", true},
		{"asserted", "const v = try (%s as number!string); void v", true},
		{"checked", "const v = try (%s satisfies number!string); void v", true},
		{"non-null", "const v = try (%s)!; void v", true},
		{"stored", "const v = %s; void v", false},
		{"returned", "return %s", false},
		{"fork", "const v = fork %s; void v", false},
		{"callback", "const v = try Effect.andThen(Effect.void, () => %s); void v", false},
		{"collection", "const v = try.all [%s]; void v", false},
		{"catch-head", "const v = %s catch () => 0; void v", false},
	}
	for _, family := range families {
		for _, consumer := range consumers {
			for _, spelling := range []string{"Effect", "E"} {
				t.Run(family.name+"/"+consumer.name+"/"+spelling, func(t *testing.T) {
					source := "import * as E from \"effect/Effect\"\nexport effect function f(e: number!string, h: (x: string) => number!!) {\n" +
						fmt.Sprintf(consumer.form, fmt.Sprintf(family.call, spelling)) + "\n}\n"
					p, file, _, _ := editorProgram(t, source)
					var codes []int32
					for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
						if d.Source() == diagnosticSource && slices.Contains([]int32{4834, 4835, 4836}, d.Code()) {
							codes = append(codes, d.Code())
						}
					}
					want := []int32(nil)
					if consumer.warn {
						want = []int32{family.code}
					}
					if !slices.Equal(codes, want) {
						t.Fatalf("advisories %v, want %v:\n%s", codes, want, source)
					}
				})
			}
		}
	}
}

func TestDirectTryFormSafeFixes(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{"export effect function f() { return try Effect.succeed(1) }", "export effect function f() { return 1 }"},
		{"export effect function f() { return try Effect.fail(\"boom\") }", "export effect function f() { throw \"boom\" }"},
	} {
		t.Run(test.source, func(t *testing.T) {
			if got := applyQuickFix(t, test.source, 4834); got != test.want {
				t.Fatalf("got:\n%s\nwant:\n%s", got, test.want)
			}
		})
	}
}

// A written assertion or check cannot disappear just because the underlying
// call has an advisory. Refuse the rewrite rather than delete its type effect.
func TestDirectTryFormWrappedFixRefusal(t *testing.T) {
	for _, operand := range []string{
		"(Effect.succeed(1) as number!!)",
		"(Effect.fail(\"boom\") as never!string)",
		"(Effect.succeed(1))!",
		"((Effect.fail(\"boom\")))",
	} {
		t.Run(operand, func(t *testing.T) {
			source := "export effect function f() { const value = try " + operand + "; return 0 }"
			p, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				found = found || d.Source() == diagnosticSource && d.Code() == 4834
			}
			if !found {
				t.Fatalf("missing EK4834:\n%s", source)
			}
			c, done := p.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			tsFormRules[4834].find(c, file, func(_ *ast.Node, rewrite *formRewrite, _ ...any) {
				if rewrite.fixable() || rewrite == nil || rewrite.why == "" {
					t.Fatalf("wrapped operand must retain its source and explain why: %+v", rewrite)
				}
			})
		})
	}
}

func TestDirectTryFormShadowedImport(t *testing.T) {
	source := "import * as E from \"effect/Effect\"\nexport effect function f(E: { succeed: (n: number) => number!! }) {\n  const value = try E.succeed(1)\n  void value\n  return 0\n}"
	p, file, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && d.Code() == 4834 {
			t.Fatalf("a local parameter shadows the import: %s", d.String())
		}
	}
}

// The EK4834-EK4836 rows warn only on a try in effect code (chapter 7,
// "TypeScript spellings with VibeLang forms"). A try in a plain or async
// function is EK0501 and runs nothing, so no running form is there to rewrite.
func TestDirectTryFormOnlyInEffectCode(t *testing.T) {
	params := "(e: number!string, h: (x: string) => number!!)"
	contexts := []struct {
		name, form string
		warn       bool
	}{
		{"plain-arrow", "export const f = " + params + " => try %s", false},
		{"plain-arrow-parens", "export const f = " + params + " => try (%s)", false},
		{"plain-function", "export function f" + params + " { return try %s }", false},
		{"async-function", "export async function f" + params + " { return try %s }", false},
		{"plain-in-effect", "export effect function f" + params + " { const g = () => try %s; return 0 }", false},
		{"effect-arrow", "export const f = effect " + params + " => try %s", true},
		{"effect-function", "export effect function f" + params + " { return try (%s) }", true},
	}
	for _, family := range []struct {
		name, call string
		code       int32
	}{
		{"succeed", "Effect.succeed(1)", 4834},
		{"fail", "Effect.fail(\"boom\")", 4834},
		{"catch", "Effect.catch(e, h)", 4835},
		{"provide", "Effect.provide(e, Layer.empty)", 4836},
	} {
		for _, context := range contexts {
			t.Run(family.name+"/"+context.name, func(t *testing.T) {
				source := fmt.Sprintf(context.form, family.call) + "\n"
				p, file, _, _ := editorProgram(t, source)
				var codes []int32
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == diagnosticSource && slices.Contains([]int32{4834, 4835, 4836}, d.Code()) {
						codes = append(codes, d.Code())
					}
				}
				want := []int32(nil)
				if context.warn {
					want = []int32{family.code}
				}
				if !slices.Equal(codes, want) {
					t.Fatalf("advisories %v, want %v:\n%s", codes, want, source)
				}
			})
		}
	}
}
