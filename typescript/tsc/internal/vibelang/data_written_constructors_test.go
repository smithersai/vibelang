package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Issue #179 (foldkit-15): a written `const Name = Data.taggedEnum<Name>()`
// beside a nongeneric `data Name { ... }` replaces the synthesized constructor
// companion so the type and constructor keep distinct JSDoc comments, order,
// and export status.
func TestDataWrittenConstructorsDistinctDocs(t *testing.T) {
	for _, tc := range []struct {
		name      string
		source    string
		typeFirst bool
	}{
		{
			name:      "data-then-const",
			source:    "import { Data } from \"effect\";\n/** Type docs. */\nexport data Item { A; B { value: number } }\n/** Constructor docs. */\nexport const Item = Data.taggedEnum<Item>();\n",
			typeFirst: true,
		},
		{
			name:      "const-then-data",
			source:    "import { Data } from \"effect\";\n/** Constructor docs. */\nexport const Item = Data.taggedEnum<Item>();\n/** Type docs. */\nexport data Item { A; B { value: number } }\n",
			typeFirst: false,
		},
		{
			name:      "prelude-data",
			source:    "/** Type docs. */\nexport data Item { A }\n/** Constructor docs. */\nexport const Item = Data.taggedEnum<Item>();\n",
			typeFirst: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("unexpected diagnostic: %s", d.String())
				}
			}
			var dts string
			program.Emit(t.Context(), compiler.EmitOptions{
				TargetSourceFiles: []*ast.SourceFile{file},
				EmitOnly:          compiler.EmitOnlyDts,
				ForceEmit:         true,
				WriteFile: func(fileName tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
					if strings.HasSuffix(string(fileName), ".d.ts") {
						dts = text
					}
					return nil
				},
			})
			if !strings.Contains(dts, "/** Type docs. */\nexport type Item = Data.TaggedEnum<") {
				t.Fatalf("missing type JSDoc on type alias:\n%s", dts)
			}
			if !strings.Contains(dts, "/** Constructor docs. */\nexport declare const Item: Data.TaggedEnum.Constructor<") {
				t.Fatalf("missing constructor JSDoc on constructor constant:\n%s", dts)
			}
			typePos := strings.Index(dts, "/** Type docs. */")
			constPos := strings.Index(dts, "/** Constructor docs. */")
			if tc.typeFirst && typePos > constPos {
				t.Fatalf("expected type before const:\n%s", dts)
			}
			if !tc.typeFirst && constPos > typePos {
				t.Fatalf("expected const before type:\n%s", dts)
			}
		})
	}
}
