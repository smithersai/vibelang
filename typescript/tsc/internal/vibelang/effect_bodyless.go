package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() {
	fileChecks = append(fileChecks, checkEffectBodyless)
	tsFormFixCodes = append(tsFormFixCodes, EK0108.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0108.Code)
	tsFormRules[EK0108.Code] = &tsFormRule{
		message:   EK0108,
		find:      func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
		plan:      effectBodylessRewrite,
		diagnosed: forbiddenEffectDeclaration,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0108.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// A missing body alone is not forbidden: nonambient overload signatures
// retain their native meaning. Inherited ambientness and abstract members
// are rejected independently of whether the checker lowers their bodies.
func forbiddenEffectDeclaration(node *ast.Node) bool {
	if !isMarkedEffect(node) {
		return false
	}
	if node.Flags&ast.NodeFlagsAmbient != 0 {
		return true
	}
	// Service contracts receive an abstract modifier during parsing. Only a
	// written abstract declaration belongs to the Functions placement rule.
	for _, modifier := range node.ModifierNodes() {
		if modifier.Kind == ast.KindAbstractKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0 {
			return true
		}
	}
	return node.Parent != nil && (node.Parent.Kind == ast.KindInterfaceDeclaration || node.Parent.Kind == ast.KindTypeLiteral)
}

func checkEffectBodyless(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if forbiddenEffectDeclaration(node) {
			reportAt(c, file, tsFormSpan(file, node), EK0108)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// Erased declarations have no implementation to rewrite. Removing only the
// modifier keeps their return annotations, comments and public signatures.
func effectBodylessRewrite(_ *checker.Checker, file *ast.SourceFile, at *ast.Node) *formRewrite {
	if !forbiddenEffectDeclaration(at) {
		return nil
	}
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: file.FileName()}, file.Text())
	for _, form := range forms {
		if form.Kind == parser.VibeSyntaxEffect && form.Range.End() == at.End() && form.Word.Pos() >= at.Pos() {
			return &formRewrite{edits: []sourceEdit{{form.Word.Pos(), form.Word.End(), ""}}, description: "the native declaration without effect"}
		}
	}
	return nil
}
