package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
)

// declarationThrows writes the constant nonthrowing boundary of local VibeLang
// callables after TypeScript has serialized their public declarations (VIP-4).
// Bare function types retain their written form; callable bindings use a call
// signature so TypeScript readers can observe its JSDoc contract.
type declarationThrows struct {
	transformers.Transformer
	checker *checker.Checker
	source  *ast.SourceFile
}

func (tx *declarationThrows) visit(node *ast.Node) *ast.Node {
	original := tx.EmitContext().MostOriginal(node)
	node = tx.Visitor().VisitEachChild(node)
	if node.Kind == ast.KindVariableDeclaration && node.Type() != nil && node.Type().Kind == ast.KindFunctionType && original.Kind == ast.KindVariableDeclaration {
		signatures := tx.checker.GetSignaturesOfType(tx.checker.GetTypeAtLocation(original), checker.SignatureKindCall)
		if len(signatures) == 1 && tx.localSignature(signatures[0]) {
			t := node.Type().AsFunctionTypeNode()
			call := tx.Factory().NewCallSignatureDeclaration(t.TypeParameters, t.Parameters, t.Type)
			tx.tag(call, nil)
			literal := tx.Factory().NewTypeLiteralNode(tx.Factory().NewNodeList([]*ast.Node{call}))
			d := node.AsVariableDeclaration()
			return tx.Factory().UpdateVariableDeclaration(d, d.Name(), d.ExclamationToken, literal, d.Initializer)
		}
		return node
	}
	if node.Kind == ast.KindConstructSignature && ast.IsClassLike(original) {
		if tx.localDeclaration(original) {
			if symbol := tx.checker.GetSymbolOfDeclaration(original); symbol != nil &&
				!isEffectfulType(tx.checker, tx.checker.GetDeclaredTypeOfSymbol(symbol)) {
				tx.tag(node, nil)
			}
		}
		return node
	}
	switch node.Kind {
	case ast.KindFunctionDeclaration, ast.KindMethodDeclaration, ast.KindConstructor,
		ast.KindCallSignature, ast.KindConstructSignature, ast.KindMethodSignature:
		if ast.IsFunctionLike(original) && original.Kind != ast.KindIndexSignature && !ast.NodeIsSynthesized(original) {
			sig := tx.checker.GetSignatureFromDeclaration(original)
			if tx.localSignature(sig) {
				tx.tag(node, original)
			}
		}
	}
	return node
}

func (tx *declarationThrows) localSignature(sig *checker.Signature) bool {
	return sig != nil && tx.localDeclaration(sig.Declaration()) &&
		!isEffectfulType(tx.checker, tx.checker.GetReturnTypeOfSignature(sig))
}

func (tx *declarationThrows) localDeclaration(decl *ast.Node) bool {
	if decl == nil || !isVibeLangFile(ast.GetSourceFileOfNode(decl)) {
		return false
	}
	for parent := decl.Parent; parent != nil; parent = parent.Parent {
		if parser.IsVibeLangModuleDeclaration(parent) {
			return false
		}
	}
	return true
}

func (tx *declarationThrows) tag(node, original *ast.Node) {
	// Reused serialized types can be visited through more than one export.
	for _, existing := range tx.EmitContext().GetSyntheticLeadingComments(node) {
		for _, line := range strings.Split(existing.Text, "\n") {
			if strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "*")) == "@throws {never}" {
				return
			}
		}
	}
	comment := "* @throws {never} "
	if original != nil && ast.GetSourceFileOfNode(original) == tx.source {
		if docs := original.JSDoc(nil); len(docs) > 0 {
			// Signature readers use the final JSDoc block. Join that block, keeping
			// the original prose and tags instead of hiding them behind a new block.
			for _, doc := range docs[:len(docs)-1] {
				raw := strings.TrimSpace(tx.source.Text()[doc.Pos():doc.End()])
				body := strings.TrimSuffix(strings.TrimPrefix(raw, "/*"), "*/")
				tx.EmitContext().AddSyntheticLeadingComment(node, ast.KindMultiLineCommentTrivia, body, true)
			}
			last := docs[len(docs)-1]
			comment = joinThrowsNever(tx.source.Text()[last.Pos():last.End()])
			tx.EmitContext().SetCommentRange(node, core.UndefinedTextRange())
			// A method name can share the declaration's full start, including
			// its JSDoc. Suppress that second source-comment path as well.
			if name := node.Name(); name != nil && name.Pos() == original.Pos() {
				tx.EmitContext().SetCommentRange(name, core.UndefinedTextRange())
			}
		}
	}
	tx.EmitContext().AddSyntheticLeadingComment(node, ast.KindMultiLineCommentTrivia, comment, true)
}
