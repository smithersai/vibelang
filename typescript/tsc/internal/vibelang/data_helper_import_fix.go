package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strings"
	"unicode"
)

const dataHelperFixTitle = "Keep this generic data helper type"

var dataHelperImportFixCodes = []int32{2305, 2694, 2724}

func init() {
	for _, code := range dataHelperImportFixCodes {
		registerNativeSchemaFix(code)
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		ErrorCodes: dataHelperImportFixCodes,
		GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
			defer done()
			var module, old *ast.Node
			var alias bool
			for node := reportedNode(fix.SourceFile, fix.Span, func(n *ast.Node) bool {
				return ast.IsIdentifier(n) || ast.IsQualifiedName(n) || ast.IsImportSpecifier(n) || ast.IsExportSpecifier(n) || ast.IsImportTypeNode(n)
			}); node != nil; node = node.Parent {
				if ast.IsImportSpecifier(node) || ast.IsExportSpecifier(node) {
					old = node.Name()
					if ast.IsImportSpecifier(node) {
						if property := node.AsImportSpecifier().PropertyName; property != nil {
							old = property
						} else {
							alias = true
						}
					} else {
						if property := node.AsExportSpecifier().PropertyName; property != nil {
							old = property
						} else {
							alias = true
						}
					}
					for p := node.Parent; p != nil; p = p.Parent {
						if ast.IsImportDeclaration(p) {
							module = p.AsImportDeclaration().ModuleSpecifier
							break
						}
						if ast.IsExportDeclaration(p) {
							module = p.AsExportDeclaration().ModuleSpecifier
							break
						}
					}
					break
				}
				if ast.IsQualifiedName(node) {
					module, old = node.AsQualifiedName().Left, node.AsQualifiedName().Right
					break
				}
				if ast.IsImportTypeNode(node) {
					it := node.AsImportTypeNode()
					if it.Qualifier != nil && ast.IsIdentifier(it.Qualifier) && ast.IsLiteralTypeNode(it.Argument) {
						module, old = it.Argument.AsLiteralTypeNode().Literal, it.Qualifier
					}
					break
				}
			}
			if module == nil || old == nil {
				return nil, nil
			}
			symbol := c.GetSymbolAtLocation(module)
			if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
				symbol = c.GetAliasedSymbol(symbol)
			}
			replacement := genericDataHelperExport(c, symbol, old.Text())
			if replacement == "" {
				return nil, nil
			}
			if alias {
				replacement += " as " + old.Text()
			}
			edits := replaceRange(fix, nodeStart(fix.SourceFile, old), old.End(), replacement)
			return []*ls.CodeAction{{Description: dataHelperFixTitle, Changes: edits}}, nil
		},
	})
}

func legacyDataHelperName(name, data string) bool {
	base := data + "Definition"
	if name == base {
		return true
	}
	suffix, ok := strings.CutPrefix(name, base)
	if !ok || suffix == "" {
		return false
	}
	for _, r := range suffix {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

func genericDataHelperExport(c *checker.Checker, module *ast.Symbol, old string) string {
	if module == nil {
		return ""
	}
	exports := c.GetExportsOfModule(module)
	resolve := func(s *ast.Symbol) *ast.Symbol {
		if s != nil && s.Flags()&ast.SymbolFlagsAlias != 0 {
			return c.GetAliasedSymbol(s)
		}
		return s
	}
	// Source modules identify the exact generated interface, including a suffix
	// selected because the source already declares the preferred helper name.
	for _, export := range exports {
		symbol := resolve(export)
		if symbol == nil {
			continue
		}
		for _, declaration := range symbol.Declarations() {
			if !parser.IsDataDeclaration(declaration) || len(declaration.TypeParameters()) == 0 || !legacyDataHelperName(old, declaration.Name().Text()) {
				continue
			}
			definition := dataDefinitionOf(declaration)
			if definition == nil {
				continue
			}
			for _, candidate := range exports {
				target := resolve(candidate)
				if target == nil {
					continue
				}
				for _, d := range target.Declarations() {
					if d == definition {
						return candidate.Name()
					}
				}
			}
		}
	}
	// Declaration-file consumers have no parser flags. Verify the real Effect
	// WithGenerics base and that the exported constructor names this interface.
	for _, candidate := range exports {
		name := candidate.Name()
		index := strings.LastIndex(name, "$Definition")
		if !strings.HasPrefix(name, "$") || index < 2 {
			continue
		}
		data := name[1:index]
		if !legacyDataHelperName(old, data) {
			continue
		}
		helper := resolve(candidate)
		if helper == nil || !effectDataDefinition(c, helper) {
			continue
		}
		for _, value := range exports {
			if value.Name() != data {
				continue
			}
			value = resolve(value)
			if value == nil {
				continue
			}
			for _, declaration := range value.Declarations() {
				if !ast.IsVariableDeclaration(declaration) || declaration.Type() == nil {
					continue
				}
				found := false
				var visit func(*ast.Node) bool
				visit = func(node *ast.Node) bool {
					if ast.IsIdentifier(node) && c.GetSymbolAtLocation(node) == helper {
						found = true
						return true
					}
					return node.ForEachChild(visit)
				}
				visit(declaration.Type())
				if found {
					return name
				}
			}
		}
	}
	return ""
}

func effectDataDefinition(c *checker.Checker, symbol *ast.Symbol) bool {
	for _, declaration := range symbol.Declarations() {
		if !ast.IsInterfaceDeclaration(declaration) {
			continue
		}
		heritage := declaration.AsInterfaceDeclaration().HeritageClauses
		if heritage == nil {
			continue
		}
		for _, clause := range heritage.Nodes {
			for _, base := range clause.AsHeritageClause().Types.Nodes {
				var name *ast.Node
				switch base.Kind {
				case ast.KindExpressionWithTypeArguments:
					name = base.AsExpressionWithTypeArguments().Expression
				case ast.KindTypeReference:
					name = base.AsTypeReferenceNode().TypeName
				default:
					continue
				}
				target := c.GetSymbolAtLocation(name)
				if target == nil || target.Name() != "WithGenerics" {
					continue
				}
				for _, d := range target.Declarations() {
					if isEffectModuleFile(ast.GetSourceFileOfNode(d), "Data") {
						return true
					}
				}
			}
		}
	}
	return false
}
