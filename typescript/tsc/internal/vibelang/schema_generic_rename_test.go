package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestSchemaGenericRename(t *testing.T) {
	packages := map[string]string{
		"effect":           "packages/runtime/node_modules/effect",
		"vibelang-runtime": "packages/runtime",
		"bindings":         "typescript/tsc/internal/vibelang/testdata/schema-generic-imports",
	}
	for _, tc := range []struct {
		name, source, old, next, want string
		errors                        int
	}{
		{"default", "import type Record from \"bindings\"; schema S=Record<string,number>", "Record", "Fresh", "schema S=Fresh<string,number>", 1},
		{"namespace", "import type * as Bindings from \"bindings\"; schema S=Bindings.Dictionary<\"x\",number>", "Bindings", "Fresh", "schema S=Fresh.Dictionary<\"x\",number>", 0},
		{"array", "import type {Sequence} from \"bindings\"; schema S=Sequence<number>", "Sequence", "Fresh", "schema S=Fresh<number>", 0},
		{"record", "import type {Dictionary} from \"bindings\"; schema S=Dictionary<\"x\",number>", "Dictionary", "Fresh", "schema S=Fresh<\"x\",number>", 0},
		{"custom", "import type {Entry as Record} from \"bindings\"; schema S=Record<string,number>", "Record", "Fresh", "schema S=Fresh<string,number>", 1},
		{"local", "type Record<K,V>={k:K;v:V}; schema S=Record<string,number>", "Record", "Fresh", "schema S=Fresh<string,number>", 1},
		{"value shadow", "import type Record from \"bindings\"; function f(){const Record=1;schema S=Record<string,number>}", "Record", "Fresh", "schema S=Fresh<string,number>", 1},
		{"unused alias", "import type {Dictionary as Used,Dictionary as Other} from \"bindings\"; schema S=Used<\"x\",number>", "Other", "Fresh", "schema S=Used<\"x\",number>", 0},
	} {
		for _, fromUse := range []bool{false, true} {
			if tc.name == "unused alias" && fromUse {
				continue
			}
			label := "declaration"
			if fromUse {
				label = "use"
			}
			t.Run(tc.name+"/"+label, func(t *testing.T) {
				program, file, service, converters := editorProgramWith(t, tc.source, packages)
				count := func(source string) int {
					p, f, _, _ := editorProgramWith(t, source, packages)
					n := 0
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						if d.Code() != EK2109.Code {
							t.Fatalf("unexpected diagnostic: %s", d.String())
						}
						n++
					}
					return n
				}
				_ = program
				if got := count(tc.source); got != tc.errors {
					t.Fatalf("setup errors %d want %d", got, tc.errors)
				}
				offset := strings.Index(tc.source, tc.old)
				if fromUse {
					offset = strings.LastIndex(tc.source, tc.old)
				}
				pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
				uri := lsconv.FileNameToDocumentURI(file.FileName())
				response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: tc.next,
				}, nil)
				if err != nil {
					t.Fatal(err)
				}
				if response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil {
					t.Fatal("no rename edits")
				}
				after := applyEditorEdits(t, file, converters, (*response.WorkspaceEdit.Changes)[uri])
				if !strings.Contains(after, tc.want) {
					t.Errorf("missing %q after rename: %s", tc.want, after)
				}
				if got := count(after); got != tc.errors {
					t.Errorf("renamed errors %d want %d: %s", got, tc.errors, after)
				}
				if tc.name != "unused alias" {
					refs, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{
						TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, Context: &lsproto.ReferenceContext{IncludeDeclaration: true},
					}, nil)
					if err != nil {
						t.Fatal(err)
					}
					found := false
					if refs.Locations != nil {
						useOffset := strings.LastIndex(tc.source, tc.old)
						for _, loc := range *refs.Locations {
							if loc.Uri == uri && converters.FromLSPRangeToOriginal(file, loc.Range).Pos() == useOffset {
								found = true
							}
						}
					}
					if !found {
						t.Errorf("references miss schema type use: %s", tc.source)
					}
				}
			})
		}
	}
}

// The declaration fixtures have no source maps. Complete the editor test host
// so Find References can inspect their declarations without a nil host method.
func (editorTestHost) GetECMALineInfo(tspath.RootedFilePath) *sourcemap.ECMALineInfo { return nil }
