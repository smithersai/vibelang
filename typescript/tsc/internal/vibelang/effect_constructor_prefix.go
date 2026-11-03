package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK0104.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0104.Code)
	ls.RegisterCodeFixProvider(effectConstructorPrefixFix)
}

// Before VIP-1's restriction was diagnosed, an Effect method named constructor
// emitted an ordinary JS constructor returning a cold Effect. Keep its returned
// object and delay exactly its old body. Parameters stay a refusal: the old
// method lowering deferred their initialization until each Effect run.
// Accessors already had native syntax errors; dropping their modifier would
// invent an eager body, so they have no automatic edit.
var effectConstructorPrefixFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK0104.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		file, span := fix.SourceFile, fix.Span
		text := file.Text()
		if span.Pos() < 0 || span.End() > len(text) || text[span.Pos():span.End()] != "effect" {
			return nil, nil
		}
		// Accessor diagnostics in a constructor parameter/decorator must never
		// be interpreted as a diagnostic on the surrounding constructor.
		next := scanner.SkipTrivia(text, span.End())
		token := scanner.GetRangeOfTokenAtPosition(file, next)
		head := text[token.Pos():token.End()]
		if head != "constructor" && (len(head) < 2 || head[0] != '\'' && head[0] != '"') {
			return nil, nil
		}
		var constructor *ast.Node
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if n.Pos() > span.Pos() || n.End() < span.End() {
				return false
			}
			if n.ForEachChild(visit) {
				return true
			}
			if ast.IsConstructorDeclaration(n) && n.Body() != nil && n.FunctionLikeData().Parameters != nil && span.End() <= n.FunctionLikeData().Parameters.Pos() {
				constructor = n
				return true
			}
			return false
		}
		file.AsNode().ForEachChild(visit)
		if constructor == nil || len(constructor.Parameters()) != 0 || errorDeclarationBase(constructor.Parent) || ast.HasSyntacticModifier(constructor, ast.ModifierFlagsAsync) || constructor.Type() != nil || len(constructor.TypeParameters()) != 0 {
			return nil, nil
		}
		body := constructor.Body()
		var lexicalConstructorBinding func(*ast.Node) bool
		lexicalConstructorBinding = func(n *ast.Node) bool {
			return n.Kind == ast.KindSuperKeyword || n.Kind == ast.KindMetaProperty || n.ForEachChild(lexicalConstructorBinding)
		}
		if lexicalConstructorBinding(body) {
			return nil, nil
		}
		open := scanner.SkipTrivia(text, body.Pos())
		if open >= body.End() || text[open] != '{' || text[body.End()-1] != '}' {
			return nil, nil
		}
		changes := replaceRange(fix, span.Pos(), span.End(), "")
		changes = append(changes, replaceRange(fix, open+1, body.End()-1, " return effect {"+text[open+1:body.End()-1]+"}; ")...)
		return []*ls.CodeAction{{Description: "Keep the constructor's cold Effect return", Changes: changes}}, nil
	},
}

// Functions owns a forbidden effect accessor/constructor before the error-body
// categories. Match only the member's head: a nested diagnostic in its body or
// parameter initializer belongs to that nested member.
func restrictedEffectMember(member *ast.Node) bool {
	if member.Flags&ast.NodeFlagsReparsed != 0 || (member.Kind != ast.KindConstructor && member.Kind != ast.KindGetAccessor && member.Kind != ast.KindSetAccessor) {
		return false
	}
	parameters := member.FunctionLikeData().Parameters
	if parameters == nil {
		return false
	}
	start := member.Pos()
	if modifiers := member.Modifiers(); modifiers != nil {
		start = modifiers.End()
	}
	for _, d := range ast.GetSourceFileOfNode(member).Diagnostics() {
		if d.Source() == diagnosticSource && d.Code() == EK0104.Code && d.Pos() >= start && d.End() <= parameters.Pos() {
			return true
		}
	}
	return false
}
