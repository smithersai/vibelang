package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestVIP9DefaultReadClosedTypeScopes(t *testing.T) {
	for _, source := range []string{
		"type ReturnType<T> = \"wrong\"; service Flags: number { static readonly key = \"literal/Flags\"; static readonly default: 1 = 1 }\nexport type Read = typeof Flags.default; export const same: Read = 1\n",
		"enum Kind { One, Two }; type Expected = Kind; function seed(): Kind { return Kind.One }; service Flags: Kind { static readonly key = \"enum/Flags\"; static readonly default: Kind = seed() }\nnamespace Inner { type Kind = string; type Read = typeof Flags.default; export const same: [Read extends Expected ? true : false, Expected extends Read ? true : false] = [true, true] }\n",
		"type Expected = Uppercase<string>; function seed(): Expected { return \"VALUE\" }; service Flags: Expected { static readonly key = \"mapping/Flags\"; static readonly default: Expected = seed() }\nnamespace Inner { type Uppercase<T> = \"wrong\"; type Read = typeof Flags.default; export const same: [Read extends Expected ? true : false, Expected extends Read ? true : false] = [true, true] }\n",
	} {
		fixed := applyQuickFix(t, source, EK4855.Code)
		program, file, _, _ := editorProgram(t, fixed)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("repair changed a type binding: %s\n%s", d.String(), fixed)
			}
		}
	}
}

func TestVIP9DefaultReadKeepsNativeErrors(t *testing.T) {
	source := "service Flags { static readonly key = \"error/Flags\"; value: number; static readonly default: Flags.Shape = { value: 1 } }\nexport type Missing = typeof Flags.default.missing\n"
	fixed := applyQuickFix(t, source, EK4855.Code)
	program, file, _, _ := editorProgram(t, fixed)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError && d.Code() == 2339 {
			return
		}
	}
	t.Fatalf("repair erased the independent missing-property error:\n%s", fixed)
}
