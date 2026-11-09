package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VIP-16 and decided detail 241 own only the declaration's separators;
// nested native TypeScript type members retain their native diagnostics.
func TestDataMemberSeparators(t *testing.T) {
	for _, tc := range []struct{ name, source, preceding string }{
		{"bare variants", "data D { A B }", "A"},
		{"payload variants", "data D { A { x: number } B }", "}"},
		{"empty payload", "data D { A {} B {} }", "}"},
		{"reserved variant", "data D { default return }", "default"},
		{"variant comment", "data D { A /* keep */ B }", "A"},
		{"fields", "data D { A { x: number y: string } }", "number"},
		{"optional field", "data D { A { x?: number y: string } }", "number"},
		{"readonly field", "data D { A { readonly x: number y: string } }", "number"},
		{"nested type then field", "data D { A { x: { n: number } y: string } }", "}"},
		{"field comment", "data D { A { x: number /* keep */ y: string } }", "number"},
		{"computed field", "declare const key: unique symbol; data D { A { [key]: number y: string } }", "number"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "// café 😀\n" + tc.source
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
			ds := file.Diagnostics()
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 1605 {
				t.Fatalf("want only EK1605, got %v", ds)
			}
			d := ds[0]
			if d.Len() != 0 || !strings.HasSuffix(source[:d.Pos()], tc.preceding) {
				t.Fatalf("separator insertion is not after preceding member: %d:%d in %q", d.Pos(), d.End(), source)
			}
			fixed := source[:d.Pos()] + ";" + source[d.Pos():]
			reparsed := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, fixed, core.ScriptKindTS)
			if len(reparsed.Diagnostics()) != 0 {
				t.Fatalf("inserting one semicolon left %v", reparsed.Diagnostics())
			}
		})
	}
}

func TestDataMemberSeparatorNativeIsolation(t *testing.T) {
	for _, tc := range []struct {
		name, file, source string
		code               int32
	}{
		{"native interface", "/main.ts", "interface D { x: number y: string }", 1005},
		{"native class", "/main.ts", "class D { x=1 y=2 }", 1005},
		{"vibe type", "/main.vibe", "type D = { x: number y: string }", 1005},
		{"nested payload type", "/main.vibe", "data D { A { x: { n: number s: string }; y: string } }", 1005},
		{"nested payload function", "/main.vibe", "data D { A { x: (n: { a: number b: string }) => number; y: string } }", 1005},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(tc.file), PathKey: tspath.PathKey(tc.file)}, tc.source, core.ScriptKindTS)
			found := false
			for _, d := range f.Diagnostics() {
				if d.Source() == "EK" {
					t.Errorf("native diagnostic reclassified: %v", d)
				}
				found = found || d.Code() == tc.code
			}
			if !found {
				t.Fatalf("missing native TS%d: %v", tc.code, f.Diagnostics())
			}
		})
	}
	for _, source := range []string{
		"data D { A; B }",
		"data D { A\n B }",
		"data D { A /*\n*/ B }",
		"data D { A\n{ x: number\ny: string }\n B }",
		"data D { A { x: number; y?: string } }",
		"data D { A { x: number /*\n*/ y: string } }",
		"data D { A { x: { n: number; s: string }; y: string } }",
		"data D { A, B }", // existing comma diagnostic is semantic, not a missing separator
	} {
		f := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		if len(f.Diagnostics()) != 0 {
			t.Errorf("valid separator rejected: %v\n%s", f.Diagnostics(), source)
		}
	}
}
