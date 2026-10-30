package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	ls.RegisterCodeFixProvider(serviceContractModifierFix)
	tsFormFixCodes = append(tsFormFixCodes, serviceContractModifierDiagnostic.Code)
}

var serviceContractModifierFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{902},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		member := reportedNode(fix.SourceFile, fix.Span, func(node *ast.Node) bool {
			return ast.IsPropertyDeclaration(node) || ast.IsMethodDeclaration(node)
		})
		if member == nil || !serviceContractClassSyntax(member) ||
			member.Name() == nil || ast.IsPrivateIdentifier(member.Name()) {
			return nil, nil
		}
		var edits []*lsproto.TextEdit
		s := scanner.GetScannerForSourceFile(fix.SourceFile, member.Pos())
		for s.Token() != ast.KindEndOfFile && s.TokenStart() < nodeStart(fix.SourceFile, member.Name()) {
			remove := false
			switch s.Token() {
			case ast.KindPublicKeyword, ast.KindPrivateKeyword, ast.KindProtectedKeyword,
				ast.KindAbstractKeyword, ast.KindDeclareKeyword, ast.KindOverrideKeyword,
				ast.KindAccessorKeyword, ast.KindAsyncKeyword:
				remove = true
			case ast.KindReadonlyKeyword:
				remove = ast.IsMethodDeclaration(member)
			default:
				remove = s.TokenText() == "effect" && member.Flags&ast.NodeFlagsVibeLangEffect != 0
			}
			if remove {
				end := s.TokenEnd()
				if text := fix.SourceFile.Text(); end < len(text) && text[end] == ' ' {
					end++
				}
				edits = append(edits, replaceRange(fix, s.TokenStart(), end, "")...)
			}
			s.Scan()
		}
		if token := member.PostfixToken(); token != nil && token.Kind == ast.KindExclamationToken {
			edits = append(edits, replaceRange(fix, nodeStart(fix.SourceFile, token), token.End(), "")...)
		}
		if len(edits) == 0 {
			return nil, nil
		}
		return []*ls.CodeAction{{Description: "Write a service contract", Changes: edits}}, nil
	},
}
