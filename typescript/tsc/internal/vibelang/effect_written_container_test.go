package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-1 requires a written Effect container, even when the written type
// would accept any value in ordinary TypeScript.
func TestEffectWrittenContainer(t *testing.T) {
	// A union of Effects is not one Effect type, as TS1064 rejects a union of
	// Promises on an async function (Chapter 1, Static rules).
	for _, annotation := range []string{"any", "unknown", "AnyAlias", "UnknownAlias", "(unknown)", "number | unknown", "number | any", "unknown & any", "never", "number",
		"Effect.Effect<number> | Effect.Effect<string>", "(number!!) | (string!TypeError)", "UnionAlias", "Effect.Effect<number> | number"} {
		for _, form := range []string{
			"export effect function f(): %s { return 1 }",
			"export const f = effect function(): %s { return 1 }",
			"export const f = effect (): %s => 1",
			"export const o = { effect f(): %s { return 1 } }",
			"export class C { effect f(): %s { return 1 } }",
		} {
			t.Run(annotation+"/"+form, func(t *testing.T) {
				source := "type AnyAlias = any; type UnknownAlias = unknown; type UnionAlias = (number!!) | (number!TypeError);\n" + strings.Replace(form, "%s", annotation, 1)
				program, file, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == diagnosticSource && d.Code() == EK0106.Code {
						count++
						if d.Category() != diagnostics.CategoryError {
							t.Errorf("EK0106 must be an error: %v", d)
						}
					}
				}
				if count != 1 {
					t.Fatalf("got %d EK0106, want 1 in %s", count, source)
				}
			})
		}
	}
	for _, source := range []string{
		"export effect function f(): number!! { return 1 }",
		"type E = number!!; export effect function f(): E { return 1 }",
		"export effect function f(): unknown!! { return 1 }",
		"export effect function f(): any!! { return 1 }",
		"export effect function f() { return 1 }",
		"export function f(): unknown { return 1 }",
		"export effect function* f(): Stream.Stream<number> { yield 1 }",
		// Identical members reduce to one Effect type, as Promise<number> | Promise<number> does for TS1064.
		"export effect function f(): Effect.Effect<number> | Effect.Effect<number> { return 1 }",
		"type Same = (number!TypeError) | (number!TypeError); export effect function f(): Same { return 1 }",
	} {
		t.Run("control/"+source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("valid control reports %s %d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}

func TestEffectWrittenContainerQuickFix(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{"export const f = effect (): any => 1", "export const f = effect () => 1"},
		{"export const f = effect (): /*contract*/ unknown => 1", "export const f = effect () /*contract*/ => 1"},
		{"export const f = effect (): /* \"contract\" */ unknown => 1", "export const f = effect () /* \"contract\" */ => 1"},
		{"export const f = effect function(): unknown { return 1 }", "export const f = effect function() { return 1 }"},
		{"export const o = { effect f(): unknown { return 1 } }", "export const o = { effect f() { return 1 } }"},
		{"export class C { effect f(): any { return 1 } }", "export class C { effect f() { return 1 } }"},
		{"export effect function f() /*head*/: /*contract*/ unknown { return 1 }", "export effect function f() /*head*/ /*contract*/ { return 1 }"},
		{"export effect function f(): //contract\n unknown { return 1 }", "export effect function f() //contract\n { return 1 }"},
		// A union of Effects becomes the one Effect of its joined channels, as
		// TS1064 suggests Promise<string | number> for Promise<number> | Promise<string>.
		{"export effect function f(): Effect.Effect<number> | Effect.Effect<string, TypeError> { return 1 }", "export effect function f(): (string | number)!TypeError { return 1 }"},
		{"export const f = effect (): (number!!) | (number!RangeError) => 1", "export const f = effect (): number!RangeError => 1"},
		{"export class C { effect f(): (number!TypeError) | (string!RangeError) { return 1 } }", "export class C { effect f(): (string | number)!(RangeError | TypeError) { return 1 } }"},
	} {
		t.Run(test.source, func(t *testing.T) {
			got := applyQuickFixOf(t, test.source, EK0106.Code, diagnostics.CategoryError)
			if got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source reports %s %d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}

func TestEffectWrittenContainerBodylessFix(t *testing.T) {
	source := "export effect function f(n: number): unknown;\nexport effect function f(n: number) { return n }"
	want := strings.Replace(source, "): unknown;", "): unknown!!;", 1)
	got := applyQuickFixOf(t, source, EK0106.Code, diagnostics.CategoryError)
	if got != want {
		t.Fatalf("bodyless signature must keep its contract: %q", got)
	}
	program, file, _, _ := editorProgram(t, got)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("fixed overload reports %s %d: %s", d.Source(), d.Code(), d.String())
		}
	}
}

// EK0106's text names one repair. A broad annotation's repair removes the
// annotation, so the message says only that; a narrow one's repair writes
// T!!, and the message offers that or leaving the type out.
func TestEffectWrittenContainerMessage(t *testing.T) {
	for _, test := range []struct{ annotation, want string }{
		{"any", "its return type can't be any: leave the return type out, and the function infers its Effect."},
		{"unknown", "its return type can't be unknown: leave the return type out, and the function infers its Effect."},
		{"number", "its return type can't be number: write number!!, or leave the return type out."},
		{"never", "its return type can't be never: write never!!, or leave the return type out."},
	} {
		t.Run(test.annotation, func(t *testing.T) {
			source := "export effect function f(): " + test.annotation + " { return 1 }"
			program, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != diagnosticSource || d.Code() != EK0106.Code {
					continue
				}
				found = true
				if text := d.String(); !strings.Contains(text, test.want) || strings.Contains(text, "write no return annotation") {
					t.Fatalf("EK0106 text %q, want it to contain %q", text, test.want)
				}
			}
			if !found {
				t.Fatalf("no EK0106 in %s", source)
			}
		})
	}
}
