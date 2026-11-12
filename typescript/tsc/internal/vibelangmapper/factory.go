package vibelangmapper

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// The lexical value binding lookup excludes type aliases. Resolve a local
// non-generic alias separately, as the Registry-shaped Made contract needs.
func (r *Resolver) factoryEffectType(t *ast.Node, depth int) *ast.Node {
	t = formsUnwrapType(t)
	if t == nil || depth > 5 {
		return nil
	}
	if r.isEffectTypeNode(t, 0) {
		return t
	}
	if t.Kind == ast.KindTypeReference {
		if alias := r.localType(t); alias != nil && alias.Kind == ast.KindTypeAliasDeclaration {
			return r.factoryEffectType(alias.Type(), depth+1)
		}
	}
	return nil
}

// A returned function is data in A, not a callback parameter to which D12
// adds channels. Only its written Effect return asks for an Effect function.
func (r *Resolver) factorySuccessClass(t *ast.Node, depth int) Class {
	t = formsUnwrapType(t)
	if t == nil || depth > 5 {
		return 0
	}
	if r.factoryEffectType(t, 0) != nil {
		return ClassProgram
	}
	switch t.Kind {
	case ast.KindFunctionType:
		ret := formsUnwrapType(t.Type())
		if r.factoryEffectType(ret, 0) != nil {
			return ClassEffectFn
		}
		if ret != nil && ret.Kind == ast.KindUnionType {
			for _, part := range ret.AsUnionTypeNode().Types.Nodes {
				if r.factoryEffectType(part, 0) != nil {
					return ClassPlainFn | ClassEffectFn
				}
			}
		}
		return ClassPlainFn
	case ast.KindUnionType:
		var cls Class
		for _, part := range t.AsUnionTypeNode().Types.Nodes {
			cls |= r.factorySuccessClass(part, depth+1)
		}
		return cls
	case ast.KindTypeReference:
		if alias := r.localType(t); alias != nil && alias.Kind == ast.KindTypeAliasDeclaration {
			return r.factorySuccessClass(alias.Type(), depth+1)
		}
	}
	return 0
}

// factoryReturn reads a written Effect return without instantiating a call's
// generic success parameter. Text cannot infer a factory from a bare U (D44).
func (r *Resolver) factoryReturn(fn *ast.Node) *ast.Node {
	if fn == nil || fn.Body() == nil {
		return nil
	}
	if _, island := r.inHatch(fn); island {
		return nil
	}
	if t := fn.Type(); t != nil {
		return r.factoryEffectType(t, 0)
	}
	node := fn
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	if p := node.Parent; p != nil && ast.IsVariableDeclaration(p) && p.Type() != nil {
		t := formsUnwrapType(p.Type())
		if t != nil && t.Kind == ast.KindFunctionType {
			return r.factoryEffectType(t.Type(), 0)
		}
		return nil // an Effect-typed binding is a program, not a factory
	}
	if call, arg, steps := formsOwnerCall(fn); call != nil && len(steps) == 0 && ast.IsIdentifier(call.Expression()) {
		callee := r.binding(call.Expression(), call.Expression().Text())
		if callee != nil && ast.IsVariableDeclaration(callee) {
			callee = callee.Initializer()
		}
		if callee != nil && ast.IsFunctionLike(callee) && arg < len(callee.Parameters()) {
			t := formsUnwrapType(callee.Parameters()[arg].Type())
			if t != nil && t.Kind == ast.KindFunctionType && r.factoryEffectType(t.Type(), 0) != nil {
				ret := r.factoryEffectType(t.Type(), 0)
				success := r.effectSuccess(ret, 0)
				generic := factoryUsesTypeParameter(success, callee.TypeParameters())
				if !generic {
					return ret
				}
			}
		}
	}
	member, obj := fn, fn.Parent
	if obj != nil && ast.IsPropertyAssignment(obj) {
		member, obj = obj, obj.Parent
	}
	if obj != nil && ast.IsObjectLiteralExpression(obj) {
		name, ok := formsPropertyName(member)
		if ok {
			if shape := r.typeLiteral(r.writtenTypeOf(obj), 0); shape != nil {
				if m := formsShapeMember(shape, name); m != nil {
					t := m.Type()
					if t != nil && t.Kind == ast.KindFunctionType {
						t = t.Type()
					}
					if effect := r.factoryEffectType(t, 0); effect != nil {
						return effect
					}
				}
			}
		}
	}
	return nil
}

func (r *Resolver) effectSuccess(t *ast.Node, depth int) *ast.Node {
	if t == nil || depth > 5 {
		return nil
	}
	t = formsUnwrapType(t)
	if t == nil || t.Kind != ast.KindTypeReference {
		return nil
	}
	if len(t.TypeArguments()) > 0 {
		return formsUnwrapType(t.TypeArguments()[0])
	}
	if t.Kind == ast.KindTypeReference && ast.IsIdentifier(t.AsTypeReferenceNode().TypeName) {
		if d := r.localType(t); d != nil && d.Kind == ast.KindTypeAliasDeclaration {
			return r.effectSuccess(d.Type(), depth+1)
		}
	}
	return nil
}

func factoryReturnExpressions(fn *ast.Node, cb func(*ast.Node)) {
	if !ast.IsBlock(fn.Body()) {
		cb(fn.Body())
		return
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if formsBoundary(n) {
			return false
		}
		if n.Kind == ast.KindReturnStatement {
			cb(n.Expression())
			return false
		}
		return n.ForEachChild(visit)
	}
	visit(fn.Body())
}

func (r *Resolver) factoryProgram(expr, success *ast.Node) bool {
	if expr == nil || success == nil {
		return false
	}
	expr = ast.SkipParentheses(expr)
	if isLambda(expr) && len(expr.Parameters()) == 0 {
		if r.factoryEffectType(success, 0) != nil || r.acceptsFunctionValue(success, 0) {
			return false
		}
		return true
	}
	if ast.IsIdentifier(expr) {
		// As in the checker's factoryProgram, an unannotated local call
		// binds its success, including a recursive call. Only a written
		// Effect binding identifies a held program here (D269, engine-store).
		if d := r.binding(expr, expr.Text()); d != nil && r.factoryEffectType(d.Type(), 0) != nil {
			// Effect<Effect<…>> deliberately returns its program as data (S7-3).
			return r.factoryEffectType(success, 0) == nil
		}
	}
	return false
}

func (r *Resolver) isFactory(fn *ast.Node) bool {
	ret := r.factoryReturn(fn)
	if ret == nil {
		return false
	}
	success := r.effectSuccess(ret, 0)
	found := false
	factoryReturnExpressions(fn, func(expr *ast.Node) { found = found || r.factoryProgram(expr, success) })
	return found
}

func factoryReturnOwner(expr *ast.Node) *ast.Node {
	node := expr
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	p := node.Parent
	if p != nil && p.Kind == ast.KindReturnStatement {
		return ast.GetContainingFunction(p)
	}
	if p != nil && ast.IsFunctionLike(p) && p.Body() == node {
		return p
	}
	return nil
}

// A factory keeps its declared function type and its synchronous JavaScript
// body; returned literals alone take D7's program form.
func (p *projector) factory(fn *ast.Node) {
	p.checkFactoryBody(fn)
	if contractOf(fn.Type()) != contractInfer {
		p.visitChildren(fn, env{})
		return
	}
	// Keep A pinned while TypeScript infers E/R from the returned programs.
	// The witnesses disappear in execution; the call-time body stays plain.
	slots, ok := p.factoryContractSlots(fn.Type())
	if !ok {
		p.unprojected(fn.Type())
		return
	}
	p.plan.replace(p.colonBefore(fn.Type()), fn.Type().End(), "")
	var returns []*ast.Node
	factoryReturnExpressions(fn, func(expr *ast.Node) {
		if expr != nil {
			returns = append(returns, expr)
			p.plan.witness(p.tokenStart(expr), helperRef("$contract")+"<"+slots+">()(")
		}
	})
	fn.ForEachChild(func(child *ast.Node) bool {
		if child != fn.Type() {
			p.visit(child, env{})
		}
		return false
	})
	for _, expr := range returns {
		p.plan.witness(expr.End(), ")")
	}
}

func (p *projector) factoryContractSlots(annotation *ast.Node) (string, bool) {
	previous := p.plan
	p.plan = plan{}
	p.effectType(annotation, true)
	slots := p.plan
	p.plan = previous
	start := p.tokenStart(annotation)
	for i := range slots.edits {
		slots.edits[i].pos -= start
		slots.edits[i].end -= start
	}
	text, _, _, ok := slots.render(checking{names: p.names}, p.text[start:annotation.End()], func() string { return "" })
	return text, ok
}

func (p *projector) checkFactoryBody(fn *ast.Node) {
	r := p.forms.(*Resolver)
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if formsBoundary(n) {
			return false
		}
		if d := r.Argument(n); d.ByName {
			return false
		}
		if ast.IsCallExpression(n) && p.plainContractEffectCall(n) {
			p.diagnostics = append(p.diagnostics, Diagnostic{Start: p.tokenStart(n), Length: n.End() - p.tokenStart(n), Code: 2115, Message: "This function returns a program, so its body runs when called and cannot run an Effect. Move it into return () => { … }."})
			return false
		}
		return n.ForEachChild(visit)
	}
	visit(fn.Body())
	// The checking rendering keeps the whole written Effect return type, so
	// TypeScript checks each returned value and every implicit return path.
}

// D248: a member typed by an imported interface may be a D269 factory.
// Its success type is outside this file, so never silently choose a phase.
func (r *Resolver) factoryContextHidden(fn *ast.Node) bool {
	if _, island := r.inHatch(fn); island {
		return false
	}
	if fn.Type() != nil {
		return false
	}
	obj := fn.Parent
	if obj != nil && ast.IsPropertyAssignment(obj) {
		obj = obj.Parent
	}
	if obj == nil || !ast.IsObjectLiteralExpression(obj) {
		return false
	}
	written := formsUnwrapType(r.writtenTypeOf(obj))
	if written == nil || written.Kind != ast.KindTypeReference {
		return false
	}
	name := written.AsTypeReferenceNode().TypeName
	if !ast.IsIdentifier(name) {
		return false
	}
	decl := r.binding(name, name.Text())
	if decl == nil || decl.Kind != ast.KindImportSpecifier {
		return false
	}
	candidate := false
	factoryReturnExpressions(fn, func(expr *ast.Node) {
		if expr == nil {
			return
		}
		expr = ast.SkipParentheses(expr)
		if isLambda(expr) && len(expr.Parameters()) == 0 {
			candidate = true
		}
		if ast.IsIdentifier(expr) {
			if d := r.binding(expr, expr.Text()); d != nil && r.factoryEffectType(d.Type(), 0) != nil {
				candidate = true
			}
		}
	})
	return candidate
}

// These written success types already accept function values. D269 must not
// reinterpret them as factories, including through a union or a local alias.
func (r *Resolver) acceptsFunctionValue(t *ast.Node, depth int) bool {
	t = formsUnwrapType(t)
	if t == nil || depth > 8 {
		return false
	}
	switch t.Kind {
	case ast.KindAnyKeyword, ast.KindUnknownKeyword, ast.KindObjectKeyword, ast.KindFunctionType:
		return true
	case ast.KindUnionType:
		for _, part := range t.AsUnionTypeNode().Types.Nodes {
			if r.acceptsFunctionValue(part, depth+1) {
				return true
			}
		}
	case ast.KindTypeLiteral, ast.KindInterfaceDeclaration:
		for _, member := range t.Members() {
			if member.QuestionToken() != nil || member.Kind == ast.KindCallSignature {
				continue
			}
			name, ok := formsPropertyName(member)
			if !ok {
				return false
			}
			switch name {
			case "length", "name", "apply", "call", "bind", "prototype", "arguments", "caller", "toString":
			default:
				return false
			}
		}
		return true
	case ast.KindTypeReference:
		if ast.IsIdentifier(t.AsTypeReferenceNode().TypeName) {
			name := t.AsTypeReferenceNode().TypeName
			d := r.localType(t)
			if d == nil {
				d = r.binding(name, name.Text())
			}
			if d != nil {
				if d.Kind == ast.KindTypeAliasDeclaration {
					return r.acceptsFunctionValue(d.Type(), depth+1)
				}
				if d.Kind == ast.KindInterfaceDeclaration {
					return r.acceptsFunctionValue(d, depth+1)
				}
				// Keep the prior value interpretation when a success type
				// is opaque here. The written Effect contract still rejects
				// a new factory return that only the checker can identify.
				if d.Kind == ast.KindImportSpecifier {
					return true
				}
			}
		}
	}
	return false
}

func factoryUsesTypeParameter(t *ast.Node, parameters []*ast.Node) bool {
	if t == nil || len(parameters) == 0 {
		return false
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.Kind == ast.KindTypeReference && ast.IsIdentifier(n.AsTypeReferenceNode().TypeName) {
			for _, parameter := range parameters {
				if n.AsTypeReferenceNode().TypeName.Text() == parameter.Name().Text() {
					return true
				}
			}
		}
		return n.ForEachChild(visit)
	}
	return visit(t)
}

// A factory has no D9 plain variant even though its eager phase is JavaScript.
func (p *projector) rejectFactoryCallback(node *ast.Node, d Decision) {
	if d.Class&ClassPlainFn == 0 || d.Class&ClassEffectFn != 0 {
		return
	}
	r := p.forms.(*Resolver)
	fn := node
	if ast.IsIdentifier(node) {
		fn = r.binding(node, node.Text())
		if fn != nil && ast.IsVariableDeclaration(fn) {
			fn = fn.Initializer()
		}
	}
	if r.isFactory(fn) {
		p.diagnostics = append(p.diagnostics, Diagnostic{Start: p.tokenStart(node), Length: node.End() - p.tokenStart(node), Code: 4301, Message: "This factory returns a program, but this position expects a plain function, which returns a value."})
	}
}
