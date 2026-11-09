package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// This proof is used only to offer an explicit contract edit. In particular it
// does not change VIP-40's unknown default for an unannotated TypeScript call.
func throwsNeverDeclaration(c *checker.Checker, caller *ast.SourceFile, call *ast.Node) (*ast.Node, *formRewrite) {
	if !ast.IsCallExpression(call) {
		return nil, nil
	}
	if _, written := foreignThrowsContract(c, call); written {
		return nil, nil
	}
	decl := signatureDeclaration(c, call)
	if decl == nil || decl.Body() == nil || !sameProjectTypeScript(c, caller, ast.GetSourceFileOfNode(decl)) {
		return nil, nil
	}
	if !proveThrowsNever(c, caller, call, map[*ast.Node]bool{}, true) {
		return nil, nil
	}
	host := decl
	if ast.IsArrowFunction(decl) || ast.IsFunctionExpression(decl) {
		for _, candidate := range jsdocHosts(decl) {
			if ast.IsVariableStatement(candidate) {
				if len(candidate.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes) != 1 {
					return nil, nil
				}
				host = candidate
				break
			}
		}
	}
	file := ast.GetSourceFileOfNode(host)
	// Keep all existing comment bytes, adding the new tag to the last JSDoc.
	docs := host.JSDoc(nil)
	if len(docs) > 0 {
		doc := docs[len(docs)-1]
		end := doc.End()
		if end < 2 || file.Text()[end-2:end] != "*/" {
			return nil, nil
		}
		at := end - 2
		prefix := "\n" + lineIndent(file.Text(), nodeStart(file, host)) + " * @throws {never}\n" + lineIndent(file.Text(), nodeStart(file, host)) + " "
		return decl, &formRewrite{edits: []sourceEdit{{at, at, prefix}}}
	}
	at := nodeStart(file, host)
	return decl, &formRewrite{edits: []sourceEdit{{at, at, "/** @throws {never} */\n" + lineIndent(file.Text(), at)}}}
}

func sameProjectTypeScript(c *checker.Checker, caller, file *ast.SourceFile) bool {
	if file == nil || file.IsDeclarationFile || !strings.HasSuffix(file.FileName().AsString(), ".ts") ||
		strings.Contains(file.FileName().AsString(), "/node_modules/") || isLibFile(c, file) ||
		c.Program().IsSourceFileFromExternalLibrary(file) || c.Program().GetProjectReferenceFromSource(file.PathKey()) != nil {
		return false
	}
	home := nearestConfig(c, caller.FileName().Directory())
	other := nearestConfig(c, file.FileName().Directory())
	if home == "" || other == "" || !samePath(c, home.AsPath(), other.AsPath()) {
		return false
	}
	owner, _ := packageRootOf(c, caller.FileName().Directory())
	target, _ := packageRootOf(c, file.FileName().Directory())
	return owner == target
}

// An active node closes a recursive edge, not the proof. Every reachable body
// still has to pass, including siblings after a back edge. Do not cache a
// provisional success: a later throw in the same strongly connected component
// must reject the whole candidate.
func proveThrowsNever(c *checker.Checker, caller *ast.SourceFile, call *ast.Node, active map[*ast.Node]bool, root bool) bool {
	if len(knownRethrownTypes(c, call)) != 0 {
		return false
	}
	decl := signatureDeclaration(c, call)
	if decl == nil {
		return false
	}
	// A single selected overload cannot establish a contract for its siblings.
	signatures := c.GetCallSignatures(c.GetTypeAtLocation(ast.GetInvokedExpression(call)))
	if ast.IsNewExpression(call) {
		signatures = c.GetConstructSignatures(c.GetTypeAtLocation(ast.GetInvokedExpression(call)))
	}
	for _, sig := range signatures {
		d := sig.Declaration()
		if d == nil {
			return false
		}
		if d != decl {
			contract := writtenThrows(c, d)
			if !contract.tagged || contract.unknown || len(contract.types) != 0 {
				return false
			}
		}
	}
	if !proveNeverCallbacks(c, caller, call, decl, active) {
		return false
	}
	if bound, written := foreignThrowsContract(c, call); written {
		return !root && bound == ""
	}
	if !root && isLibFile(c, ast.GetSourceFileOfNode(decl)) {
		return proveNeverBuiltin(c, call, decl)
	}
	// Trust classifications describe the Effect error channel, not the
	// absence of synchronous defects. Only an explicit contract or a
	// recursively checked local body proves this declaration edit.
	return proveNeverBody(c, caller, decl, active)
}

// Appendix E's never annotation is necessary, but implicit throws (getters,
// proxy traps, coercion and iteration) are defects outside that static contract.
// Keep this proof deliberately smaller than the compiler's builtin trust set.
func proveNeverBuiltin(c *checker.Checker, call, decl *ast.Node) bool {
	key := globalKey(decl)
	if globalThrowsTable[key] != "never" ||
		!isGlobalOf(calleeSymbol(c, call), func(f *ast.SourceFile) bool { return isLibFile(c, f) }) {
		return false
	}
	// Numeric Math calls cannot invoke user coercion when all inputs are
	// numbers. Other builtins need their own proof before being admitted.
	if !strings.HasPrefix(key, "Math.") {
		return false
	}
	for _, arg := range call.Arguments() {
		if ast.IsSpreadElement(arg) || c.GetTypeAtLocation(arg).Flags()&checker.TypeFlagsNumberLike == 0 {
			return false
		}
	}
	return true
}

func proveNeverBody(c *checker.Checker, caller *ast.SourceFile, decl *ast.Node, active map[*ast.Node]bool) bool {
	file := ast.GetSourceFileOfNode(decl)
	if !sameProjectTypeScript(c, caller, file) || decl.Body() == nil {
		return false
	}
	for _, host := range jsdocHosts(decl) {
		for _, doc := range host.JSDoc(nil) {
			for _, tag := range jsdocTags(doc) {
				if isContractTag(tag) {
					return false
				}
			}
		}
	}
	if active[decl] {
		return true
	}
	active[decl] = true
	defer delete(active, decl)
	var unsafe func(*ast.Node) bool
	unsafe = func(n *ast.Node) bool {
		if ast.IsThrowStatement(n) || isThrowExpression(file, n) {
			return true
		}
		// A constructor body alone does not cover field initializers, and
		// class evaluation can invoke heritage/decorator proxy traps.
		if ast.IsNewExpression(n) || ast.IsClassDeclaration(n) || ast.IsClassExpression(n) {
			return true
		}
		// These forms can execute user code without a syntactic call.
		if ast.IsForOfStatement(n) || ast.IsForInStatement(n) ||
			ast.IsSpreadElement(n) || ast.IsSpreadAssignment(n) ||
			ast.IsObjectBindingPattern(n) || ast.IsArrayBindingPattern(n) {
			return true
		}
		if ast.IsPropertyAccessExpression(n) || ast.IsElementAccessExpression(n) {
			// A builtin's global namespace read is the only non-literal
			// property read proved here; an arbitrary receiver may be a Proxy
			// or expose a getter even when its type has a plain property.
			parent := n.Parent
			if parent == nil || !ast.IsCallExpression(parent) || parent.Expression() != n {
				return true
			}
			d := signatureDeclaration(c, parent)
			receiver := n.Expression()
			if d == nil || !isLibFile(c, ast.GetSourceFileOfNode(d)) ||
				!proveNeverBuiltin(c, parent, d) || !ast.IsIdentifier(receiver) ||
				!isGlobalOf(c.GetSymbolAtLocation(receiver), func(f *ast.SourceFile) bool { return isLibFile(c, f) }) {
				return true
			}
		}
		if ast.IsPrefixUnaryExpression(n) {
			unary := n.AsPrefixUnaryExpression()
			if unary.Operator != ast.KindExclamationToken && c.GetTypeAtLocation(unary.Operand).Flags()&checker.TypeFlagsNumberLike == 0 {
				return true
			}
		}
		if ast.IsPostfixUnaryExpression(n) && c.GetTypeAtLocation(n.AsPostfixUnaryExpression().Operand).Flags()&checker.TypeFlagsNumberLike == 0 {
			return true
		}
		if n.Kind == ast.KindComputedPropertyName || n.Kind == ast.KindTemplateExpression ||
			n.Kind == ast.KindAwaitExpression || n.Kind == ast.KindYieldExpression {
			return true
		}
		if ast.IsBinaryExpression(n) {
			binary := n.AsBinaryExpression()
			switch binary.OperatorToken.Kind {
			case ast.KindEqualsEqualsEqualsToken, ast.KindExclamationEqualsEqualsToken,
				ast.KindAmpersandAmpersandToken, ast.KindBarBarToken, ast.KindQuestionQuestionToken,
				ast.KindEqualsToken, ast.KindCommaToken:
				// Strict equality, truthiness and assignment do not coerce.
			case ast.KindEqualsEqualsToken, ast.KindExclamationEqualsToken:
				if binary.Left.Kind != ast.KindNullKeyword && binary.Right.Kind != ast.KindNullKeyword {
					return true
				}
			case ast.KindInKeyword, ast.KindInstanceOfKeyword:
				return true
			default:
				// Objects can run coercion hooks; bigint arithmetic can throw.
				primitive := checker.TypeFlagsNumberLike | checker.TypeFlagsStringLike
				if c.GetTypeAtLocation(binary.Left).Flags()&primitive == 0 ||
					c.GetTypeAtLocation(binary.Right).Flags()&primitive == 0 {
					return true
				}
			}
		}
		if ast.IsCallExpression(n) || ast.IsNewExpression(n) || ast.IsTaggedTemplateExpression(n) {
			if !proveThrowsNever(c, caller, n, active, false) {
				return true
			}
		}
		return n.ForEachChild(unsafe)
	}
	for _, parameter := range decl.Parameters() {
		if unsafe(parameter) {
			return false
		}
	}
	return !unsafe(decl.Body())
}

func throwsNeverAction(c *checker.Checker, fix *ls.CodeFixContext, call *ast.Node) *ls.CodeAction {
	decl, rewrite := throwsNeverDeclaration(c, fix.SourceFile, call)
	if !rewrite.fixable() {
		return nil
	}
	file := ast.GetSourceFileOfNode(decl)
	name := nodeText(fix.SourceFile, call.Expression())
	edits := make([]*lsproto.TextEdit, 0, len(rewrite.edits))
	for _, edit := range rewrite.edits {
		edits = append(edits, &lsproto.TextEdit{Range: fix.LS.ToLSPRange(file, core.NewTextRange(edit.start, edit.end)), NewText: edit.text})
	}
	return &ls.CodeAction{Description: "Add /** @throws {never} */ to " + name,
		Changes:           []*lsproto.TextEdit{},
		AdditionalChanges: []ls.FileTextChanges{{URI: lsconv.FileNameToDocumentURI(file.FileName()), Changes: edits}}}
}

// proveNeverCallbacks includes unknown callback contracts, unlike the plain-code
// known-throws diagnostic. Tagged substitutions and rest parameters are calls too.
func proveNeverCallbacks(c *checker.Checker, caller *ast.SourceFile, call, decl *ast.Node, active map[*ast.Node]bool) bool {
	file := ast.GetSourceFileOfNode(decl)
	if file == nil || !ast.IsFunctionLike(decl) {
		return true
	}
	named := map[string]bool{}
	if isLibFile(c, file) {
		key := globalKey(decl)
		if strings.HasPrefix(key, "Array.") || strings.HasPrefix(key, "ReadonlyArray.") || key == "ArrayConstructor.from" {
			if name := shippedRethrows[declarationName(decl)]; name != "" {
				named[name] = true
			}
		}
	} else {
		for _, host := range jsdocHosts(decl) {
			for _, doc := range host.JSDoc(nil) {
				for _, parameterName := range rethrowsParameterNames(file.Text()[doc.Pos():doc.End()]) {
					named[parameterName] = true
				}
			}
		}
	}
	if len(named) == 0 {
		return true
	}
	var args []*ast.Node
	if ast.IsTaggedTemplateExpression(call) {
		args = append(args, nil)
		template := call.AsTaggedTemplateExpression().Template
		if template.Kind == ast.KindTemplateExpression {
			for _, span := range template.AsTemplateExpression().TemplateSpans.Nodes {
				args = append(args, span.AsTemplateSpan().Expression)
			}
		}
	} else {
		args = call.Arguments()
	}
	check := func(arg *ast.Node) bool {
		if arg == nil || ast.IsSpreadElement(arg) {
			return false
		}
		callbacks := c.GetCallSignatures(c.GetTypeAtLocation(arg))
		if len(callbacks) == 0 {
			return false
		}
		for _, callback := range callbacks {
			d := callback.Declaration()
			if d == nil {
				return false
			}
			contract := writtenThrows(c, d)
			if contract.tagged {
				if contract.unknown || len(contract.types) != 0 {
					return false
				}
			} else if !proveNeverBody(c, caller, d, active) {
				return false
			}
		}
		return true
	}
	for index, parameter := range rethrowsRuntimeParameters(decl) {
		if !named[declarationName(parameter)] {
			continue
		}
		end := index + 1
		if parameter.AsParameterDeclaration().DotDotDotToken != nil {
			end = len(args)
		}
		if index >= len(args) {
			if init := parameter.Initializer(); init != nil && !check(init) {
				return false
			}
		}
		for position := index; position < end && position < len(args); position++ {
			if !check(args[position]) {
				return false
			}
		}
	}
	return true
}
