package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"strings"
)

const concurrentUnusedHeadTitle = "Prefix the unused concurrent head with an underscore"

func init() {
	nativeFixCodes = append(nativeFixCodes, 6133)
	tsFormFixCodes = append(tsFormFixCodes, 6133)
	vipMigrationFixCodes = append(vipMigrationFixCodes, 6133)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: []int32{6133}, GetCodeActions: concurrentUnusedHeadActions})
}

func concurrentUnusedHeadActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if fix.Program == nil || fix.SourceFile == nil || !fix.SourceFile.IsVibeLang() {
		return nil, nil
	}
	var head, fn *ast.Node
	var taken []string
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) {
			taken = append(taken, n.Text())
		}
		if ast.IsVariableDeclaration(n) && ast.IsIdentifier(n.Name()) && n.Name().Flags&ast.NodeFlagsReparsed == 0 && nodeStart(fix.SourceFile, n.Name()) == fix.Span.Pos() && n.Name().End() == fix.Span.End() {
			value := n.Initializer()
			if value != nil && ast.IsIdentifier(value) && value.Flags&ast.NodeFlagsVibeLangTemporary != 0 {
				candidate := ast.FindAncestor(n, isConcurrentBody)
				if candidate != nil && len(candidate.Parameters()) == 1 && candidate.Parameters()[0].Name().Text() == value.Text() {
					head, fn = n, candidate
				}
			}
		}
		return n.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if head == nil || strings.HasPrefix(head.Name().Text(), "_") {
		return nil, nil
	}
	name := head.Name()
	// An RHS closure has a separate TDZ binding. Renaming just the item must
	// never turn that capture into an outer read. Refuse source-name uses,
	// including type-only and shadowed uses, until a full rename is proved.
	var mentions func(*ast.Node) bool
	mentions = func(n *ast.Node) bool {
		if n != name && ast.IsIdentifier(n) && n.Flags&ast.NodeFlagsReparsed == 0 && n.Text() == name.Text() {
			return true
		}
		return n.ForEachChild(mentions)
	}
	if mentions(fn.Parent.Arguments()[0]) || mentions(fn.Body()) {
		return nil, nil
	}
	fresh := uniqueName("_"+name.Text(), taken)
	return []*ls.CodeAction{{Description: concurrentUnusedHeadTitle, Changes: replaceRange(fix, nodeStart(fix.SourceFile, name), name.End(), fresh)}}, nil
}
