package parser_test

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VIP-11: ordinary compilation keeps TypeScript's AST and native diagnostics.
// Typed EK1101 diagnostics remain the checker's responsibility.
func TestDeniedTrailingBlockParsesLikeTypeScript(t *testing.T) {
	for _, source := range []string{
		"f(x) {}", "f {}", "obj.f(x) { sideEffect() }", "obj.f {}",
		"obj[key](x) {}", "f<T>(x) {}", "f(x,) {}",
		"f() /* keep */ {}", "f() {}()", "f() {}.value",
		"function g() { return f() {} }",
		"const v = f() {};",
		"g(f() {});", "const a = [f() {}];",
		"const o = {value: f() {}};",
		"const v = true ? f() {} : 0;",
		"const v = f() {} + 1;",
		"if (f() {}) {}", "while (f() {}) {}",
		"for (; f() {} ;) {}", "switch (f() {}) {}",
		"class C { value = f() {} }",
		"async function g() { return await f() {} }",
		"function* g() { yield f() {} }",
	} {
		t.Run(source, func(t *testing.T) {
			vibe := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
			ts := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, source, core.ScriptKindTS)
			shape := func(file *ast.SourceFile) []string {
				var nodes []string
				var visit func(*ast.Node) bool
				visit = func(n *ast.Node) bool {
					nodes = append(nodes, fmt.Sprintf("%v:%d:%d", n.Kind, n.Pos(), n.End()))
					n.ForEachChild(visit)
					return false
				}
				file.AsNode().ForEachChild(visit)
				return nodes
			}
			if got, want := shape(vibe), shape(ts); !reflect.DeepEqual(got, want) {
				t.Fatalf(".vibe AST differs from TypeScript:\n%v\n%v", got, want)
			}
			got, want := vibe.Diagnostics(), ts.Diagnostics()
			if len(got) != len(want) {
				t.Fatalf("native diagnostic count: %v versus %v", got, want)
			}
			for i, d := range got {
				if d.Code() != want[i].Code() || d.Loc() != want[i].Loc() || d.String() != want[i].String() {
					t.Errorf("native diagnostic changed: %v versus %v", d, want[i])
				}
			}
			_, forms := parser.ParseVibeLangSyntax(vibe.ParseOptions(), source)
			for _, form := range forms {
				if form.Kind == parser.VibeSyntaxBlockParam {
					t.Fatal("ordinary parsing recorded a block parameter")
				}
			}

		})
	}
}

func TestDeniedTrailingBlockBoundaries(t *testing.T) {
	for _, source := range []string{
		"f()\n{}", "f\n{}", "obj.f\n{}", "f(); {}", "f() // line\n{}",
		"f?.() {}", "obj?.f() {}", "obj?.f {}", "class C extends f() {}",
		"effect function g() { provide L { try work() } }",
		"effect function g() { const task = fork { return 1 }; return join task }",
		"module legacy { f() {} }",
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		if file.VibeLangDeniedTrailingBlock {
			t.Errorf("%q: boundary marked as a trailing block", source)
		}
		for _, d := range file.Diagnostics() {
			if d.Source() == "EK" && d.Code() == 1101 {
				t.Errorf("%q: unexpected EK1101: %v", source, d)
			}
		}
	}
}

// VIP-11's retirement prerequisite: shipped programs use explicit arguments.
// Negative compiler cases intentionally retain the denied syntax.
func TestNoSupportedTrailingBlocks(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{"typescript/vibelang/cases", "examples", "templates", "typescript/tsc/internal/vibelangfmt/testdata/format"} {
		checked := 0
		err := filepath.WalkDir(filepath.Join(root, dir), func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				if entry.Name() == "node_modules" || strings.HasSuffix(entry.Name(), ".fail") || entry.Name() == "expected" {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(path, ".vibe") {
				return nil
			}
			text, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			checked++
			name, err := filepath.Abs(path)
			if err != nil {
				return err
			}
			opts := ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(filepath.ToSlash(name)), VibeLangLegacyTrailingBlocks: true}
			_, forms := parser.ParseVibeLangSyntax(opts, string(text))
			for _, form := range forms {
				if form.Kind == parser.VibeSyntaxBlockParam {
					relative, _ := filepath.Rel(root, name)
					t.Errorf("%s:%d: supported source retains a trailing block", relative, 1+strings.Count(string(text[:form.Open.Pos()]), "\n"))
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s: checked %d supported sources", dir, checked)
	}
}
