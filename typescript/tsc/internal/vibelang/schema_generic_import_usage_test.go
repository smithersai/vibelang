package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestSchemaGenericOrganizeImports(t *testing.T) {
	packages := map[string]string{
		"effect":           "packages/runtime/node_modules/effect",
		"vibelang-runtime": "packages/runtime",
		"bindings":         "typescript/tsc/internal/vibelang/testdata/schema-generic-imports",
	}
	for _, tc := range []struct {
		name, source, keep, remove string
		errors                     int
	}{
		{"invalid record shadow", "import type { Entry as Record, Unused } from \"bindings\"; schema S { readonly a:Record<string,number> }", "Entry", "Unused", 1},
		{"record alias", "import type { Dictionary, Unused } from \"bindings\"; schema S=Dictionary<\"x\",number>; function f(s:S){s.x=1}", "Dictionary", "Unused", 0},
		{"array alias", "import type { Sequence, Unused } from \"bindings\"; schema S=Sequence<number>; function f(s:S){s.push(1)}", "Sequence", "Unused", 0},
		{"namespace", "import type * as Bindings from \"bindings\"; schema S=Bindings.Dictionary<\"x\",number>", "Bindings", "", 0},
		{"default shadow", "import type Record from \"bindings\"; schema S=Record<string,number>", "Record", "", 1},
		{"escaped", "import type { Entry as Rec\\u006frd, Unused } from \"bindings\"; schema S=Rec\\u006frd<string,number>", "Entry", "Unused", 1},
		{"local type shadow", "import type { Entry as Record } from \"bindings\"; function f(){type Record<K,V>={k:K;v:V}; schema S=Record<string,number>}", "", "Entry", 1},
		{"string mention", "import type { Entry as Record } from \"bindings\"; const note=\"Record<string,number>\";", "", "Entry", 0},
		{"value local keeps type import", "import type { Entry as Record } from \"bindings\"; function f(){const Record=1;schema S=Record<string,number>}", "Entry", "", 1},
		{"same target unused alias", "import type { Dictionary as Used, Dictionary as Unused } from \"bindings\"; schema S=Used<\"x\",number>", "Used", "Unused", 0},
	} {
		for _, kind := range []lsproto.CodeActionKind{lsproto.CodeActionKindSourceOrganizeImportsTs, lsproto.CodeActionKindSourceRemoveUnusedImportsTs} {
			t.Run(tc.name+"/"+string(kind), func(t *testing.T) {
				program, file, service, converters := editorProgramWith(t, tc.source, packages)
				count := 0
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Code() != EK2109.Code {
						t.Fatalf("setup: unexpected error %s", d.String())
					}
					count++
				}
				if count != tc.errors {
					t.Fatalf("setup errors %d, want %d", count, tc.errors)
				}
				changes := service.OrganizeImports(t.Context(), file, program, kind)
				after := applyEditorEdits(t, file, converters, changes[file.FileName()])
				if tc.keep != "" && !strings.Contains(after, tc.keep) {
					t.Errorf("lost required import %q: %s", tc.keep, after)
				}
				if tc.remove != "" && strings.Contains(after, tc.remove) {
					t.Errorf("kept unused import %q: %s", tc.remove, after)
				}
				checked, next, _, _ := editorProgramWith(t, after, packages)
				got := 0
				for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), next), checked.GetSemanticDiagnostics(t.Context(), next)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Code() != EK2109.Code {
						t.Errorf("new error %s", d.String())
					}
					got++
				}
				if got != tc.errors {
					t.Errorf("organized errors %d, want %d: %s", got, tc.errors, after)
				}
			})
		}
	}
}
