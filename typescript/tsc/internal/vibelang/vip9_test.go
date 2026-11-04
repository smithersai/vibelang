package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
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

// Chapter 007 / transitional abstract service warning and migration: docs/design/src/007-tooling.md#1605bee798b7ae9f
// Appendix B: service-declaration migration — spec-rule: docs/design/src/900-appendices.md#0c9c17d47c4624e9
func TestVIP9ServiceMigration(t *testing.T) {
	got := applyQuickFix(t, "export abstract class Users { abstract name: string }\n", EK4854.Code)
	if got != "export service Users { name: string }\n" {
		t.Fatalf("got %s", got)
	}
	got = applyQuickFix(t, "service Flags { static readonly default: Flags.Shape = { enabled: true }; enabled: boolean }\n", EK4855.Code)
	if !strings.Contains(got, "class Flags extends ") || !strings.Contains(got, "static readonly default:") || strings.Contains(got, "defaultValue") {
		t.Fatalf("cached default migration: %s", got)
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

// Appendix B: default-factory result type — spec-rule: docs/design/src/900-appendices.md#75ad61987d6111ef
func TestVIP9DefaultValueMigrationKeepsPlainValues(t *testing.T) {
	got := applyQuickFix(t, "service Prefix: string { static readonly default = \"p\" }\n", EK4855.Code)
	if !strings.Contains(got, "class Prefix extends ") || !strings.Contains(got, "static readonly default = \"p\"") || strings.Contains(got, "defaultValue") {
		t.Fatalf("got %s", got)
	}

}

// The declaration carries one EK4855. Its native-class fix retains the
// cached static member and corresponding type and value reads.
// Chapter 007 / service migration rewrites corresponding value and type reads: docs/design/src/007-tooling.md#baa12561dfbf9b00
// Appendix B: default-factory read migration — spec-rule: docs/design/src/900-appendices.md#001e500ff36140ff
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
	if !strings.Contains(got, "class Flags extends ") || strings.Contains(got, "defaultValue") {
		t.Fatalf("native cached class missing: %s", got)
	}
	for _, line := range []string{"export type Value = typeof Flags.default", "export type Indexed = (typeof Flags)[\"default\"]", "export const value = Flags.default", "export const element = Flags[\"default\"]"} {
		if !strings.Contains(got, line) {
			t.Fatalf("read changed: %s\n%s", line, got)
		}
	}
	same := got + "type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false\n" +
		"type Shape = import(\"effect/Context\").Service.Shape<typeof Flags>\n" +
		"export const same: [Equal<Value, Shape>, Equal<Indexed, Shape>, Equal<Enabled, boolean>, Equal<Deep, boolean>] = [true, true, true, true]\n"

	program, file, _, _ = editorProgram(t, same)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("repaired file: %s", d.String())
		}
	}
}

// VIP-9 abstract-service and default-thunk migration, including corresponding reads; rule: docs/design/vips/0009-service-declarations.md#2af24879e9d81ad6
// VIP-9 abstract-service and default-thunk migration, including corresponding reads; rule: docs/design/vips/0009-service-declarations.md#c375919198020a1c

// VIP-9 (amended): a member is typed as in an interface. An omitted type
// follows noImplicitAny (TS7010 for a method, TS7008 for a property), an
// explicit any or plain type is valid, and VibeLang adds no diagnostic.
func TestVIP9OmittedMemberTypesFollowTypeScript(t *testing.T) {
	program, file, _, _ := editorProgram(t, "export service Reader { static readonly key = \"vip9/Reader\"; read(); value; count(): number }\n")
	var codes []int32
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, d.Code())
		}
	}
	if len(codes) != 2 || codes[0] != 7010 || codes[1] != 7008 {
		t.Fatalf("got %v, want [7010 7008]", codes)
	}
	program, file, _, _ = editorProgram(t, "export service Reader { static readonly key = \"vip9/Reader\"; read(): any; value: any; count(): number; load(): number!! }\n")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("explicit member types: %s", d.String())
		}
	}
}
