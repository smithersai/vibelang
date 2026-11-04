package vibelangmapper

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// CodeDataMethod asks for syntax or an annotation when D253 cannot dispatch safely.
const CodeDataMethod = 9006

// dataReceiver names a D152 receiver only when its annotation, initializer,
// lexical pipe topic, or a pinned declaration determines the module. Following
// bindings preserves shadows and never chooses a module from a method name.
func (p *projector) dataReceiver(expr *ast.Node, depth int) string {
	if expr == nil || depth > 24 {
		return ""
	}
	r, ok := p.forms.(*Resolver)
	if !ok {
		return ""
	}
	expr = ast.SkipParentheses(expr)
	if expr.Kind == ast.KindAsExpression || expr.Kind == ast.KindTypeAssertionExpression {
		return dataAccessTypeModule(r, expr.Type(), 0)
	}
	if expr.Kind == ast.KindStringLiteral || expr.Kind == ast.KindNoSubstitutionTemplateLiteral || expr.Kind == ast.KindTemplateExpression {
		return "lib/String"
	}
	if formsIsTopic(expr) {
		for child := expr; child.Parent != nil; child = child.Parent {
			if isPipeExpression(child.Parent) && child.Parent.AsBinaryExpression().Right == child {
				return p.dataReceiver(child.Parent.AsBinaryExpression().Left, depth+1)
			}
		}
		return ""
	}
	if ast.IsPropertyAccessExpression(expr) {
		if module := dataAccessTypeModule(r, p.dataReceiverType(expr, 0), 0); module != "" {
			return module
		}
	}
	if ast.IsIdentifier(expr) {
		d := r.binding(expr, expr.Text())
		if d != nil && d.Type() != nil {
			if module := dataAccessTypeModule(r, d.Type(), 0); module != "" {
				return module
			}
		}
		if d != nil && d.Kind == ast.KindVariableDeclaration && d.Type() == nil {
			return p.dataReceiver(d.Initializer(), depth+1)
		}
	}
	if ast.IsCallExpression(expr) {
		c := r.Callee(expr)
		if c.Canonical == "vibelang-runtime#fork" || c.Canonical == "vibelang-runtime#forkIn" {
			return "effect/Fiber"
		}
		if c.Kind == CalleeLocal && ast.IsIdentifier(expr.Expression()) {
			d := r.binding(expr.Expression(), expr.Expression().Text())
			if d != nil && isProducer(d) {
				return "effect/Stream"
			}
		}
		access := ast.SkipParentheses(expr.Expression())
		if ast.IsPropertyAccessExpression(access) {
			module := p.dataReceiver(access.Expression(), depth+1)
			if module != "" {
				if result := p.dataMethodResult(module, access.Name().Text(), expr.Arguments()); result != "" {
					return result
				}
			}
		}
	}
	return r.receiverModule(expr, 0)
}

// dataReceiverType follows written property shapes to their member types,
// allowing a receiver annotation to prove nested native and module members.
func (p *projector) dataReceiverType(expr *ast.Node, depth int) *ast.Node {
	if expr == nil || depth > 24 {
		return nil
	}
	r := p.forms.(*Resolver)
	expr = ast.SkipParentheses(expr)
	if expr.Kind == ast.KindAsExpression || expr.Kind == ast.KindTypeAssertionExpression {
		return expr.Type()
	}
	if ast.IsIdentifier(expr) {
		if d := r.binding(expr, expr.Text()); d != nil {
			if d.Type() != nil {
				return d.Type()
			}
			if ast.IsVariableDeclaration(d) {
				return p.dataReceiverType(d.Initializer(), depth+1)
			}
		}
		return nil
	}
	if ast.IsCallExpression(expr) && ast.IsIdentifier(expr.Expression()) {
		if d := r.binding(expr.Expression(), expr.Expression().Text()); d != nil {
			if ast.IsVariableDeclaration(d) && d.Initializer() != nil {
				d = ast.SkipParentheses(d.Initializer())
			}
			if ast.IsFunctionLike(d) && contractOf(d.Type()) == contractPlain {
				return d.Type() // a synchronous factory's written object shape (D265)
			}
		}
	}
	if ast.IsElementAccessExpression(expr) {
		return formsElementType(p.dataReceiverType(expr.Expression(), depth+1))
	}
	if ast.IsPropertyAccessExpression(expr) {
		if shape := r.typeLiteral(p.dataReceiverType(expr.Expression(), depth+1), 0); shape != nil {
			for _, member := range shape.Members() {
				if name, ok := formsPropertyName(member); ok && name == expr.Name().Text() {
					return member.Type()
				}
			}
		}
	}
	return nil
}

// dataMethod lowers proven D152 calls to module functions and delegates
// unproven receivers to the D252 rendering-specific dispatch. Neither needs
// prototypes at run time. The table's own-member entries take precedence over self-first
// functions, just as the fork's missing-property hook does.
func (p *projector) dataMethod(call *ast.Node, e env) bool {
	access := call.Expression()
	if !ast.IsPropertyAccessExpression(access) {
		return false
	}
	if ast.IsOptionalChain(access) || ast.IsOptionalChain(call) {
		p.checkDataMethodAccess(access)
		return false
	}
	module := p.dataReceiver(access.Expression(), 0)
	name := access.Name().Text()
	if module == "" {
		return p.dynamicDataMethod(call, e)
	}
	if !dataMethods[module][name] || dataOwnMembers[module][name] || !slices.Contains(dataMethodCandidates[name], strings.TrimPrefix(module, "effect/")) {
		return false
	}
	if call.TypeArgumentList() != nil {
		p.diagnostics = append(p.diagnostics, Diagnostic{Start: p.tokenStart(call), Length: call.End() - p.tokenStart(call), Code: CodeUnprojectedForm, Message: "Write this data-method call as an annotated module function call; explicit method type arguments cannot be transferred without an annotation."})
		return false
	}
	receiver := access.Expression()
	// A predicate stays a direct call: wrapping its boolean in $run would
	// discard TypeScript's narrowing of the original receiver.
	guard := dataGuards[module+"#"+name]
	start := p.tokenStart(call)
	if p.statementStarts[start] {
		p.plan.insert(start, ";")
		delete(p.statementStarts, start)
	}
	if e.effect && !guard {
		p.plan.mark(editRun, partOpen, start, start, "")
	}
	namespace := strings.TrimPrefix(module, "effect/")
	p.plan.insert(start, p.names.prelude(namespace)+"."+name+"(")
	p.visit(receiver, e)
	end := scanner.SkipTrivia(p.text, access.End()) + 1
	comma := ""
	if len(call.Arguments()) > 0 {
		comma = ", "
	}
	p.plan.replace(receiver.End(), end, comma)
	p.callArguments(call, e)
	if e.effect && !guard {
		p.plan.mark(editRun, partClose, call.End(), call.End(), "")
	}
	return true
}

// predicateCall preserves narrowing and contextual inference in pinned
// predicates and explicitly curried plain calls.
// Resolving its canonical import first excludes local functions with the
// same spelling, whose calls may return Effects instead of booleans.
func (p *projector) predicateCall(call *ast.Node, e env) bool {
	r, ok := p.forms.(*Resolver)
	if !ok {
		return false
	}
	key := r.Callee(call).Canonical
	plain := dataGuards[key] || p.plainArrayPipeStage(call, key) || p.plainMatchPipeStage(call, key)
	if !plain && dataLastMethods[key] {
		candidates := formsCandidates(r.table.Signatures(key), len(call.Arguments()))
		plain = len(candidates) > 0
		for _, sig := range candidates {
			if sig.Self || sig.Result == "effect/Effect" {
				plain = false
			}
		}
	}
	if !plain {
		return false
	}
	p.callee(call, e)
	p.callArguments(call, e)
	return true
}

// dataMethodResult retains return-module metadata while removing self from
// arity, and follows pipe only through declarations explicitly curried on self.
func (p *projector) dataMethodResult(module, name string, args []*ast.Node) string {
	r := p.forms.(*Resolver)
	if name == "pipe" {
		result := module
		for _, arg := range args {
			if !ast.IsCallExpression(arg) {
				return ""
			}
			key := r.Callee(arg).Canonical
			home, member, ok := strings.Cut(key, "#")
			if !ok || !dataLastMethods[key] {
				return ""
			}
			result = p.dataMethodResult(home, member, arg.Arguments())
			if result == "" {
				return ""
			}
		}
		return result
	}
	result := ""
	for _, m := range r.table.methodReceivers(name) {
		if m.receiver != module {
			continue
		}
		for _, sig := range m.sigs {
			argc := len(args)
			if m.self {
				argc++
			}
			if !sig.Accepts(argc) {
				continue
			}
			next := sig.Result
			if next == "effect/Effect" {
				next = sig.Runs
			}
			if next == "" || result != "" && next != result {
				return ""
			}
			result = next
		}
	}
	return result
}

// dynamicDataMethod preserves receiver typing and guards while dispatching an
// unproven D152 receiver at execution, without guessing its declaring module.
func (p *projector) dynamicDataMethod(call *ast.Node, e env) bool {
	access := call.Expression()
	name := access.Name().Text()
	modules := dataMethodCandidates[name]
	if len(modules) == 0 {
		return false
	}
	if r, ok := p.forms.(*Resolver); ok && r.Callee(call).Canonical != "" {
		return false
	}
	if p.nativeDataMember(access.Expression(), name, true, 0) {
		return false
	}
	if dataMethodAmbiguous[name] {
		p.dataMethodDiagnostic(access, "D253 cannot select a module for this unproven data method: its candidate TypeIds can coexist.")
		return false
	}
	guard := false
	for _, module := range modules {
		guard = guard || dataGuards["effect/"+module+"#"+name]
	}
	receiver := access.Expression()
	service := e.effect && p.mayBeServiceKey(receiver) && !p.keyOwnedMember(access)
	if call.TypeArgumentList() != nil {
		p.diagnostics = append(p.diagnostics, Diagnostic{Start: p.tokenStart(call), Length: call.End() - p.tokenStart(call), Code: CodeUnprojectedForm, Message: "Write this data-method call as an annotated module function call; explicit method type arguments cannot be transferred without an annotation."})
		return false
	}
	start := p.tokenStart(call)
	if p.statementStarts[start] {
		p.plan.insert(start, ";")
		delete(p.statementStarts, start)
	}

	witnessEdit := -1
	if guard && e.effect {
		// A generated predicate witness narrows in both branches. Its result
		// argument keeps the real call's value and Effect channels.
		witnessEdit = len(p.plan.edits)
		p.plan.witness(start, "")
	}
	if e.effect {
		p.plan.mark(editRun, partOpen, start, start, "")
	}
	fragmentStart := len(p.plan.edits)
	prefixIndex := len(p.plan.edits)
	p.plan.edits = append(p.plan.edits, edit{pos: start, end: start, kind: editDataMethod, arg: helperRef("$method") + "("})
	if service {
		p.plan.mark(editServiceCall, partOpen, p.tokenStart(receiver), p.tokenStart(receiver), "")
	}
	p.visit(receiver, e)
	if service {
		p.plan.mark(editServiceCall, partClose, receiver.End(), receiver.End(), "")
	}
	end := scanner.SkipTrivia(p.text, access.End()) + 1
	if blockArgument(call) != nil && p.text[end-1] != '(' {
		// A bare block has no source opening parenthesis. Leave its brace
		// for blockCall, which supplies the checking call's parentheses.
		end = access.End()
	}
	middleIndex := len(p.plan.edits)
	p.plan.edits = append(p.plan.edits, edit{pos: receiver.End(), end: end, kind: editDataMethod, text: p.text[receiver.End():end], arg: ", " + strconv.Quote(name) + ", ["})
	before := len(p.plan.edits)
	openingIndex := -1
	if p.callArguments(call, e) {
		// blockCall supplies the synthetic closing parenthesis. Change that
		// edit, rather than replacing the block's closing source brace.
		returned := false
		for i := before; i < len(p.plan.edits); i++ {
			edit := &p.plan.edits[i]
			if edit.kind == editSyntax && edit.text == "(" && edit.pos == edit.end && edit.end == p.tokenStart(blockArgument(call).Body()) {
				// Execution already opened the dispatch argument array.
				edit.kind, edit.arg = editDataMethod, ""
				openingIndex = i
			}
			if edit.kind == editSyntax && edit.text == ")(" && edit.end == p.tokenStart(blockArgument(call).Body()) {
				edit.kind, edit.arg = editDataMethod, "])("
				edit.fields = []string{name}
				returned = true
			}
		}
		if !returned {
			last := &p.plan.edits[len(p.plan.edits)-1]
			last.kind, last.arg = editDataMethod, "])"
			last.fields = []string{name}
		}
	} else {
		p.plan.edits = append(p.plan.edits, edit{pos: call.End() - 1, end: call.End(), kind: editDataMethod, text: ")", arg: "])", fields: []string{name}})
	}
	fragmentEnd := len(p.plan.edits)
	if e.effect {
		p.plan.mark(editRun, partClose, call.End(), call.End(), "")
	}

	if witnessEdit >= 0 {
		edits := append([]edit(nil), p.plan.edits[fragmentStart:fragmentEnd]...)
		// Render only the outer method as the witness helper. Nested receiver
		// and argument edits keep their checking forms, including their runs.
		outer := []int{prefixIndex, middleIndex, fragmentEnd - 1}
		if openingIndex >= 0 {
			outer = append(outer, openingIndex)
		}
		for _, index := range outer {
			ed := &edits[index-fragmentStart]
			ed.kind, ed.text = editSyntax, ed.arg
		}
		edits[prefixIndex-fragmentStart].text = helperRef("$dataGuard") + "("
		witness, ok := p.checkingFragment(call, edits)
		if !ok {
			p.unprojected(call)
		} else {
			p.plan.edits[witnessEdit].text = strings.TrimSuffix(witness, ")") + ", "
			p.plan.witness(call.End(), ")")
		}
	}

	return true
}

// dataMethodDiagnostic reports each unsafe access once, even when a call's
// callee and the expression walk both visit an optional chain.
func (p *projector) dataMethodDiagnostic(access *ast.Node, message string) {
	message += p.dataMethodGuidance(access)
	start := p.tokenStart(access)
	for _, d := range p.diagnostics {
		if d.Code == CodeDataMethod && d.Start == start {
			return
		}
	}
	p.diagnostics = append(p.diagnostics, Diagnostic{Start: start, Length: access.End() - start, Code: CodeDataMethod, Message: message})
}

// dataMethodGuidance names the actual receiver and every candidate function,
// so a text-only refusal gives the author a concrete next edit without guessing.
func (p *projector) dataMethodGuidance(access *ast.Node) string {
	name := access.Name().Text()
	receiver := ast.SkipParentheses(access.Expression())
	binding := "value"
	value := p.text[p.tokenStart(receiver):receiver.End()]
	var properties []string
	root := receiver
	for ast.IsPropertyAccessExpression(root) {
		properties = append(properties, root.Name().Text())
		root = ast.SkipParentheses(root.Expression())
	}
	if ast.IsIdentifier(root) {
		binding = root.Text()
	}
	if ast.IsIdentifier(receiver) {
		binding = receiver.Text()
	}
	call := access.Parent
	if call == nil || !ast.IsCallExpression(call) || call.Expression() != access {
		typ := "{ " + name + ": unknown }"
		for _, property := range properties {
			typ = "{ " + property + ": " + typ + " }"
		}
		return " Annotate the receiver binding with its native field type, for example `const " + binding + ": " + typ + " = …`."
	}
	modules := append([]string(nil), dataMethodCandidates[name]...)
	if name == "map" {
		modules = append([]string{"Array"}, modules...)
	}
	types := make([]string, 0, len(modules))
	calls := make([]string, 0, len(modules))
	for _, module := range modules {
		typ := module + "." + module + "<…>"
		if module == "Array" {
			typ = "Todo[]"
		}
		for _, property := range properties {
			typ = "{ " + property + ": " + typ + " }"
		}
		types = append(types, "`const "+binding+": "+typ+" = …`")
		calls = append(calls, "`"+module+"."+name+"("+value+", ...)`")
	}
	return " Annotate the receiver binding with a type annotation, for example " + strings.Join(types, " or ") + ", or call the module function explicitly: " + strings.Join(calls, ", ") + "."
}

// checkDataMethodAccess keeps augmentation from admitting optional or uncalled
// D152 methods, including receivers whose data module the text cannot prove.
func (p *projector) checkDataMethodAccess(access *ast.Node) {
	if !ast.IsPropertyAccessExpression(access) || p.isModuleMember(access) {
		return
	}
	receiver := ast.SkipParentheses(access.Expression())
	if ast.IsIdentifier(receiver) && (builtinGlobals[receiver.Text()] || javaScriptGlobals[receiver.Text()]) && !p.names.declared[receiver.Text()] {
		return
	}
	call := access.Parent
	called := call != nil && ast.IsCallExpression(call) && call.Expression() == access
	optional := ast.IsOptionalChain(access) || called && ast.IsOptionalChain(call)
	if called && !optional {
		return
	}
	name := access.Name().Text()
	if len(dataMethodCandidates[name]) == 0 {
		return
	}
	if p.nativeDataMember(receiver, name, false, 0) {
		return
	}
	module := p.dataReceiver(receiver, 0)
	if module == "" {
		if r, ok := p.forms.(*Resolver); ok && ast.IsIdentifier(receiver) {
			if d := r.binding(receiver, receiver.Text()); d != nil {
				module = dataAccessTypeModule(r, d.Type(), 0)
			}
		}
	}
	if module != "" && (!dataMethods[module][name] || dataOwnMembers[module][name]) {
		return
	}
	message := "D253 data methods require a direct call without optional chaining or uncalled access."
	if !called {
		message = "The mapper cannot decide whether this is a native field or an uncalled data method."
	}
	p.dataMethodDiagnostic(access, message)
}

// dataAccessTypeModule follows nullable written types and aliases, so native
// optional members keep their JavaScript meaning while data methods reject them.
func dataAccessTypeModule(r *Resolver, t *ast.Node, depth int) string {
	if t == nil || depth > 24 {
		return ""
	}
	if module := r.typeModuleOf(t); module != "" {
		return module
	}
	t = formsUnwrapType(t)
	if t != nil && t.Kind == ast.KindImportType {
		imp := t.AsImportTypeNode()
		if !imp.IsTypeOf && imp.Argument.Kind == ast.KindLiteralType && imp.Qualifier != nil && ast.IsIdentifier(imp.Qualifier) {
			literal := imp.Argument.AsLiteralTypeNode().Literal
			if ast.IsStringLiteral(literal) {
				module := literal.Text()
				if strings.HasPrefix(module, "effect/") && strings.TrimPrefix(module, "effect/") == imp.Qualifier.Text() && dataMethods[module] != nil {
					return module
				}
			}
		}
	}
	if t != nil {
		switch t.Kind {
		case ast.KindStringKeyword:
			return "lib/String"
		case ast.KindNumberKeyword:
			return "lib/Number"
		case ast.KindBooleanKeyword:
			return "lib/Boolean"
		}
	}
	if t == nil {
		return ""
	}
	if t.Kind == ast.KindUnionType {
		module := ""
		for _, member := range t.AsUnionTypeNode().Types.Nodes {
			if member.Kind == ast.KindUndefinedKeyword || member.Kind == ast.KindNullKeyword || member.Kind == ast.KindLiteralType && member.AsLiteralTypeNode().Literal.Kind == ast.KindNullKeyword {
				continue
			}
			next := dataAccessTypeModule(r, member, depth+1)
			if next == "" || module != "" && next != module {
				return ""
			}
			module = next
		}
		return module
	}
	if t.Kind == ast.KindTypeReference {
		name := t.AsTypeReferenceNode().TypeName
		if ast.IsIdentifier(name) {
			c := r.calleeOf(name, nil, 0)
			module, export, ok := strings.Cut(c.Canonical, "#")
			if ok && dataMethods[module] != nil && strings.TrimPrefix(module, "effect/") == export {
				return module
			}
			if r.binding(name, name.Text()) == nil && dataMethods["effect/"+name.Text()] != nil {
				return "effect/" + name.Text()
			}
		}
		if d := r.localType(t); d != nil && d.Kind == ast.KindTypeAliasDeclaration {
			return dataAccessTypeModule(r, d.Type(), depth+1)
		}
	}
	return ""
}

// nativeDataMember accepts field access on a written native receiver type,
// and proves callable members only from a written local shape or literal.
// This preserves ordinary fields and callable members without attributing them
// to a data module merely because their names also occur in the D152 table.
func (p *projector) nativeDataMember(receiver *ast.Node, name string, callable bool, depth int) bool {
	if receiver == nil || depth > 24 {
		return false
	}
	r, ok := p.forms.(*Resolver)
	if !ok {
		return false
	}
	receiver = ast.SkipParentheses(receiver)
	if !callable && p.nativeDataAnnotation(receiver, 0) {
		return true
	}
	var shape *ast.Node
	switch {
	case formsIsTopic(receiver):
		for child := receiver; child.Parent != nil; child = child.Parent {
			if isPipeExpression(child.Parent) && child.Parent.AsBinaryExpression().Right == child {
				return p.nativeDataMember(child.Parent.AsBinaryExpression().Left, name, callable, depth+1)
			}
		}
	case receiver.Kind == ast.KindObjectLiteralExpression:
		shape = receiver
	case receiver.Kind == ast.KindAsExpression || receiver.Kind == ast.KindTypeAssertionExpression:
		shape = r.typeLiteral(receiver.Type(), 0)
	case ast.IsIdentifier(receiver):
		if d := r.binding(receiver, receiver.Text()); d != nil {
			if d.Type() != nil {
				shape = r.typeLiteral(d.Type(), 0)
			} else if d.Kind == ast.KindVariableDeclaration {
				return p.nativeDataMember(d.Initializer(), name, callable, depth+1)
			}
		}
	}
	if shape == nil {
		return false
	}
	var members []*ast.Node
	if shape.Kind == ast.KindObjectLiteralExpression {
		members = shape.Properties()
	} else {
		members = shape.Members()
	}
	for _, member := range members {
		if own, ok := formsPropertyName(member); !ok || own != name {
			continue
		}
		if !callable {
			return true
		}
		if member.Kind == ast.KindMethodDeclaration || member.Kind == ast.KindMethodSignature {
			return true
		}
		if t := formsUnwrapType(member.Type()); t != nil && t.Kind == ast.KindFunctionType {
			return true
		}
		if init := member.Initializer(); init != nil && (ast.IsArrowFunction(init) || ast.IsFunctionExpression(init)) {
			return true
		}
	}
	return false
}

// nativeDataAnnotation follows a receiver's written native type, including
// imported names and array elements, without inferring a module from a field.
func (p *projector) nativeDataAnnotation(receiver *ast.Node, depth int) bool {
	if receiver == nil || depth > 24 {
		return false
	}
	r := p.forms.(*Resolver)
	receiver = ast.SkipParentheses(receiver)
	if typ := p.dataReceiverType(receiver, 0); typ != nil {
		return nativeDataType(r, typ, 0)
	}
	switch receiver.Kind {
	case ast.KindIdentifier:
		if d := r.binding(receiver, receiver.Text()); d != nil && d.Kind == ast.KindVariableDeclaration {
			return p.nativeDataAnnotation(d.Initializer(), depth+1)
		}
	case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindNonNullExpression:
		return p.nativeDataAnnotation(receiver.Expression(), depth+1)
	}
	return false
}

// nativeDataType treats a written non-Effect type as the author's native
// boundary; any, unknown and known data modules cannot hide unsafe dispatch.
func nativeDataType(r *Resolver, typ *ast.Node, depth int) bool {
	if typ == nil || depth > 24 {
		return false
	}
	if module := dataAccessTypeModule(r, typ, 0); module != "" {
		return strings.HasPrefix(module, "lib/")
	}
	typ = formsUnwrapType(typ)
	if typ == nil {
		return false
	}
	switch typ.Kind {
	case ast.KindTypeReference:
		if d := r.localType(typ); d != nil && d.Kind == ast.KindTypeAliasDeclaration {
			return nativeDataType(r, d.Type(), depth+1)
		}
		return true
	case ast.KindTypeLiteral, ast.KindArrayType, ast.KindTupleType, ast.KindLiteralType:
		return true
	case ast.KindImportType:
		imp := typ.AsImportTypeNode()
		return !imp.IsTypeOf && imp.Argument.Kind == ast.KindLiteralType && !strings.HasPrefix(imp.Argument.AsLiteralTypeNode().Literal.Text(), "effect/")
	case ast.KindUnionType, ast.KindIntersectionType:
		found := false
		var members []*ast.Node
		if typ.Kind == ast.KindUnionType {
			members = typ.AsUnionTypeNode().Types.Nodes
		} else {
			members = typ.AsIntersectionTypeNode().Types.Nodes
		}
		for _, member := range members {
			if member.Kind == ast.KindUndefinedKeyword || member.Kind == ast.KindNullKeyword || member.Kind == ast.KindLiteralType && member.AsLiteralTypeNode().Literal.Kind == ast.KindNullKeyword {
				continue
			}
			if !nativeDataType(r, member, depth+1) {
				return false
			}
			found = true
		}
		return found
	}
	return false
}
