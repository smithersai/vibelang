package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// foreignThrowsContract reads the selected foreign signature, rather than a
// sibling overload. An annotation on a callable binding overrides its type's
// signature. A local alias preserves the foreign signature's contract (VIP-4).
// The written bit distinguishes @throws {never} from the foreign default.
func foreignThrowsContract(c *checker.Checker, call *ast.Node) (bound string, written bool) {
	decl := signatureDeclaration(c, call)
	if decl == nil {
		return "", false
	}
	file := ast.GetSourceFileOfNode(decl)
	if file == nil || isVibeLangFile(file) {
		return "", false
	}
	candidates := foreignCallBindingCandidates(c, call, true)
	candidates = append(candidates, decl)
	for _, candidate := range candidates {
		source := ast.GetSourceFileOfNode(candidate)
		if source == nil || isVibeLangFile(source) || isLibFile(c, source) {
			continue
		}
		for _, host := range jsdocHosts(candidate) {
			// A tag belongs to the call signature, never to its type alias.
			if ast.IsTypeAliasDeclaration(host) {
				break
			}
			if !hasThrowsTag(host) {
				continue
			}
			var bounds []string
			for _, doc := range host.JSDoc(nil) {
				for _, tag := range jsdocTags(doc) {
					if !ast.IsJSDocThrowsTag(tag) {
						continue
					}
					t := throwsTagType(tag)
					if t == nil {
						bounds = append(bounds, "unknown")
						continue
					}
					declared := c.GetTypeFromTypeNode(t)
					owners := foreignInvocationOwners(c, call)
					resolved := c.InstantiateWrittenSignatureType(c.GetResolvedSignature(call), declared, owners)
					if resolved.Flags()&checker.TypeFlagsNever == 0 {
						bound := strings.TrimSpace(nodeText(source, t))
						if resolved != declared {
							bound = c.TypeToString(resolved)
						}
						bounds = append(bounds, bound)
					}
				}
			}
			return strings.Join(bounds, " | "), true
		}
	}
	return "", false
}

// foreignCallBindingCandidates preserves a callable binding through inferred
// const aliases. A written destination type or an assertion establishes
// its own signature; no callable body is inspected.
func foreignCallBindingCandidates(c *checker.Checker, call *ast.Node, aliases bool) []*ast.Node {
	var candidates []*ast.Node
	seen := map[*ast.Symbol]bool{}
	var visit func(*ast.Symbol, bool)
	visit = func(symbol *ast.Symbol, direct bool) {
		if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if symbol == nil || seen[symbol] {
			return
		}
		seen[symbol] = true
		for _, decl := range symbol.Declarations() {
			if ast.IsVariableDeclaration(decl) || ast.IsPropertyDeclaration(decl) || decl.Kind == ast.KindPropertySignature {
				// An inferred alias transfers the written foreign throws contract.
				// Direct bindings retain their existing classification.
				eligible := direct
				file := ast.GetSourceFileOfNode(decl)
				if !direct && file != nil && !isVibeLangFile(file) && !isLibFile(c, file) {
					for _, host := range jsdocHosts(decl) {
						if ast.IsTypeAliasDeclaration(host) {
							break
						}
						if hasThrowsTag(host) {
							eligible = true
							break
						}
					}
				}
				if eligible {
					candidates = append(candidates, decl)
				}
			}
			if !aliases || !ast.IsVariableDeclaration(decl) || !ast.IsVarConst(decl) || decl.Type() != nil || decl.Initializer() == nil {
				continue
			}
			initializer := ast.SkipParentheses(decl.Initializer())
			if ast.IsIdentifier(initializer) || ast.IsPropertyAccessExpression(initializer) || ast.IsElementAccessExpression(initializer) {
				visit(c.GetSymbolAtLocation(initializer), false)
			}
		}
	}
	visit(calleeSymbol(c, call), true)
	return candidates
}

var foreignThrowingCall = EK0403.With("'{0}' may throw '{1}'. Wrap the call with 'try Effect.try(() => …)'.")

// foreignInvocationOwners retains receiver substitutions through inferred
// const references without inspecting a callable body or crossing a type.
func foreignInvocationOwners(c *checker.Checker, call *ast.Node) []*checker.Type {
	return append(foreignReferenceOwners(c, ast.GetInvokedExpression(call)), c.GetTypeAtLocation(call))
}

func foreignReferenceOwners(c *checker.Checker, expression *ast.Node) []*checker.Type {
	var owners []*checker.Type
	seen := map[*ast.Symbol]bool{}
	var visit func(*ast.Node)
	visit = func(expression *ast.Node) {
		expression = ast.SkipParentheses(expression)
		if expression == nil {
			return
		}
		owners = append(owners, defaultForeignValueOwners(c, expression)...)
		if !ast.IsIdentifier(expression) && !ast.IsPropertyAccessExpression(expression) && !ast.IsElementAccessExpression(expression) {
			return
		}
		symbol := c.GetSymbolAtLocation(expression)
		if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if symbol == nil || seen[symbol] {
			return
		}
		seen[symbol] = true
		for _, declaration := range symbol.Declarations() {
			if ast.IsBindingElement(declaration) {
				root := ast.GetRootDeclaration(declaration)
				if ast.IsVariableDeclaration(root) && ast.IsVarConst(root) {
					safe := true
					for element := declaration; ast.IsBindingElement(element); element = element.Parent.Parent {
						if element.Initializer() != nil {
							safe = false
							break
						}
					}
					if safe {
						// A binding pattern has no variable symbol; use its resolved container.
						containerNode := declaration.Parent.Parent
						var container *checker.Type
						if ast.IsVariableDeclaration(containerNode) {
							if containerNode.Type() != nil {
								container = c.GetTypeFromTypeNode(containerNode.Type())
							} else if containerNode.Initializer() != nil {
								container = c.GetTypeAtLocation(containerNode.Initializer())
							}
						} else {
							container = c.GetTypeAtLocation(containerNode)
						}
						owners = append(owners, defaultForeignCallbackOwners(c, []*checker.Type{container})...)
					}
				}
				continue
			}
			if !ast.IsVariableDeclaration(declaration) || !ast.IsVarConst(declaration) || declaration.Type() != nil || declaration.Initializer() == nil {
				continue
			}
			initializer := ast.SkipParentheses(declaration.Initializer())
			if ast.IsIdentifier(initializer) || ast.IsPropertyAccessExpression(initializer) || ast.IsElementAccessExpression(initializer) {
				visit(initializer)
			}
		}
	}
	visit(expression)
	return owners
}
