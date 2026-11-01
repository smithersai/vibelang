package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-15/detail286: the selected library symbol controls both decoded
// mutability and runtime codec construction; spelling alone proves neither.
func TestSchemaGenericArrayBindings(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		errors       int
	}{
		{"qualified mutable", "schema S = globalThis.Array<number>; const xs:S=[]; xs.push(1);", 0},
		{"qualified readonly", "schema S = globalThis.ReadonlyArray<number>; const xs:S=[];\n// @ts-expect-error readonly\nxs.push(1);", 0},
		{"namespace alias", "namespace N { export import Sequence = globalThis.Array }; schema S = N.Sequence<number>; const xs:S=[]; xs.push(1);", 0},
		{"renamed local alias", "namespace N { export import Sequence = globalThis.Array; export function f() { schema S=Sequence<number>; const xs:S=[]; xs.push(1); return xs } }", 0},
		{"swapped Array", "namespace N { export import Array = globalThis.ReadonlyArray; export schema S=Array<number>; const xs:S=[];\n// @ts-expect-error readonly\nxs.push(1); }", 0},
		{"swapped ReadonlyArray", "namespace N { export import ReadonlyArray = globalThis.Array; export schema S=ReadonlyArray<number>; const xs:S=[]; xs.push(1); }", 0},
		{"value only", "const Array=1; schema S=Array<number>; const xs:S=[]; xs.push(1);", 0},
		{"custom type", "type Array<T>={value:T}; schema S=Array<number>;", 1},
		{"schema own name", "schema Array=Array<number>;", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export {};\n"+tc.source+"\n")
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == EK2109.Code {
					count++
				} else if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
			if count != tc.errors {
				t.Errorf("EK2109 count %d, want %d", count, tc.errors)
			}
		})
	}
}

func TestSchemaGenericArrayExpansionPreservesBinding(t *testing.T) {
	for _, source := range []string{
		"namespace N { export import Sequence=globalThis.Array }; const Optional=Schema.optional(Schema.Number); schema S { items:N.Sequence<number>; required:Optional }; function f(s:S){s.items.push(1)}",
		"namespace N { export import Sequence=globalThis.Array }; const Optional=Schema.optional(Schema.Number); schema S=[N.Sequence<number>,{required:Optional}]; function f(s:S){s[0].push(1)}",
		"namespace N { export import Array=globalThis.ReadonlyArray; const Optional=Schema.optional(Schema.Number); schema S { items:Array<number>; required:Optional }; function f(s:S){\n// @ts-expect-error readonly\ns.items.push(1) } }",
	} {
		fixed := applyQuickFixOf(t, source, EK2109.Code, diagnostics.CategoryError)
		program, file, _, _ := editorProgram(t, fixed)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("expansion changed the selected array type: %s\n%s", d.String(), fixed)
			}
		}
	}
}

func TestSchemaGenericArrayVisibleParents(t *testing.T) {
	_, file, _, _ := editorProgram(t, "schema S=globalThis.Array<{xs:globalThis.ReadonlyArray<number>}>;")
	var visit func(*ast.Node)
	visit = func(parent *ast.Node) {
		parent.ForEachChild(func(child *ast.Node) bool {
			if child.Parent != parent {
				t.Errorf("child %s has parent %v, want %s", child.Kind, child.Parent, parent.Kind)
			}
			visit(child)
			return false
		})
	}
	visit(file.AsNode())
}

func TestSchemaGenericArrayInverseNames(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		expected     int
	}{
		{"swapped mutable", "namespace N { export import Array=globalThis.ReadonlyArray; const Codec=Schema.Struct({xs:Schema.mutableKey(Schema.mutable(Schema.Array(Schema.Number)))}); type Codec=typeof Codec.Type }", 0},
		{"swapped readonly", "namespace N { export import ReadonlyArray=globalThis.Array; const Codec=Schema.Struct({xs:Schema.mutableKey(Schema.Array(Schema.Number))}); type Codec=typeof Codec.Type }", 0},
		{"value only", "const Array=1; const Codec=Schema.Struct({xs:Schema.mutableKey(Schema.mutable(Schema.Array(Schema.Number)))}); type Codec=typeof Codec.Type", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK4832.Code {
					count++
				}
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected error %s", d.String())
				}
			}
			if count != tc.expected {
				t.Errorf("schema rewrite count %d, want %d", count, tc.expected)
			}
		})
	}
}
