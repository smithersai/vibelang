package vibelang

import (
	"os"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestEffectChannelParentheses(t *testing.T) {
	t.Run("project migration and idempotence", testEffectChannelMigration)
	for _, pair := range [][2]string{
		{"number | string!!", "(number | string)!!"},
		{"number & {}!!", "(number & {})!!"},
		{"number!string | Error", "number!(string | Error)"},
		{"number!string & {}", "number!(string & {})"},
		{"number!!string | symbol", "number!!(string | symbol)"},
		{"number!!string & {}", "number!!(string & {})"},
		{"number!() => string", "number!(() => string)"},
		{"number!new () => Error", "number!(new () => Error)"},
		{"number!string extends string ? Error : never", "number!(string extends string ? Error : never)"},
		{"string extends string ? number!Error : boolean", "string extends string ? (number!Error) : boolean"},
		{"string extends string ? number!Error | string : boolean", "string extends string ? (number!(Error | string)) : boolean"},
		{"number!! | null", "number!! (| null)"},
		{"number!! & { readonly x: 1 }", "number!! (& { readonly x: 1 })"},
		{"number! | Error", "number! (| Error)"},
		{"number! & { readonly x: 1 }", "number! (& { readonly x: 1 })"},
		{"| number!!", "(| number)!!"},
		{"& { readonly x: 1 }!!", "(& { readonly x: 1 })!!"},
		{"number!!() => string", "number!!(() => string)"},
		{"number!!new () => Error", "number!!(new () => Error)"},
		{"number!!string extends string ? Error : never", "number!!(string extends string ? Error : never)"},
		{"string extends string ? number : boolean!!", "string extends string ? number : (boolean!!)"},
		{"number!! extends object ? true : false", "(number!!) extends object ? true : false"},
		{"number | string!! extends object ? true : false", "((number | string)!!) extends object ? true : false"},
		{"string extends number!Error ? true : false", "string extends (number!Error) ? true : false"},
	} {
		t.Run(pair[0], func(t *testing.T) {
			source := "export type Program = " + pair[0]
			want := "export type Program = " + pair[1]
			p, file, _, _ := editorProgram(t, source)
			var diagnostic *ast.Diagnostic
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == 301 {
					if diagnostic != nil {
						t.Fatal("duplicate EK0301", d)
					}
					diagnostic = d
				}
			}
			if diagnostic == nil {
				var describe func(*ast.Node) bool
				describe = func(n *ast.Node) bool {
					if ast.IsTypeReferenceNode(n) {
						name := n.AsTypeReferenceNode().TypeName
						t.Logf("reference kind=%v name-kind=%v name-flags=%v name-text=%q range=%d:%d arguments=%d", n.Kind, name.Kind, name.Flags, nodeText(file, name), n.Pos(), n.End(), len(n.TypeArguments()))
					}
					return n.ForEachChild(describe)
				}
				file.AsNode().ForEachChild(describe)
				t.Fatal("missing EK0301", source)
			}
			if len(p.GetSyntacticDiagnostics(t.Context(), file)) == 0 {
				t.Fatal("EK0301 must be a syntax diagnostic, including with --noCheck")
			}
			c, done := p.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			rule := tsFormRules[301]
			if rule == nil {
				t.Fatal("no EK0301 repair rule")
			}
			node := tsFormNodeAt(file, core.NewTextRange(diagnostic.Pos(), diagnostic.End()), rule.diagnosed)
			if node == nil {
				t.Fatal("no diagnosed Effect type")
			}
			rewrite := rule.plan(c, file, node)
			if !rewrite.fixable() {
				t.Fatal("no preserving rewrite")
			}
			got := source
			for i := len(rewrite.edits) - 1; i >= 0; i-- {
				edit := rewrite.edits[i]
				got = got[:edit.start] + edit.text + got[edit.end:]
			}
			if got != want {
				t.Fatalf("got %s; want %s", got, want)
			}
			checked, fixed, _, _ := editorProgram(t, got)
			for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), fixed), checked.GetSemanticDiagnostics(t.Context(), fixed)...) {
				if d.Code() == 301 {
					t.Fatal("rewrite still reports EK0301", d)
				}
			}
		})
	}
	for _, typ := range []string{
		"(number!!) extends object ? true : false",
		"(number | string)!!", "number!(string | Error)", "number!!(string | symbol)",
		"number!(() => string)", "number!(new () => Error)",
		"() => number!Error", "new () => number!Error", "(number!Error) | string",
		"string extends string ? (number!Error) : boolean", "number!Error[]", "(number!Error)[]",
		"number! (| Error)",
		"number!! (| null)",
		"(| number)!!",
		"number!Array<Error | string>",
		"number!{ readonly item: string | number }",
		"number!{ call: () => string }",
		"Array<number!Error>",
		"[number!Error, (number | string)!!]",
		"readonly (number!Error)[]",
		"string extends (number!Error) ? true : false",
		"number!(string extends string ? Error : never)",
	} {
		t.Run("control/"+typ, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, "export type Program = "+typ)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == 301 {
					t.Fatal("valid parenthesized/return type rejected", d)
				}
			}
		})
	}
}

// Exercise the same project-wide repair as --fix, including repeated sites.
func testEffectChannelMigration(t *testing.T) {
	for _, pair := range [][2]string{
		{"number | string!!", "(number | string)!!"},
		{"number!string | Error", "number!(string | Error)"},
		{"number!!string | symbol", "number!!(string | symbol)"},
		{"number!() => string", "number!(() => string)"},
		{"string extends string ? number!! : boolean", "string extends string ? (number!!) : boolean"},
		{"number!! | null", "number!! (| null)"},
		{"number!! extends object ? true : false", "(number!!) extends object ? true : false"},
	} {
		t.Run(pair[0], func(t *testing.T) {
			source := "export type First = " + pair[0] + "\nexport type Second = " + pair[0] + "\n"
			want := "export type First = " + pair[1] + "\nexport type Second = " + pair[1] + "\n"
			p, file, _, _ := editorProgram(t, source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			fixed := result.Files[file.FileName()]
			if result.Err != nil || len(result.Refused) != 0 || fixed == nil {
				t.Fatalf("migration failed: %+v", result)
			}
			if fixed.Text != want || fixed.Counts[301] != 2 {
				t.Fatalf("wanted two preserving EK0301 repairs:\n%s\ngot (%v):\n%s", want, fixed.Counts, fixed.Text)
			}
			checked, next, _, _ := editorProgram(t, fixed.Text)
			for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), next), checked.GetSemanticDiagnostics(t.Context(), next)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed type reports %v\n%s", d, fixed.Text)
				}
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("second fix changed the project: %+v", again)
			}
		})
	}
}
