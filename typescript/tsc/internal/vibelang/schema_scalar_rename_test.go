package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestSchemaScalarImportReferencesRename(t *testing.T) {
	packages := map[string]string{
		"effect":           "packages/runtime/node_modules/effect",
		"vibelang-runtime": "packages/runtime",
		"bindings":         "typescript/tsc/internal/vibelang/testdata/schema-generic-imports",
	}
	for _, tc := range []struct {
		name, source, old, next, want string
		errors                        int
	}{
		{"Date/alias", "import type {LibraryDate as Native} from \"bindings\"; schema S=Native", "Native", "Fresh", "schema S=Fresh", 0},
		{"Date/field", "import type {LibraryDate as Native} from \"bindings\"; schema S {readonly value:Native}", "Native", "Fresh", "value:Fresh", 0},
		{"URL/alias", "import type {LibraryURL as Native} from \"bindings\"; schema S=Native", "Native", "Fresh", "schema S=Fresh", 0},
		{"URL/field", "import type {LibraryURL as Native} from \"bindings\"; schema S {readonly value:Native}", "Native", "Fresh", "value:Fresh", 0},
		{"RegExp/alias", "import type {LibraryRegExp as Native} from \"bindings\"; schema S=Native", "Native", "Fresh", "schema S=Fresh", 0},
		{"RegExp/field", "import type {LibraryRegExp as Native} from \"bindings\"; schema S {readonly value:Native}", "Native", "Fresh", "value:Fresh", 0},
		{"Uint8Array/alias", "import type {LibraryUint8Array as Native} from \"bindings\"; schema S=Native", "Native", "Fresh", "schema S=Fresh", 0},
		{"Uint8Array/field", "import type {LibraryUint8Array as Native} from \"bindings\"; schema S {readonly value:Native}", "Native", "Fresh", "value:Fresh", 0},
		{"Error/alias", "import type {LibraryError as Native} from \"bindings\"; schema S=Native", "Native", "Fresh", "schema S=Fresh", 0},
		{"Error/field", "import type {LibraryError as Native} from \"bindings\"; schema S {readonly value:Native}", "Native", "Fresh", "value:Fresh", 0},
		{"inline", "import {type LibraryDate as Native} from \"bindings\"; schema S=Native", "Native", "Fresh", "schema S=Fresh", 0},
		{"namespace", "import type * as Types from \"bindings\"; schema S=Types.LibraryDate", "Types", "Fresh", "schema S=Fresh.LibraryDate", 0},
		{"bare-import", "import type {LibraryDate} from \"bindings\"; schema S=LibraryDate", "LibraryDate", "Fresh", "schema S=Fresh", 0},
		{"native-type", "import type {LibraryDate as Native} from \"bindings\"; type S={readonly value:Native}", "Native", "Fresh", "value:Fresh", 0},
		{"schema-value", "const Native=Schema.String; schema S=Native", "Native", "Fresh", "schema S=Fresh", 0},
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
