package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestErrorStaticMemberFixPreservesDocumentation(t *testing.T) {
	for _, declaration := range []struct{ kind, name string }{{"error", "Data"}, {"schema error", "Schema"}} {
		t.Run(declaration.kind, func(t *testing.T) {
			source := "/** Documented failure. */\nexport " + declaration.kind + " " + declaration.name + " { static x = 1 }\n"
			fixed := applyQuickFixOf(t, source, 1302, diagnostics.CategoryError)
			_, file, _, _ := editorProgram(t, fixed)
			for _, statement := range file.Statements.Nodes {
				if ast.IsClassDeclaration(statement) && statement.Name().Text() == declaration.name {
					for _, comment := range parser.GetJSDocCommentRanges(&ast.NodeFactory{}, nil, statement, file.Text()) {
						if strings.Contains(fixed[comment.Pos():comment.End()], "Documented failure.") {
							return
						}
					}
				}
			}
			t.Fatalf("the added import detached the error's documentation:\n%s", fixed)
		})
	}
}
