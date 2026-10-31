package vibelang

import (
	"path"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// The VIP-33 allowlist admits these constructors' pure operations, but not
// these three members that start a timer or change the host's object-URL store.
type platformHostValue struct{ root, member string }

func platformHostKey(node *ast.Node) string {
	if node == nil {
		return ""
	}
	if ast.IsIdentifier(node) || ast.IsStringLiteralLike(node) {
		return node.Text()
	}
	if ast.IsComputedPropertyName(node) && ast.IsStringLiteralLike(node.Expression()) {
		return node.Expression().Text()
	}
	return ""
}

func platformHostProperty(value platformHostValue, key string) platformHostValue {
	if value.member != "" {
		return platformHostValue{}
	}
	if value.root == "AbortSignal" && key == "timeout" ||
		value.root == "URL" && (key == "createObjectURL" || key == "revokeObjectURL") {
		return platformHostValue{root: value.root, member: key}
	}
	return platformHostValue{}
}

func platformHostGlobal(c *checker.Checker, symbol *ast.Symbol) bool {
	if symbol == nil {
		return false
	}
	host := false
	for _, decl := range symbol.Declarations() {
		file := ast.GetSourceFileOfNode(decl)
		if file == nil {
			continue
		}
		filename := file.FileName().AsString()
		library := isLibFile(c, file)
		if library {
			base := path.Base(filename)
			if strings.HasPrefix(base, "lib.es") || strings.HasPrefix(base, "lib.decorators") {
				return false
			}
		}
		if !file.IsDeclarationFile {
			continue
		}
		if library && (strings.Contains(filename, "/lib.dom") || strings.Contains(filename, "/lib.webworker") ||
			strings.HasSuffix(filename, "/lib.scripthost.d.ts")) || packageOf(c, file) == "@types/node" {
			host = true
		}
	}
	return host
}

func platformHostConst(declaration *ast.Node) bool {
	return declaration != nil && declaration.Parent != nil && ast.IsVariableDeclarationList(declaration.Parent) &&
		declaration.Parent.Flags&ast.NodeFlagsConst != 0
}

// Only function-local lets without a source write are stable value copies.
// A write anywhere in a closure invalidates that proof; a same-named binding
// in another scope does not.
func platformHostStable(declaration *ast.Node, symbol *ast.Symbol, writes map[*ast.Symbol]bool) bool {
	if platformHostConst(declaration) {
		return true
	}
	return declaration != nil && declaration.Parent != nil && ast.IsVariableDeclarationList(declaration.Parent) &&
		declaration.Parent.Flags&ast.NodeFlagsLet != 0 && !writes[symbol] &&
		ast.FindAncestor(declaration, ast.IsFunctionLike) != nil
}

func platformHostWrites(c *checker.Checker, file *ast.SourceFile) map[*ast.Symbol]bool {
	writes := map[*ast.Symbol]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) && node.Parent != nil {
			target := node
			for target.Parent != nil && ast.IsOuterExpression(target.Parent, ast.OEKAll) && target.Parent.Expression() == target {
				target = target.Parent
			}
			if ast.IsAssignmentTarget(target) {
				symbol := c.GetSymbolAtLocation(node)
				if ast.IsShorthandPropertyAssignment(node.Parent) && node.Parent.Name() == node {
					symbol = c.GetShorthandAssignmentValueSymbol(node.Parent)
				}
				if symbol != nil {
					writes[symbol] = true
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return writes
}

// Follow value copies, not function types: a locally implemented function can
// have typeof AbortSignal.timeout without becoming the host's function.
func platformHostOrigin(c *checker.Checker, node *ast.Node, seen map[*ast.Symbol]bool, cache map[*ast.Symbol]platformHostValue, writes map[*ast.Symbol]bool, values map[*ast.Node]platformHostValue) (result platformHostValue) {
	if node == nil {
		return platformHostValue{}
	}
	node = ast.SkipOuterExpressions(node, ast.OEKAll)
	if value, ok := values[node]; ok {
		return value
	}
	defer func() { values[node] = result }()
	if ast.IsPropertyAccessExpression(node) || ast.IsElementAccessExpression(node) {
		key := ""
		if ast.IsPropertyAccessExpression(node) {
			key = node.Name().Text()
		} else {
			argument := node.AsElementAccessExpression().ArgumentExpression
			if ast.IsStringLiteralLike(argument) {
				key = argument.Text()
			}
		}
		receiver := platformHostOrigin(c, node.Expression(), seen, cache, writes, values)
		if receiver.root == "globalThis" && key != "" {
			symbol := c.GetSymbolAtLocation(node)
			if symbol == nil {
				// Literal element keys need a property lookup on the actual receiver.
				symbol = c.GetPropertyOfType(c.GetTypeAtLocation(node.Expression()), key)
			}
			if key == "globalThis" && symbol != nil && symbol.Name() == "globalThis" && len(symbol.Declarations()) == 0 {
				return receiver
			}
			if (key == "AbortSignal" || key == "URL") && platformHostGlobal(c, symbol) {
				return platformHostValue{root: key}
			}
		}
		return platformHostProperty(receiver, key)
	}
	if !ast.IsIdentifier(node) {
		return platformHostValue{}
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil || seen[symbol] {
		return platformHostValue{}
	}
	if cached, ok := cache[symbol]; ok {
		return cached
	}
	if symbol.Name() == "globalThis" && len(symbol.Declarations()) == 0 {
		return platformHostValue{root: "globalThis"}
	}
	if (symbol.Name() == "AbortSignal" || symbol.Name() == "URL") && platformHostGlobal(c, symbol) {
		return platformHostValue{root: symbol.Name()}
	}
	seen[symbol] = true
	defer func() { delete(seen, symbol); cache[symbol] = result }()
	for _, declaration := range symbol.Declarations() {
		if ast.IsVariableDeclaration(declaration) && platformHostStable(declaration, symbol, writes) {
			return platformHostOrigin(c, declaration.Initializer(), seen, cache, writes, values)
		}
		if ast.IsBindingElement(declaration) && declaration.Parent != nil && ast.IsObjectBindingPattern(declaration.Parent) {
			variable := declaration.Parent.Parent
			if ast.IsVariableDeclaration(variable) && platformHostStable(variable, symbol, writes) {
				name := declaration.PropertyName()
				if name == nil {
					name = declaration.Name()
				}
				return platformHostProperty(platformHostOrigin(c, variable.Initializer(), seen, cache, writes, values), platformHostKey(name))
			}
		}
	}
	return platformHostValue{}
}

func checkPlatformHostMembers(c *checker.Checker, file *ast.SourceFile) {
	cache := map[*ast.Symbol]platformHostValue{}
	writes := platformHostWrites(c, file)
	values := map[*ast.Node]platformHostValue{}

	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		var at *ast.Node
		switch {
		case ast.IsBindingElement(node):
			at = node.Name()
			if at == nil || !ast.IsIdentifier(at) {
				break
			}
		case ast.IsIdentifier(node):
			if node.Parent != nil && ast.IsBindingElement(node.Parent) && (node.Parent.Name() == node || node.Parent.PropertyName() == node) || !isValueUse(node) {
				break
			}
			at = node
		case ast.IsPropertyAccessExpression(node) || ast.IsElementAccessExpression(node):
			if isValueUse(node) {
				at = node
			}
		}
		if at != nil {
			if value := platformHostOrigin(c, at, map[*ast.Symbol]bool{}, cache, writes, values); value.member != "" {
				name := value.root + "." + value.member
				d := report(c, at, EK4402.With("{0} reaches the host and cannot be used in a .vibe file."), name)
				if value.root == "AbortSignal" {
					note(d, "Use Effect.timeout for a time limit, or move signal construction into a sibling .ts module.")
				} else {
					note(d, "Move this object-URL operation into a sibling .ts module and expose it through an Effect.")
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func init() { fileChecks = append(fileChecks, checkPlatformHostMembers) }
