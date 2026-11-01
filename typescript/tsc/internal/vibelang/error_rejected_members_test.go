package vibelang

import (
	"strconv"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorRejectedMembers(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, member := range []string{"id = 1", "private id?: string", "#id = 1", "declare id: string", "accessor id = 1", "[key: string]: unknown",
			// TypeScript's own errors inside the member (TS2564, TS2411, TS4113) are dropped: one diagnostic.
			"private id: string", "protected id: number", "public id: string", "[key: string]: number", "override id: string",
			// TS2415 at the name: the member hides a base member's visibility.
			"private message: string", "protected name: string", "private readonly stack: string"} {
			source := form + " E { " + member + " }\n"
			t.Run(source, func(t *testing.T) {
				program, file, _, _ := editorProgram(t, source)
				var codes []string
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						codes = append(codes, d.Source()+strconv.Itoa(int(d.Code())))
					}
				}
				if len(codes) != 1 || codes[0] != "EK1304" {
					t.Fatalf("got %v, want one EK1304", codes)
				}
			})
		}
		source := "interface Contract { readonly id: string }\nexport " + form + " E implements Contract { id: string }\n"
		t.Run(source, func(t *testing.T) {
			fixed := applyQuickFixOf(t, source, 1304, diagnostics.CategoryError)
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Error(d.String())
				}
			}
		})
	}
}

func TestErrorRejectedMemberMigration(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		source := "export " + form + " E { id: string; private count = 1; get value() { return this.id + this.count } }\n"
		fixed := applyQuickFixOf(t, source, 1304, diagnostics.CategoryError)
		program, file, _, _ := editorProgram(t, fixed+"\nconst value: string = new E({ id: \"x\" }).value;\n")
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Error(d.String())
			}
		}
	}
}

func TestErrorRejectedMemberKeepsTypeScriptErrorsOutside(t *testing.T) {
	// Dropping a rejected member's TypeScript errors does not hide errors elsewhere in the body.
	program, file, _, _ := editorProgram(t, "error E { id = 1; get value(): number { return \"x\" } }")
	var codes []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, d.Source()+strconv.Itoa(int(d.Code())))
		}
	}
	if len(codes) != 2 || codes[0] != "EK1304" && codes[1] != "EK1304" {
		t.Fatalf("got %v, want EK1304 and the getter's TS2322", codes)
	}
}

func TestErrorRejectedMembersExclusions(t *testing.T) {
	for _, source := range []string{
		"error E { id: string; readonly n: number; optional?: string; private m() { return 1 }; get value() { return this.id } }",
		"schema error E { id: string; readonly n: number; optional?: string; private m() { return 1 }; get value() { return this.id } }",
		"class E { id = 1; private value?: string }",
		"error E { static id = 1; set value(x: string) {} }",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == 1304 {
				t.Errorf("unexpected EK1304: %s", source)
			}
		}
	}
}

func TestErrorMemberFirstMatchingRule(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		program, file, _, _ := editorProgram(t, form+" E { static set value(x: string) {} }")
		count := 0
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == 1302 || d.Code() == 1304 {
				count++
			}
		}
		if count != 1 {
			t.Errorf("got %d diagnostics for one static setter", count)
		}
	}
}
