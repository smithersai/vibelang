package vibelang

import (
	"context"
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
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
	if !returnsEffectful(c, call) && !proveNeverCallbacks(c, caller, call, decl, active) {
		return false
	}
	if bound, written := foreignThrowsContract(c, call); written {
		return !root && bound == ""
	}
	if !root {
		t := callTrust(c, call)
		if t.unknown || t.unreachable != "" || len(t.failures) != 0 {
			return false
		}
		if t.kind == trustES || t.kind == trustEffect || t.kind == trustBuiltin || t.kind == trustTagged || returnsEffectful(c, call) {
			return true
		}
	}
	return proveNeverBody(c, caller, decl, active)
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

// cliThrowsNeverFixes handles calls whose wrapper cannot preserve TypeScript
// control-flow predicates, and calls with no preserving wrapper. Other calls
// keep the established --fix wrapper choice; the editor offers both actions.
func cliThrowsNeverFixes(ctx context.Context, program *compiler.Program, scope *fixScope, refused map[string]bool) []proposal {
	for _, file := range scope.fixable(program) {
		ds := program.GetSemanticDiagnostics(ctx, file)
		c, done := program.GetTypeCheckerForFile(ctx, file)
		for _, d := range ds {
			if d.Source() != diagnosticSource || d.Code() != EK0403.Code {
				continue
			}
			callee := tsFormNodeAt(file, d.Loc(), isCallee)
			if callee == nil || !ast.IsCallExpression(callee.Parent) {
				continue
			}
			call := callee.Parent
			sig := c.GetResolvedSignature(call)
			if sig == nil || c.GetTypePredicateOfSignature(sig) == nil && planForeignCall(c, file, call).fixable() {
				continue
			}
			decl, rewrite := throwsNeverDeclaration(c, file, call)
			if !rewrite.fixable() {
				continue
			}
			target := ast.GetSourceFileOfNode(decl)
			key := fmt.Sprintf("throws-never:%s:%d", target.FileName(), decl.Pos())
			if !scope.includes(target.FileName()) || refused[key] {
				continue
			}
			done()
			return []proposal{{file: target, fixes: []fileFix{{code: EK0403.Code, key: key, edits: rewrite.edits}}}}
		}
		done()
	}
	return nil
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
				for _, match := range rethrowsTag.FindAllStringSubmatch(file.Text()[doc.Pos():doc.End()], -1) {
					named[match[1]] = true
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
			if isEffectfulType(c, c.GetReturnTypeOfSignature(callback)) || isVibeLangFile(ast.GetSourceFileOfNode(d)) {
				continue
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
	for index, parameter := range decl.Parameters() {
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
