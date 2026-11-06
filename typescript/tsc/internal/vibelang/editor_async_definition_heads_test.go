package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncAwaitedDefinitions(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"object-method", "const item = { [await input]() { return 1 } }; return 1", 0},
		{"object-getter", "const item = { get [await input]() { return 1 } }; return 1", 0},
		{"object-setter", "const item = { set [await input](value: number) {} }; return 1", 0},
		{"class-method", "class Inner { [await input]() { return 1 } }; return 1", 0},
		{"class-static-method", "class Inner { static [await input]() { return 1 } }; return 1", 0},
		{"class-heritage", "class Inner extends (await base) {}; return 1", 0},
		{"nested-heritage", "class Inner extends (class extends (await base) {}) {}; return 1", 0},
		{"nested-async-method-control", "const item = { async method() { return await input } }; return 1", 1},
		{"nested-async-class-control", "class Inner { async method() { return await input } }; return 1", 1},
		{"nested-async-arrow-control", "const inner = async () => await input; return 1", 1},
		{"computed-inner-async-control", "const item = { [(async () => await input).name]() { return 1 } }; return 1", 1},
		{"operand-object-method", "const item = await Promise.resolve({ [await input]() { return 1 } }); return 1", 0},
		{"operand-object-getter", "const item = await Promise.resolve({ get [await input]() { return 1 } }); return 1", 0},
		{"operand-object-setter", "const item = await Promise.resolve({ set [await input](value: number) {} }); return 1", 0},
		{"operand-class-method", "const item = await Promise.resolve(class { [await input]() { return 1 } }); return 1", 0},
		{"operand-class-static-method", "const item = await Promise.resolve(class { static [await input]() { return 1 } }); return 1", 0},
		{"operand-class-heritage", "const item = await Promise.resolve(class extends (await base) {}); return 1", 0},
		{"operand-nested-heritage", "const item = await Promise.resolve(class extends (class extends (await base) {}) {}); return 1", 0},
		{"operand-nested-async-method-control", "const item = await Promise.resolve({ async method() { return await input } }); return 1", 2},
		{"operand-nested-async-class-control", "const item = await Promise.resolve(class { async method() { return await input } }); return 1", 2},
		{"operand-nested-async-arrow-control", "const item = await Promise.resolve(async () => await input); return 1", 2},
		{"operand-computed-inner-async-control", "const item = await Promise.resolve({ [(async () => await input).name]() { return 1 } }); return 1", 2},
		{"outer-await-control", "const key = await input; const item = { [key]() { return 1 } }; return key", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "export async function load(input: Promise<\"key\">, base: Promise<new () => object>) { " + tc.body + " }"
			pos := strings.Index(source, "async")
			program, file, service, converters := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid original: %s\n%s", d.String(), source)
				}
			}
			count := 0
			for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
				if !strings.HasPrefix(action.Description, "Convert to a VibeLang function") {
					continue
				}
				count++
				got := applyEditorEdits(t, file, converters, action.Changes)
				checked, edited, _, _ := editorProgram(t, got)
				for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("invalid converted definition head: %s\n%s", d.String(), got)
					}
				}
			}
			if count != tc.want {
				t.Errorf("offered %d conversions, want %d", count, tc.want)
			}
		})
	}
}
