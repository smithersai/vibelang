package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
)

// Spec functions and proof blocks (VIP-43, Appendix F). The parser flags a
// spec function, spec function f() { … }, with ast.NodeFlagsVibeLangSpec, a
// proof block, proof { … }, with ast.NodeFlagsVibeLangProof, and the call of
// each proof statement in a proof block with ast.NodeFlagsVibeLangProof too
// (parser/vibelang_proofs.go). The checker types a spec function as a plain
// function and each proof statement against its own signature
// (checker/extensions_proofs.go). This file erases both forms from the
// emitted JavaScript, and checks the rules the compiler owns. The
// declaration transform drops spec functions (transformers/declarations).
// vibelang prove lowers them for LemmaScript (prove.go).

var (
	// EK4302: a modifier or overload on a spec function. {0} says which.
	EK4302 = message(4302, errorCategory, "A spec function can't be {0}: spec functions are local to their module and erase from the emitted code. Remove it.")
	// EK4304: a proof block outside a checked function's statement lists.
	EK4304 = message(4304, errorCategory, "A proof block goes in a statement list of a checked function: a named plain function or spec function at the module's top level, outside nested functions, classes, object literals and other proof blocks. Move the facts into a module-level plain function, or into a braced block.")
	// EK4305: a statement a proof block can't hold, or a const nothing uses.
	EK4305 = message(4305, errorCategory, "A proof block holds only proof statements, const declarations, if statements and blocks, and runs none of them. Use const, if and proof statements.")
	// EK4306: a proof statement outside its allowed place. {0} is the statement, {1} where it belongs.
	EK4306 = message(4306, errorCategory, "{0} belongs as a direct statement of {1}. Move it to the leading proof block of the function or loop it describes.")
	// EK4307: by in a proof context.
	EK4307 = message(4307, errorCategory, "by is reserved in a proof context, and this version has no proof tactics. Remove it; write proof steps in the proof file.")
	// EK4309: ensures without a written return type or an arrow (r) => Q.
	EK4309 = message(4309, errorCategory, "ensures needs the function's written return type, other than void and undefined, and an arrow with one untyped identifier parameter and an expression body. Write the return type and ensures((r) => …).")
	// EK4310: a reference to a spec function from running code. {0} is its name.
	EK4310 = message(4310, errorCategory, "{0} is a spec function: it erases from the emitted code, so only proof blocks and other spec functions can use it. Call a plain function, or move the use into a proof block.")
	// EK4314: a spec function that is not transparent. {0} says why.
	EK4314 = message(4314, errorCategory, "A spec function must be transparent, but {0}. Write it with expressions and recursion.")
)

var (
	proofUnusedConst = EK4305.With("{0} is a const that no later statement of its proof block uses. Use it, or remove it.")
)

func init() {
	for _, m := range []*Message{EK4302, EK4304, EK4305, EK4306, EK4307, EK4309, EK4310, EK4314} {
		registry[m.Code] = m
	}
	fileChecks = append(fileChecks, checkProofForms)
}

// mayHoldProofForms is a fast filter: a file without the words spec and proof
// holds neither form.
func mayHoldProofForms(file *ast.SourceFile) bool {
	text := file.Text()
	return strings.Contains(text, "spec") || strings.Contains(text, "proof")
}

// isSpecFunction reports whether node is a function declaration marked spec.
func isSpecFunction(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindFunctionDeclaration && node.Flags&ast.NodeFlagsVibeLangSpec != 0
}

// isProofBlock reports whether node is a proof block, proof { … }.
func isProofBlock(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindBlock && node.Flags&ast.NodeFlagsVibeLangProof != 0
}

// isProofStatement reports whether node is an expression statement whose
// call the parser flagged as a proof statement, and returns its name.
func isProofStatement(node *ast.Node) (string, bool) {
	if node == nil || node.Kind != ast.KindExpressionStatement {
		return "", false
	}
	call := node.Expression()
	if !ast.IsCallExpression(call) || call.Flags&ast.NodeFlagsVibeLangProof == 0 {
		return "", false
	}
	return call.Expression().Text(), true
}

// newProofEraser erases spec functions and proof blocks from the emitted
// JavaScript. It runs before the lowering, so no lowering sees them.
func newProofEraser(opts *transformers.TransformOptions, file *ast.SourceFile) *transformers.Transformer {
	if !isVibeLangFile(file) || !mayHoldProofForms(file) {
		return nil
	}
	tx := &proofEraser{}
	return tx.NewTransformer(tx.visit, opts.Context)
}

type proofEraser struct {
	transformers.Transformer
}

func (tx *proofEraser) visit(node *ast.Node) *ast.Node {
	if isSpecFunction(node) || isProofBlock(node) {
		if isStatementListHome(node.Parent) {
			return nil
		}
		// Rule 4304's if (c) proof { } keeps its statement position.
		return tx.Factory().NewBlock(tx.Factory().NewNodeList(nil), false /*multiLine*/)
	}
	return tx.Visitor().VisitEachChild(node)
}

// isStatementListHome reports whether node holds its statements in a list.
func isStatementListHome(node *ast.Node) bool {
	if node == nil {
		return false
	}
	switch node.Kind {
	case ast.KindSourceFile, ast.KindBlock, ast.KindModuleBlock, ast.KindCaseClause, ast.KindDefaultClause:
		return true
	}
	return false
}

// checkProofForms checks the spec functions and proof blocks of file.
func checkProofForms(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) || !mayHoldProofForms(file) {
		return
	}
	var specs []*ast.Node
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isSpecFunction(n) {
			specs = append(specs, n)
			checkSpecFunctionHead(c, n)
		} else if isProofBlock(n) {
			checkProofBlock(c, n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if len(specs) > 0 {
		checkSpecReferences(c, file, specs)
		checkSpecTransparency(c, specs)
	}
}

// checkSpecFunctionHead reports EK4302 for each modifier or overload of fn.
func checkSpecFunctionHead(c *checker.Checker, fn *ast.Node) {
	if modifiers := fn.Modifiers(); modifiers != nil {
		for _, m := range modifiers.Nodes {
			switch m.Kind {
			case ast.KindExportKeyword:
				report(c, m, EK4302, "exported")
			case ast.KindDeclareKeyword:
				report(c, m, EK4302, "declared")
			case ast.KindAsyncKeyword:
				report(c, m, EK4302, "async")
			}
		}
	}
	at := fn.Name()
	if at == nil {
		at = fn
	}
	if isMarkedEffect(fn) {
		report(c, at, EK4302, "an effect function")
	}
	if fn.AsFunctionDeclaration().AsteriskToken != nil {
		report(c, at, EK4302, "a generator")
	}
	if fn.Body() == nil || isOverloaded(c, fn) {
		report(c, at, EK4302, "overloaded")
	}
}

// isOverloaded reports whether fn's name declares more than one function.
func isOverloaded(c *checker.Checker, fn *ast.Node) bool {
	symbol := c.GetSymbolOfDeclaration(fn)
	if symbol == nil {
		return false
	}
	count := 0
	for _, d := range symbol.Declarations() {
		if d.Kind == ast.KindFunctionDeclaration {
			count++
		}
	}
	return count > 1
}

// checkedFunction returns fn when it is a checked function (Appendix F
// "Proof blocks"): a named function declaration with a body at the top level
// of a .vibe or .vibex module that is not effect, async or a generator and has
// no overloads. Otherwise it returns nil.
func checkedFunction(c *checker.Checker, fn *ast.Node) *ast.Node {
	if fn == nil || fn.Kind != ast.KindFunctionDeclaration || fn.Name() == nil || fn.Body() == nil {
		return nil
	}
	if fn.Parent == nil || fn.Parent.Kind != ast.KindSourceFile || !isVibeLangFile(fn.Parent.AsSourceFile()) {
		return nil
	}
	if isMarkedEffect(fn) || ast.HasSyntacticModifier(fn, ast.ModifierFlagsAsync|ast.ModifierFlagsAmbient) || fn.AsFunctionDeclaration().AsteriskToken != nil || isOverloaded(c, fn) {
		return nil
	}
	return fn
}

// proofBlockOwner returns the checked function whose statement list holds
// block, or nil when block is not in one (rule 4304).
func proofBlockOwner(c *checker.Checker, block *ast.Node) *ast.Node {
	if !isStatementListHome(block.Parent) || block.Parent.Kind == ast.KindSourceFile || block.Parent.Kind == ast.KindModuleBlock {
		return nil
	}
	for n := block.Parent; n != nil; n = n.Parent {
		switch {
		case isProofBlock(n):
			return nil
		case ast.IsFunctionLike(n):
			return checkedFunction(c, n)
		case ast.IsClassLike(n) || ast.IsObjectLiteralExpression(n) || n.Kind == ast.KindSourceFile || n.Kind == ast.KindModuleBlock:
			return nil
		}
	}
	return nil
}

// proofBlockRole is where a proof block stands, which decides the proof
// statements it may hold directly.
type proofBlockRole int

const (
	proofBlockOther    proofBlockRole = iota // any other proof block: assert
	proofBlockFunction                       // the function's leading block: assume, ensures, decreases, assert
	proofBlockLoop                           // a loop's leading block: invariant, decreases, assert
)

// roleOfProofBlock returns block's role in owner.
func roleOfProofBlock(block *ast.Node, owner *ast.Node) proofBlockRole {
	list := block.Parent
	if !isLeadingStatement(block, list) {
		return proofBlockOther
	}
	if list == owner.Body() {
		return proofBlockFunction
	}
	if loop := list.Parent; loop != nil && list.Kind == ast.KindBlock {
		switch loop.Kind {
		case ast.KindWhileStatement, ast.KindForStatement, ast.KindForOfStatement:
			if loop.Statement() == list {
				return proofBlockLoop
			}
		}
	}
	return proofBlockOther
}

// isLeadingStatement reports whether statement is the first statement of
// list after any directive prologue.
func isLeadingStatement(statement *ast.Node, list *ast.Node) bool {
	for _, s := range list.Statements() {
		if s == statement {
			return true
		}
		if !ast.IsPrologueDirective(s) {
			return false
		}
	}
	return false
}

// checkProofBlock checks block's place (4304), statements (4305), proof
// statements (4306), use of by (4307) and contracts (4309).
func checkProofBlock(c *checker.Checker, block *ast.Node) {
	owner := proofBlockOwner(c, block)
	if owner == nil {
		report(c, block, EK4304)
		return
	}
	role := roleOfProofBlock(block, owner)
	checkProofStatements(c, block.Statements(), owner, role, true /*direct*/)
	checkProofBy(c, block)
}

// checkProofStatements checks statements, the statements of a proof block or
// of an if or block inside one; direct is whether they are the proof block's
// own.
func checkProofStatements(c *checker.Checker, statements []*ast.Node, owner *ast.Node, role proofBlockRole, direct bool) {
	for i, statement := range statements {
		checkProofStatement(c, statement, owner, role, direct)
		if declaration := proofConst(statement); declaration != nil && !referencedLater(c, declaration, statements[i+1:]) {
			report(c, declaration.Name(), proofUnusedConst, declaration.Name().Text())
		}
	}
}

func checkProofStatement(c *checker.Checker, statement *ast.Node, owner *ast.Node, role proofBlockRole, direct bool) {
	if name, ok := isProofStatement(statement); ok {
		checkProofStatementPlace(c, statement, name, role, direct)
		call := statement.Expression()
		switch name {
		case "ensures":
			checkEnsures(c, call, owner)
		case "assert":
			if args := call.Arguments(); len(args) > 1 {
				report(c, args[1], EK4307)
			}
		}
		return
	}
	switch statement.Kind {
	case ast.KindVariableStatement:
		if proofConst(statement) == nil {
			report(c, statement, EK4305)
		}
	case ast.KindIfStatement:
		ifStatement := statement.AsIfStatement()
		checkProofStatements(c, []*ast.Node{ifStatement.ThenStatement}, owner, role, false /*direct*/)
		if ifStatement.ElseStatement != nil {
			checkProofStatements(c, []*ast.Node{ifStatement.ElseStatement}, owner, role, false /*direct*/)
		}
	case ast.KindBlock:
		if !isProofBlock(statement) {
			checkProofStatements(c, statement.Statements(), owner, role, false /*direct*/)
		}
	default:
		report(c, statement, EK4305)
	}
}

// proofConst returns the declaration of statement when it is const x = E or
// const x: T = E, the one form of declaration a proof block holds.
func proofConst(statement *ast.Node) *ast.Node {
	if statement.Kind != ast.KindVariableStatement {
		return nil
	}
	list := statement.AsVariableStatement().DeclarationList
	if list.Flags&ast.NodeFlagsBlockScoped != ast.NodeFlagsConst {
		return nil
	}
	declarations := list.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 || !ast.IsIdentifier(declarations[0].Name()) || declarations[0].Initializer() == nil {
		return nil
	}
	return declarations[0]
}

// referencedLater reports whether a statement of later names declaration.
func referencedLater(c *checker.Checker, declaration *ast.Node, later []*ast.Node) bool {
	symbol := c.GetSymbolOfDeclaration(declaration)
	name := declaration.Name().Text()
	found := false
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) && n.Text() == name && c.GetSymbolAtLocation(n) == symbol {
			found = true
			return true
		}
		return n.ForEachChild(visit)
	}
	for _, statement := range later {
		if visit(statement) {
			break
		}
	}
	return found
}

// checkProofStatementPlace reports EK4306 for a proof statement outside its
// place (Appendix F "Proof blocks").
func checkProofStatementPlace(c *checker.Checker, statement *ast.Node, name string, role proofBlockRole, direct bool) {
	var home string
	switch name {
	case "assume", "ensures":
		if !direct || role != proofBlockFunction {
			home = "a function's leading proof block"
		}
	case "decreases":
		if !direct || role == proofBlockOther {
			home = "a function's or loop's leading proof block"
		}
	case "invariant":
		if !direct || role != proofBlockLoop {
			home = "a while, for or for … of loop's leading proof block"
		}
	}
	if home != "" {
		report(c, statement.Expression().Expression(), EK4306, name, home)
	}
}

// checkEnsures reports EK4309 for ensures in a function without a usable
// written return type, or with an argument other than (r) => Q.
func checkEnsures(c *checker.Checker, call *ast.Node, owner *ast.Node) {
	returnType := owner.Type()
	if returnType == nil || returnType.Kind == ast.KindVoidKeyword || returnType.Kind == ast.KindUndefinedKeyword {
		report(c, call.Expression(), EK4309)
		return
	}
	args := call.Arguments()
	if len(args) != 1 || !isPostconditionArrow(args[0]) {
		at := call.Expression()
		if len(args) > 0 {
			at = args[0]
		}
		report(c, at, EK4309)
	}
}

// isPostconditionArrow reports whether node is (r) => Q: an arrow with one
// untyped identifier parameter and an expression body.
func isPostconditionArrow(node *ast.Node) bool {
	if node.Kind != ast.KindArrowFunction || node.Flags&ast.NodeFlagsVibeLangEffect != 0 || node.Modifiers() != nil {
		return false
	}
	arrow := node.AsArrowFunction()
	if arrow.TypeParameters != nil || arrow.Type != nil || ast.IsBlock(arrow.Body) {
		return false
	}
	parameters := arrow.Parameters.Nodes
	if len(parameters) != 1 {
		return false
	}
	parameter := parameters[0].AsParameterDeclaration()
	return ast.IsIdentifier(parameter.Name()) && parameter.Type == nil && parameter.Initializer == nil && parameter.DotDotDotToken == nil && parameter.QuestionToken == nil
}

// checkProofBy reports EK4307 at each reference to by in block.
func checkProofBy(c *checker.Checker, block *ast.Node) {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) && n.Text() == "by" && isReferenceName(n) {
			report(c, n, EK4307)
		}
		if isProofBlock(n) && n != block {
			return false // checked as its own block
		}
		return n.ForEachChild(visit)
	}
	block.ForEachChild(visit)
}

// isReferenceName reports whether id names a binding, not a property.
func isReferenceName(id *ast.Node) bool {
	parent := id.Parent
	switch {
	case parent == nil:
		return false
	case ast.IsPropertyAccessExpression(parent) && parent.Name() == id:
		return false
	case (ast.IsPropertyAssignment(parent) || ast.IsMethodDeclaration(parent) || ast.IsPropertyDeclaration(parent) || ast.IsPropertySignatureDeclaration(parent)) && parent.Name() == id:
		return false
	}
	return true
}

// inProofUse reports whether node is in a proof block or a spec function,
// where a spec function may be used.
func inProofUse(node *ast.Node) bool {
	for n := node.Parent; n != nil; n = n.Parent {
		if isProofBlock(n) || isSpecFunction(n) {
			return true
		}
	}
	return false
}

// checkSpecReferences reports EK4310 at each reference to one of specs
// outside proof blocks and spec functions.
func checkSpecReferences(c *checker.Checker, file *ast.SourceFile, specs []*ast.Node) {
	symbols := map[*ast.Symbol]bool{}
	names := map[string]bool{}
	for _, fn := range specs {
		if symbol := c.GetSymbolOfDeclaration(fn); symbol != nil && fn.Name() != nil {
			symbols[symbol] = true
			names[fn.Name().Text()] = true
		}
	}
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) && names[n.Text()] && !isSpecFunction(n.Parent) && isReferenceName(n) && !inProofUse(n) {
			symbol := c.GetSymbolAtLocation(n)
			if n.Parent != nil && n.Parent.Kind == ast.KindExportSpecifier {
				symbol = c.GetExportSpecifierLocalTargetSymbol(n.Parent)
			}
			if symbol != nil && symbols[symbol] {
				report(c, n, EK4310, n.Text())
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkSpecTransparency reports EK4314 for each spec function that is not
// transparent (Appendix F "Transparent functions and procedures"): it has a
// loop, a let, an assignment, ++ or --, or a proof block that asserts, or it
// calls a checked function that is a procedure.
func checkSpecTransparency(c *checker.Checker, specs []*ast.Node) {
	t := newTransparency(c)
	for _, fn := range specs {
		if fn.Body() == nil {
			continue
		}
		// The first construct in source order; the rest usually go with it.
		if uses := t.opaqueUses(fn); len(uses) > 0 {
			report(c, uses[0].at, EK4314, uses[0].reason)
			continue
		}
		for _, call := range t.calls(fn) {
			if callee := t.callee(call); callee != nil && !t.transparent(callee) {
				report(c, call.Expression(), EK4314, "it calls "+callee.Name().Text()+", which is a procedure")
				break
			}
		}
	}
}

// transparency classifies checked functions as transparent or procedures.
// The transparent functions are the largest set of checked functions whose
// bodies have no opaque use and that call only transparent checked functions,
// besides other callees, so recursion is transparent.
type transparency struct {
	c      *checker.Checker
	result map[*ast.Node]bool
}

func newTransparency(c *checker.Checker) *transparency {
	return &transparency{c: c, result: map[*ast.Node]bool{}}
}

type opaqueUse struct {
	at     *ast.Node
	reason string
}

// opaqueUses returns the constructs of fn's body that make it a procedure.
func (t *transparency) opaqueUses(fn *ast.Node) []opaqueUse {
	var uses []opaqueUse
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case ast.IsIterationStatement(n, false /*lookInLabeledStatements*/):
			uses = append(uses, opaqueUse{n, "it has a loop"})
		case n.Kind == ast.KindVariableDeclarationList && n.Flags&ast.NodeFlagsConstant == 0:
			uses = append(uses, opaqueUse{n, "it declares a variable that can change"})
		case ast.IsBinaryExpression(n) && ast.IsAssignmentOperator(n.AsBinaryExpression().OperatorToken.Kind):
			uses = append(uses, opaqueUse{n, "it assigns"})
		case (ast.IsPrefixUnaryExpression(n) || ast.IsPostfixUnaryExpression(n)) && isProofUpdateExpression(n):
			uses = append(uses, opaqueUse{n, "it assigns"})
		case isProofBlock(n) && proofBlockAsserts(n):
			uses = append(uses, opaqueUse{n, "a proof block in it asserts"})
		}
		return n.ForEachChild(visit)
	}
	fn.Body().ForEachChild(visit)
	return uses
}

// isProofUpdateExpression reports whether n, a prefix or postfix unary expression, is ++ or --.
func isProofUpdateExpression(n *ast.Node) bool {
	var operator ast.Kind
	if ast.IsPrefixUnaryExpression(n) {
		operator = n.AsPrefixUnaryExpression().Operator
	} else {
		operator = n.AsPostfixUnaryExpression().Operator
	}
	return operator == ast.KindPlusPlusToken || operator == ast.KindMinusMinusToken
}

// proofBlockAsserts reports whether block holds an assert.
func proofBlockAsserts(block *ast.Node) bool {
	found := false
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if name, ok := isProofStatement(n); ok && name == "assert" {
			found = true
			return true
		}
		return n.ForEachChild(visit)
	}
	block.ForEachChild(visit)
	return found
}

// calls returns the calls in fn's body and proof blocks.
func (t *transparency) calls(fn *ast.Node) []*ast.Node {
	var calls []*ast.Node
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsCallExpression(n) && n.Flags&ast.NodeFlagsVibeLangProof == 0 {
			calls = append(calls, n)
		}
		return n.ForEachChild(visit)
	}
	fn.Body().ForEachChild(visit)
	return calls
}

// callee returns the checked function or spec function that call calls, or nil.
func (t *transparency) callee(call *ast.Node) *ast.Node {
	signature := t.c.GetResolvedSignature(call)
	if signature == nil || signature.Declaration() == nil {
		return nil
	}
	declaration := signature.Declaration()
	if isSpecFunction(declaration) && declaration.Body() != nil {
		return declaration
	}
	return checkedFunction(t.c, declaration)
}

// transparent reports whether fn, a checked function, is transparent.
func (t *transparency) transparent(fn *ast.Node) bool {
	if result, ok := t.result[fn]; ok {
		return result
	}
	// Collect the checked functions fn reaches, then remove each that has an
	// opaque use or calls a removed one until none changes: what remains is
	// the largest transparent set.
	reached := []*ast.Node{fn}
	edges := map[*ast.Node][]*ast.Node{}
	seen := map[*ast.Node]bool{fn: true}
	for i := 0; i < len(reached); i++ {
		for _, call := range t.calls(reached[i]) {
			if callee := t.callee(call); callee != nil {
				edges[reached[i]] = append(edges[reached[i]], callee)
				if _, known := t.result[callee]; !known && !seen[callee] {
					seen[callee] = true
					reached = append(reached, callee)
				}
			}
		}
	}
	candidate := map[*ast.Node]bool{}
	for _, g := range reached {
		candidate[g] = len(t.opaqueUses(g)) == 0
	}
	for changed := true; changed; {
		changed = false
		for _, g := range reached {
			if !candidate[g] {
				continue
			}
			for _, callee := range edges[g] {
				known, ok := t.result[callee]
				if ok && !known || !ok && !candidate[callee] {
					candidate[g] = false
					changed = true
					break
				}
			}
		}
	}
	for _, g := range reached {
		t.result[g] = candidate[g]
	}
	return t.result[fn]
}
