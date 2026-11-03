package ls

import (
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Searches in a nonzero-offset container must return file-relative positions.
// This native TypeScript twin isolates the same lost declaration as the
// VibeLang `(e:unknown)=>e is E` editor witness.
func TestReferenceSearchContainerOffset(t *testing.T) {
	for _, prefix := range []string{"", "// prefix\n", strings.Repeat(" ", 37)} {
		for _, name := range []string{"e", "renamedParameter", "café"} {
			source := "const before=0;\n" + prefix + "function pick(" + name + ":unknown){return " + name + " instanceof Error}"
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, source, core.ScriptKindTS)
			container := file.Statements.Nodes[len(file.Statements.Nodes)-1]
			got := getPossibleSymbolReferencePositions(file, name, container)
			want := []int{strings.Index(source, name+":"), strings.LastIndex(source, name+" instanceof")}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("prefix %d name %q: got %v want %v", len(prefix), name, got, want)
			}
		}
	}
}
