package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestVIP3OmittedRequirementIsNever(t *testing.T) {
	for _, annotation := range []string{"number!never", "number!!", "Effect.Effect<number>"} {
		program, file, _, _ := editorProgram(t, "import { Effect, Context } from \"effect\"\nservice Input { value: number }\nexport effect function read(): "+annotation+" { return (try Input).value }\n")
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			t.Log(d.String())
			if d.Source() == diagnosticSource && d.Code() == EK9202.Code {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: omitted requirement must be never", annotation)
		}
	}
}

// Chapter 007 / transitional explicit requirement warning and migration: docs/design/src/007-tooling.md#1605bee798b7ae9f
func TestVIP3RequirementMigration(t *testing.T) {
	source := "service Input { value: number }\nexport effect function read(): number!never { return (try Input).value }\n"
	got := applyQuickFix(t, source, EK4853.Code)
	want := "service Input { value: number }\nexport effect function read(): number!never!Input { return (try Input).value }\n"
	if got != want {
		t.Fatalf("got %s; want %s", got, want)
	}
}

// The retired rule inferred R through calls of functions that also left R
// out, so both members of a cycle get the R the cycle needs.
func TestVIP3RequirementMigrationSolvesCycles(t *testing.T) {
	program, file, _, _ := editorProgram(t, "service Audit { note(n: number): void!! }\neffect function isEven(n: number): boolean!never { return n === 0 ? true : !(try isOdd(n - 1)) }\neffect function isOdd(n: number): boolean!never { try (try Audit).note(n); return n === 0 ? false : !(try isEven(n - 1)) }\nexport const f = isEven\n")
	var fixes []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4853.Code {
			fixes = append(fixes, d.String())
		}
	}
	if len(fixes) != 2 {
		t.Fatalf("got %d EK4853 fixes, want one for each member of the cycle: %v", len(fixes), fixes)
	}
}

// A callback without a contract may need any R, which the caller's
// declaration cannot name, so nothing is written.
func TestVIP3RequirementMigrationSkipsUnnameableRequirements(t *testing.T) {
	program, file, _, _ := editorProgram(t, "error Boom\nexport effect function raise(make: () => Boom): number!Boom { throw make() }\n")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4853.Code {
			t.Fatalf("unexpected fix: %s", d.String())
		}
	}
}

// VIP-3 requirement migration warning and mechanical fix, cycles and unnameable controls; rule: docs/design/vips/0003-effect-type-shorthand.md#26cd1ca9d30326dc

// VIP-3, amended 2026-11-02: an Effect slot written infer has no Effect
// TypeScript spelling (TS1338), so it is the error EK4857, whose fix writes
// the type the checker inferred for the slot, keeping the declared type.
func TestVIP3InferSlotWritesInferredType(t *testing.T) {
	const services = "error Gone { id: string }\nservice Users { find(id: string): string!Gone }\n"
	for _, tc := range []struct{ annotation, want string }{
		{"Effect<string, infer E, Users>", "Effect<string, Gone, Users>"},
		{"Effect<string, Gone, infer R>", "Effect<string, Gone, Users>"},
		{"Effect.Effect<string, infer E, infer R>", "Effect.Effect<string, Gone, Users>"},
		{"Effect<infer A, Gone, Users>", "Effect<string, Gone, Users>"},
		{"string!infer E!Users", "string!Gone!Users"},
		{"infer A!Gone!Users", "string!Gone!Users"},
	} {
		source := services + "export effect function load(id: string): " + tc.annotation + " { return try (try Users).find(id) }\n"
		got := applyQuickFixOf(t, source, EK4857.Code, diagnostics.CategoryError)
		want := services + "export effect function load(id: string): " + tc.want + " { return try (try Users).find(id) }\n"
		if got != want {
			t.Errorf("%s:\ngot  %s\nwant %s", tc.annotation, got, want)
		}
	}
}

// Every slot written infer is the unannotated effect function, which infers
// all three: the fix removes the annotation.
func TestVIP3InferSlotRemovesWholeInference(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{"export effect function one(): Effect<infer _, infer _, infer _> { return 1 }\n", "export effect function one() { return 1 }\n"},
		{"export const one = effect (n: number): Effect<infer A, infer E, infer R> => n\n", "export const one = effect (n: number) => n\n"},
	} {
		if got := applyQuickFixOf(t, tc.source, EK4857.Code, diagnostics.CategoryError); got != tc.want {
			t.Errorf("got  %s\nwant %s", got, tc.want)
		}
	}
}

// A type parameter of the function itself can be written in its annotation.
func TestVIP3InferSlotWritesOwnTypeParameter(t *testing.T) {
	source := "export effect function wrap<E>(program: number!E): Effect<number, infer X, never> { return try program }\n"
	want := "export effect function wrap<E>(program: number!E): Effect<number, E, never> { return try program }\n"
	if got := applyQuickFixOf(t, source, EK4857.Code, diagnostics.CategoryError); got != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
}

// vibelang --fix --fix-vip-only writes vip3-infer-slot-fixed for
// vip3-infer-slot.fail,
// apart from the header comment, and fixing the twin changes nothing. The
// harness checks that both cases declare the same API.
func TestVIP3InferSlotCase(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	cases := filepath.Join(root, "typescript/vibelang/cases")
	result := fixCaseVIPOnly(t, copyCompilerFixture(t, filepath.Join(cases, "vip3-infer-slot.fail"), root))
	if len(result.Refused) != 0 || len(result.Files) != 1 {
		t.Fatalf("fix: %+v", result)
	}
	var got string
	for _, fixed := range result.Files {
		got = fixed.Text
	}
	want, err := os.ReadFile(filepath.Join(cases, "vip3-infer-slot-fixed/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	body := func(text string) string {
		_, rest, _ := strings.Cut(text, "\nerror Gone")
		return rest
	}
	if body(got) == "" || body(got) != body(string(want)) {
		t.Fatalf("--fix writes\n%s\nwant\n%s", got, want)
	}
	if again := fixCaseVIPOnly(t, copyCompilerFixture(t, filepath.Join(cases, "vip3-infer-slot-fixed"), root)); len(again.Files) != 0 {
		t.Fatalf("fixing the twin again changes %v", again.Order)
	}
}

// fixCaseVIPOnly is fixCase for --fix --fix-vip-only, which applies the VIP
// migrations and leaves the TypeScript-style spellings, such as
// Effect.Effect<A, E, R>, for ordinary --fix.
func fixCaseVIPOnly(t *testing.T, dir string) *FixResult {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
}

// VIP-3 retires written infer slots: a required migration error is not lint.
func TestVIP3InferSlotCannotBeDisabled(t *testing.T) {
	program, file, _, _ := editorProgram(t, "// @vibelang-diagnostics-next-line EK4857:off\nexport effect function one(): number!infer E { return 1 }\n")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK4857.Code {
			if d.Category() != diagnostics.CategoryError {
				t.Fatalf("infer slot migration became %v", d.Category())
			}
			return
		}
	}
	t.Fatal("a diagnostic directive disabled the required infer-slot migration")
}
