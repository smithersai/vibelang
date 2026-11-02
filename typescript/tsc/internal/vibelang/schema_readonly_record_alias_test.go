package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"strings"
	"testing"
)

func TestSchemaReadonlyRecordAliasBindings(t *testing.T) {
	const aliases = "namespace N { export import Dictionary=globalThis.Record; export import Array=globalThis.Record; export import Readonly=globalThis.Record; export import Freeze=globalThis.Readonly }; "
	for _, tc := range []struct {
		name, source, message string
		code                  int32
	}{
		{"qualified", "schema S=Readonly<globalThis.Record<\"x\",number>>; function f(s:S){const n:number=s.x}", "", 0},
		{"renamed", aliases + "schema S=Readonly<N.Dictionary<\"x\",number>>; function f(s:S){const n:number=s.x}", "", 0},
		{"array spelling", aliases + "schema S=Readonly<N.Array<\"x\",number>>; function f(s:S){const n:number=s.x}", "", 0},
		{"readonly spelling", aliases + "schema S=Readonly<N.Readonly<\"x\",number>>; function f(s:S){const n:number=s.x}", "", 0},
		{"grouped", aliases + "schema S=Readonly<(N.Dictionary<\"x\",number>)>; function f(s:S){const n:number=s.x}", "", 0},
		{"shallow array", aliases + "schema S=Readonly<N.Dictionary<\"x\",number[]>>; function f(s:S){s.x.push(1)}", "", 0},
		{"readonly field", aliases + "schema S { readonly entries:Readonly<N.Dictionary<\"x\",number>> }; function f(s:S){const n:number=s.entries.x}", "", 0},
		{"value only Readonly", aliases + "const Readonly=1;schema S=Readonly<N.Dictionary<\"x\",number>>; function f(s:S){const n:number=s.x}", "", 0},
		{"local namespace", "namespace N { export import Dictionary=globalThis.Record; export function f(){schema S=Readonly<Dictionary<\"x\",number>>;const s:S={x:1};return s.x} }", "", 0},
		{"readonly key", aliases + "schema S=Readonly<N.Dictionary<\"x\",number>>; function f(s:S){s.x=1}", "", 2540},
		{"value type", aliases + "schema S=Readonly<N.Dictionary<\"x\",number>>; function f(s:S){const n:string=s.x}", "", 2322},
		{"optional value", aliases + "const V=Schema.optionalKey(Schema.Number);schema S=Readonly<N.Dictionary<\"x\",V>>", "decoded key", EK2109.Code},
		{"mutable value", aliases + "const V=Schema.mutableKey(Schema.Number);schema S=Readonly<N.Dictionary<\"x\",V>>", "decoded key", EK2109.Code},
		{"uncertain value", aliases + "const V=Schema.Number as Schema.Top;schema S=Readonly<N.Dictionary<\"x\",V>>", "decoded key", EK2109.Code},
		{"custom Record", "namespace N {export type Dictionary<K,V>={k:K;v:V}}; schema S=Readonly<N.Dictionary<string,number>>", "", EK2109.Code},
		{"custom Readonly", aliases + "type Readonly<T>={n:T};schema S=Readonly<N.Dictionary<\"x\",number>>", "", EK2109.Code},
		{"wrong library", "namespace N {export import Dictionary=globalThis.Array};schema S=Readonly<N.Dictionary<string,number>>", "", EK2109.Code},
		{"wrong arity", aliases + "schema S=Readonly<N.Dictionary<string>>", "", EK2109.Code},
		{"qualified outer", "schema S=globalThis.Readonly<Record<\"x\",number>>;function f(s:S){s.x=1}", "", 2540},
		{"renamed both", aliases + "schema S=N.Freeze<N.Dictionary<\"x\",number>>;function f(s:S){s.x=1}", "", 2540},
		{"array outer", "schema S=Array<Record<\"x\",number>>;function f(s:S){s.push({x:1});s[0].x=2}", "", 0},
		{"readonly array outer", "schema S=ReadonlyArray<Record<\"x\",number>>;function f(s:S){s[0].x=2}", "", 0},
		{"canonical control", "schema S=Readonly<Record<\"x\",number>>;function f(s:S){const n:number=s.x}", "", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				count++
				if d.Code() != tc.code {
					t.Errorf("diagnostic %d, want %d: %s", d.Code(), tc.code, d.String())
				}
				if tc.message != "" && !strings.Contains(d.String(), tc.message) {
					t.Errorf("missing %q in %s", tc.message, d.String())
				}
			}
			want := 0
			if tc.code != 0 {
				want = 1
			}
			if count != want {
				t.Errorf("errors %d, want %d", count, want)
			}
		})
	}
}

func TestSchemaReadonlyRecordAliasEditor(t *testing.T) {
	packages := map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime", "bindings": "typescript/tsc/internal/vibelang/testdata/schema-generic-imports"}
	for _, tc := range []struct{ name, imports, use, old string }{
		{"renamed", "import type {Dictionary,Unused} from \"bindings\";", "Readonly<Dictionary<\"x\",number>>", "Dictionary"},
		{"canonical", "import type {Dictionary as Record,Unused} from \"bindings\";", "Readonly<Record<\"x\",number>>", "Record"},
		{"namespace", "import type * as Bindings from \"bindings\";", "Readonly<Bindings.Dictionary<\"x\",number>>", "Bindings"},
		{"outer", "import type {Freeze,Dictionary,Unused} from \"bindings\";", "Freeze<Dictionary<\"x\",number>>", "Freeze"},
		{"both namespace", "import type * as Bindings from \"bindings\";", "Bindings.Freeze<Bindings.Dictionary<\"x\",number>>", "Bindings"},
		{"outer cross array", "import type {Freeze as Array,Dictionary,Unused} from \"bindings\";", "Array<Dictionary<\"x\",number>>", "Array"},
		{"outer cross record", "import type {Freeze as Record,Dictionary,Unused} from \"bindings\";", "Record<Dictionary<\"x\",number>>", "Record"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := tc.imports + "schema S=" + tc.use
			p, f, service, converters := editorProgramWith(t, source, packages)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("source: %s", d.String())
				}
			}
			changes := service.OrganizeImports(t.Context(), f, p, lsproto.CodeActionKindSourceOrganizeImportsTs)
			organized := applyEditorEdits(t, f, converters, changes[f.FileName()])
			imports := strings.SplitN(organized, "schema", 2)[0]
			if !strings.Contains(imports, tc.old) || !strings.Contains(imports, "import") || strings.Contains(imports, "Unused") {
				t.Fatalf("wrong imports: %s", organized)
			}
			uri := lsconv.FileNameToDocumentURI(f.FileName())
			pos, _ := converters.ToLSPPosition(f, core.TextPos(strings.LastIndex(source, tc.old)))
			edits, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: "Fresh"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if edits.WorkspaceEdit == nil || edits.WorkspaceEdit.Changes == nil {
				t.Fatal("no rename at readonly record use")
			}
			after := applyEditorEdits(t, f, converters, (*edits.WorkspaceEdit.Changes)[uri])
			if !strings.Contains(after, strings.ReplaceAll(tc.use, tc.old, "Fresh")) {
				t.Errorf("schema use not renamed: %s", after)
			}
			next, file, _, _ := editorProgramWith(t, after, packages)
			for _, d := range append(next.GetSyntacticDiagnostics(t.Context(), file), next.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("renamed source: %s", d.String())
				}
			}
		})
	}
}

func TestSchemaReadonlyRecordVisibleParents(t *testing.T) {
	for _, source := range []string{
		"schema S=Readonly<Record<string,number>>",
		"schema S {field:Readonly<Record<string,number>>}",
		"schema S=Array<Record<string,number>>",
		"schema S=globalThis.Readonly<globalThis.Record<string,number>>",
		"schema S=Readonly<Record<\"x\",Array<Readonly<Record<\"y\",number>>>>>",
	} {
		_, file, _, _ := editorProgram(t, source)
		var visit func(*ast.Node)
		visit = func(parent *ast.Node) {
			parent.ForEachChild(func(child *ast.Node) bool {
				if child.Parent != parent {
					t.Errorf("%s has parent %v, want %s in %s", child.Kind, child.Parent, parent.Kind, source)
				}
				visit(child)
				return false
			})
		}
		visit(file.AsNode())
	}
}

func TestSchemaReadonlyRecordLegacyCodec(t *testing.T) {
	for _, tc := range []struct {
		name, source, want string
		compatibility      bool
	}{
		{"shadow outer", "type Readonly<T>={n:T};export schema S=Readonly<Record<string,number>>", "Schema.Record(Schema.String, Schema.Number)", false},
		{"shadow inner", "type Record<K,V>={k:K;v:V};export schema S=Readonly<Record<string,number>>", "Schema.Record(Schema.String, Schema.Number)", false},
		{"outer now array", "namespace N {export import Readonly=globalThis.Array;export schema S=Readonly<Record<string,number>>}", "Schema.Record(Schema.String, Schema.Number)", true},
		{"outer now readonly array", "namespace N {export import Readonly=globalThis.ReadonlyArray;export schema S=Readonly<Record<string,number>>}", "Schema.Record(Schema.String, Schema.Number)", true},
		{"outer now readonly map", "namespace N {export import Array=globalThis.Readonly;export schema S=Array<Record<string,number>>}", "Schema.mutable(Schema.Array(Schema.Record(Schema.String, Schema.mutableKey(Schema.Number))))", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			fs := bundled.WrapFS(osvfs.FS())
			options := FixOptions{MigrationOnly: tc.compatibility}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), program.CommandLine(), options)
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("migration failed: %+v", result)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || !strings.Contains(fixed.Text, tc.want) {
				t.Fatalf("missing previous codec %q: %+v", tc.want, fixed)
			}
			checked, next, _, _ := editorProgram(t, fixed.Text)
			for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), next), checked.GetSemanticDiagnostics(t.Context(), next)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("migration: %s\n%s", d.String(), fixed.Text)
				}
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), program.CommandLine(), options)
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}
