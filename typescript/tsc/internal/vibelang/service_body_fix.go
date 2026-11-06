package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// A service with a written shape has nothing for a body to add when its key can
// be derived, so an older `service Prefix: string` takes an empty body. A
// service that needs a written key takes EK0903's fix, which writes the body
// with the key, and a header with no shape has members only its author knows.
func serviceBodyEdit(c *checker.Checker, file *ast.SourceFile, class *ast.Node) *sourceEdit {
	if serviceShape(class) == nil || serviceNeedsExplicitKey(c, class) {
		return nil
	}
	at := class.ClassLikeData().Members.Pos()
	if at > 0 && at <= len(file.Text()) && file.Text()[at-1] == '{' {
		return nil
	}
	return &sourceEdit{class.End(), class.End(), " {}"}
}

// bodylessServiceAt finds the service whose name EK0906 reported.
func bodylessServiceAt(file *ast.SourceFile, span core.TextRange) *ast.Node {
	var found *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsClassDeclaration(n) && n.Name() != nil && n.Name().Loc == span && declarationWord(n) == "service" {
			found = n
			return true
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK0906.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0906.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source:     diagnosticSource,
		ErrorCodes: []int32{EK0906.Code},
		GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			class := bodylessServiceAt(fix.SourceFile, fix.Span)
			if class == nil {
				return nil, nil
			}
			c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
			defer done()
			edit := serviceBodyEdit(c, fix.SourceFile, class)
			if edit == nil {
				return nil, nil
			}
			return []*ls.CodeAction{{Description: "Write an empty service body", Changes: replaceRange(fix, edit.start, edit.end, edit.text)}}, nil
		},
	})
}
