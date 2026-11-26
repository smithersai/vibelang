package parser

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestEffectArrowHeadRecovery(t *testing.T) {
	for _, row := range []struct{ source, first string }{
		{"const value = effect x: number => x", "x"},
		{"const value = effect x: number!! => x", "x"},
		{"const value = effect <T> x: T => x", ":"},
		{"const value = effect <T extends (n: number) => number> x: T => x", "extends"},
	} {
		source := row.source
		for _, name := range []string{"/main.vibe", "/main.ts"} {
			t.Run(name+source, func(t *testing.T) {
				file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, source, core.ScriptKindTS)
				if name == "/main.ts" {
					if ds := file.Diagnostics(); len(ds) == 0 || ds[0].Code() != 1005 || source[ds[0].Pos():ds[0].End()] != row.first {
						t.Fatalf("want TS1005 at %q, got %v", row.first, ds)
					}
					return
				}
				if ds := file.Diagnostics(); len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 109 {
					t.Fatalf("recognized head needs exactly parser-owned EK0109: %v", ds)
				}
				count := 0
				var visit func(*ast.Node) bool
				visit = func(n *ast.Node) bool {
					if ast.IsArrowFunction(n) && n.Flags&ast.NodeFlagsVibeLangEffect != 0 {
						count++
					}
					return n.ForEachChild(visit)
				}
				file.AsNode().ForEachChild(visit)
				if count != 1 {
					t.Fatalf("got %d marked arrows; want one", count)
				}
			})
		}
	}
}
