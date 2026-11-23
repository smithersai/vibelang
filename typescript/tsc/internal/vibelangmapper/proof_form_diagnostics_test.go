package vibelangmapper

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Appendix F erases proof syntax before runtime form selection. The native
// proof checker types the postcondition; its arrow is not a runtime callback.
func TestProofFormDiagnostics(t *testing.T) {
	for _, extension := range []string{".vibe", ".vibex"} {
		parse := func(source string) *ast.SourceFile {
			kind := core.ScriptKindTS
			if extension == ".vibex" {
				kind = core.ScriptKindTSX
			}
			return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/editor" + extension)}, source, kind)
		}
		for _, prefix := range []string{"", "spec "} {
			for _, name := range []string{"r", "source", "type", "café"} {
				for i, fact := range []string{"RESULT >= n", "RESULT === n", "!(RESULT < n)"} {
					t.Run(fmt.Sprintf("%s/%s/%s/%d", extension, prefix, name, i), func(t *testing.T) {
						source := prefix + "function f(n: number): number {\n  proof { ensures((" + name + ") => " + strings.ReplaceAll(fact, "RESULT", name) + ") }\n  return n\n}\n"
						if got := FormDiagnostics(parse(source)); len(got) != 0 {
							t.Fatalf("erased proof has runtime choices: %+v\n%s", got, source)
						}
						for _, d := range Project(source, testContext).Diagnostics {
							if d.Code == CodeFormChoice || d.Code == CodeDataMethod {
								t.Fatalf("projection has a runtime choice: %+v", d)
							}
						}
					})
				}
			}
		}
	}
}
