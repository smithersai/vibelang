package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestVIP9AbstractClassIsOrdinary(t *testing.T) {
	_, file, _, _ := editorProgram(t, "abstract class Users { abstract name: string }\n")
	if classKindOf(file.Statements.Nodes[0]) != ordinaryClass {
		t.Fatal("abstract classes must not declare services")
	}
}

func TestVIP9DefaultValueThunk(t *testing.T) {
	for _, source := range []string{
		"service Flags { static readonly defaultValue = () => ({ enabled: true }); enabled: boolean }\nexport effect function read(): boolean!! { return (try Flags).enabled }",
		"service Flags { static readonly defaultValue: () => Flags.Shape = () => ({ enabled: true }); enabled: boolean }\n",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("%s", d.String())
			}
		}
	}
}

func TestVIP9InvalidDefaultValue(t *testing.T) {
	for _, initializer := range []string{"{ enabled: true }", "() => ({ enabled: 42 })", "() => ({})"} {
		program, file, _, _ := editorProgram(t, "service Flags { static readonly defaultValue = "+initializer+"; enabled: boolean }\n")
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				found = true
			}
		}
		if !found {
			t.Errorf("accepted invalid defaultValue %s", initializer)
		}
	}
}

func TestVIP9ServiceMigration(t *testing.T) {
	got := applyQuickFix(t, "export abstract class Users { abstract name: string }\n", EK4854.Code)
	if got != "export service Users { name: string }\n" {
		t.Fatalf("got %s", got)
	}
	got = applyQuickFix(t, "service Flags { static readonly default: Flags.Shape = { enabled: true }; enabled: boolean }\n", EK4855.Code)
	want := "service Flags { static readonly defaultValue: () => Flags.Shape = () => ({ enabled: true }); enabled: boolean }\n"
	if got != want {
		t.Fatalf("got %s; want %s", got, want)
	}
}

func TestVIP9ExplicitKeyCollision(t *testing.T) {
	p, file, _, _ := editorProgram(t, "service A { static readonly key = \"app/shared\"; value: number }\nservice B { static readonly key = \"app/shared\"; value: number }\n")
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK3001.Code {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("got %d duplicate-key errors, want 2", count)
	}
}

func TestVIP9DefaultValueMigrationKeepsPlainValues(t *testing.T) {
	got := applyQuickFix(t, "service Prefix: string { static readonly default = \"p\" }\n", EK4855.Code)
	want := "service Prefix: string { static readonly defaultValue = () => \"p\" }\n"
	if got != want {
		t.Fatalf("got %s; want %s", got, want)
	}
}

// RC-19: the declaration carries one EK4855 whose fix rewrites every read in
// the file, type reads as the type the factory returns, so the repaired file
// compiles and its exported types keep their meaning.
func TestVIP9DefaultValueMigrationRewritesReads(t *testing.T) {
	source := "service Flags { static readonly key = \"vip9/Flags\"; static readonly default: Flags.Shape = { enabled: true }; enabled: boolean }\n" +
		"export type Value = typeof Flags.default\n" +
		"export type Indexed = (typeof Flags)[\"default\"]\n" +
		"export type Enabled = (typeof Flags.default)[\"enabled\"]\n" +
		"export type Deep = typeof Flags.default.enabled\n" +
		"export const value = Flags.default\n" +
		"export const element = Flags[\"default\"]\n"
	program, file, _, _ := editorProgram(t, source)
	warnings := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4855.Code {
			warnings++
		}
	}
	if warnings != 1 {
		t.Fatalf("got %d EK4855 warnings, want 1 at the declaration, whose fix carries the reads", warnings)
	}
	got := applyQuickFix(t, source, EK4855.Code)
	want := "service Flags { static readonly key = \"vip9/Flags\"; static readonly defaultValue: () => Flags.Shape = () => ({ enabled: true }); enabled: boolean }\n" +
		"export type Value = ReturnType<typeof Flags.defaultValue>\n" +
		"export type Indexed = ReturnType<(typeof Flags)[\"defaultValue\"]>\n" +
		"export type Enabled = (ReturnType<typeof Flags.defaultValue>)[\"enabled\"]\n" +
		"export type Deep = ReturnType<typeof Flags.defaultValue>[\"enabled\"]\n" +
		"export const value = Flags.defaultValue()\n" +
		"export const element = Flags[\"defaultValue\"]()\n"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	same := want + "type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false\n" +
		"export const same: [Equal<Value, Flags.Shape>, Equal<Indexed, Flags.Shape>, Equal<Enabled, boolean>, Equal<Deep, boolean>] = [true, true, true, true]\n"
	program, file, _, _ = editorProgram(t, same)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("repaired file: %s", d.String())
		}
	}
}

// VIP-9 abstract-service and default-thunk migration, including corresponding reads; rule: docs/design/vips/0009-service-declarations.md#2af24879e9d81ad6
// VIP-9 abstract-service and default-thunk migration, including corresponding reads; rule: docs/design/vips/0009-service-declarations.md#c375919198020a1c
