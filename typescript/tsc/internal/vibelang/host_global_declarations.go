package vibelang

import (
	"path"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// The legacy platform table supplies specific replacements. VIP-33 also bans
// every other host global by its declarations, rather than a fixed name list.
var unlistedHostGlobal = EK4402.With("{0} reads a host global. Use an injected Effect service, or move the platform code to a .ts file.")

func init() { fileChecks = append(fileChecks, checkUnlistedHostGlobals) }

func checkUnlistedHostGlobals(c *checker.Checker, file *ast.SourceFile) {
	classified := map[*ast.Symbol]bool{}
	settings := optionsFor(c, file).VibeLang
	modules := settings == nil || settings.EffectModules != core.TSFalse
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		// Type-query operands carry value meaning to the checker, but are erased.
		if node.Kind == ast.KindTypeQuery {
			return false
		}
		var symbol *ast.Symbol
		switch {
		case ast.IsIdentifier(node):
			// Effect's namespace precedence applies to shorthand values too.
			if modules && isPreludeName(node.Text()) {
				break
			}

			if node.Parent != nil && ast.IsShorthandPropertyAssignment(node.Parent) {
				symbol = c.GetShorthandAssignmentValueSymbol(node.Parent)
			} else if isValueUse(node) {
				symbol = c.GetSymbolAtLocation(node)
			}
		case ast.IsPropertyAccessExpression(node):
			if isValueUse(node) {
				symbol = c.GetSymbolAtLocation(node)
			}
		case ast.IsElementAccessExpression(node):
			key := node.AsElementAccessExpression().ArgumentExpression
			if key != nil && (ast.IsStringLiteral(key) || key.Kind == ast.KindNoSubstitutionTemplateLiteral) && isValueUse(node) {
				symbol = c.GetPropertyOfType(c.GetApparentType(c.GetTypeAtLocation(node.Expression())), key.Text())
			}
		}
		if symbol != nil {
			banned, known := classified[symbol]
			if !known {
				banned = isUnlistedHostGlobal(c, symbol)
				classified[symbol] = banned
			}
			if banned {
				report(c, node, unlistedHostGlobal, nodeText(file, node))
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func isUnlistedHostGlobal(c *checker.Checker, symbol *ast.Symbol) bool {
	name := symbol.Name()
	if _, listed := platformGlobals[name]; listed {
		return false
	}
	switch name {
	case "AbortController", "AbortSignal", "TextDecoder", "TextEncoder",
		"URL", "URLSearchParams", "atob", "btoa", "structuredClone":
		return false
	}
	// A property with the same name on another object is a different symbol.
	if c.GlobalSymbol(name, ast.SymbolFlagsValue) != symbol {
		return false
	}
	host := false
	for _, declaration := range symbol.Declarations() {
		file := ast.GetSourceFileOfNode(declaration)
		if file == nil {
			continue
		}
		if isLibFile(c, file) {
			name := path.Base(string(file.FileName()))
			if strings.HasPrefix(name, "lib.es") || strings.HasPrefix(name, "lib.decorators") {
				return false
			}
			host = host || strings.HasPrefix(name, "lib.dom") ||
				strings.HasPrefix(name, "lib.webworker") || name == "lib.scripthost.d.ts"
		} else if packageOf(c, file) == "@types/node" {
			host = true
		}
	}
	return host
}
