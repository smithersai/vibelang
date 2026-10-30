package vibelang

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// servicePlan records what the lowering does with services in one file.
type servicePlan struct {
	lookups    map[*ast.Node]bool   // calls S.member(…) whose callee looks the service up
	values     map[*ast.Node]bool   // calls p() that run p, an Effect value
	moduleKeys map[*ast.Node]string // the S or p of those calls that name a module, and the key it names (D311)
	aliases    map[*ast.Node]string // property accesses M.member read through M's export, and the export's name (D311)
	keys       map[*ast.Node]string // service and control classes, by declaration, and their keys
	wireOrders map[*ast.Node][]int  // wire calls whose arguments the lowering reorders

	// wireLists holds the wire calls of wireOrders whose spread arguments
	// list their layers, and those layers (wireArguments).
	wireLists map[*ast.Node][]wireArgument
}

func newServicePlan() servicePlan {
	return servicePlan{lookups: map[*ast.Node]bool{}, values: map[*ast.Node]bool{}, moduleKeys: map[*ast.Node]string{}, aliases: map[*ast.Node]string{}, keys: map[*ast.Node]string{}, wireOrders: map[*ast.Node][]int{}, wireLists: map[*ast.Node][]wireArgument{}}
}

// planServiceCall records how call, in the body of a function the lowering
// turns into an Effect, uses services.
func (p *servicePlan) planServiceCall(c *checker.Checker, call *ast.Node) {
	if isServiceLookup(c, call) {
		p.lookups[call] = true
		p.planModuleKey(c, call.Expression().Expression())
	}
	if isEffectValueCall(c, call) {
		p.values[call] = true
		p.planModuleKey(c, call.Expression())
	}
}

// planModuleKey records the key that expression, the S of S.member(…) or the
// p of p(), names when it names a module (D311), so the lowering writes the
// key: FileSystem.FileSystem.
func (p *servicePlan) planModuleKey(c *checker.Checker, expression *ast.Node) {
	if name := moduleServiceKeyName(c, expression); name != "" {
		p.moduleKeys[expression] = name
	}
}

// moduleKey returns receiver, the lowered S or p of a service call, followed
// by the key that its source, expression, names as a module (D311).
func (tx *lowering) moduleKey(expression *ast.Node, receiver *ast.Node) *ast.Node {
	name, ok := tx.plan.moduleKeys[expression]
	if !ok {
		return receiver
	}
	key := tx.Factory().NewPropertyAccessExpression(receiver, nil /*questionDotToken*/, tx.Factory().NewIdentifier(name), ast.NodeFlagsNone)
	tx.EmitContext().SetOriginal(key, expression)
	return key
}

// hasKey reports whether node declares a service or a control operation. Its
// key may be "", which a body writes as static readonly key = "" (VIP-9).
func (p *servicePlan) hasKey(node *ast.Node) bool {
	_, ok := p.keys[node]
	return ok
}

// planServiceNode records the key of node when it declares a service or a
// control operation, and the order of its arguments when it calls wire.
func (p *servicePlan) planServiceNode(c *checker.Checker, node *ast.Node) {
	if classKindOf(node) != ordinaryClass {
		p.keys[node] = servicesFor(c).key(node)
	}
	if name := moduleServiceStateOf(c).accesses[node]; name != "" {
		p.aliases[node] = name
	}
	if ast.IsCallExpression(node) {
		p.planWire(c, node)
	}
}

// looksUp reports whether node, a property access, is the callee of a call
// that looks a service up.
func (p *servicePlan) looksUp(node *ast.Node) bool {
	return node.Parent != nil && p.lookups[node.Parent] && node.Parent.Expression() == node
}

// addServiceLookup adds the service that call looks up to info's
// requirements.
func (a *analyzer) addServiceLookup(info *effectInfo, call *ast.Node) {
	identifier := serviceLookup(a.checker, call)
	if identifier == nil {
		return
	}
	info.addRequirement(identifier, call)
	if info.effect == nil {
		info.effect = effectInterface(a.checker, serviceKeyTypeAt(a.checker, call.Expression().Expression()))
	}
}

// visitServiceLookup turns the callee `Users.find` of a service call into
// `(yield* Users).find`, which reads the member from the implementation in
// the current Context.
func (tx *lowering) visitServiceLookup(node *ast.Node) *ast.Node {
	f := tx.Factory()
	receiver := tx.moduleKey(node.Expression(), tx.Visitor().VisitNode(node.Expression()))
	lookup := f.NewParenthesizedExpression(f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), receiver))
	tx.EmitContext().SetOriginal(lookup, node.Expression())
	access := f.UpdatePropertyAccessExpression(node.AsPropertyAccessExpression(), lookup, nil /*questionDotToken*/, node.Name(), ast.NodeFlagsNone)
	return access
}

// visitModuleAlias turns M.member, read through M's export of M's own name
// (D311), into M.M.member.
func (tx *lowering) visitModuleAlias(node *ast.Node) *ast.Node {
	f := tx.Factory()
	access := node.AsPropertyAccessExpression()
	object := f.NewPropertyAccessExpression(tx.Visitor().VisitNode(node.Expression()), nil /*questionDotToken*/, f.NewIdentifier(tx.plan.aliases[node]), ast.NodeFlagsNone)
	tx.EmitContext().SetOriginal(object, node.Expression())
	lowered := f.UpdatePropertyAccessExpression(access, object, access.QuestionDotToken, node.Name(), node.Flags)
	tx.EmitContext().SetOriginal(lowered, node)
	return lowered
}

// visitEffectValueCall turns `p()`, where p is an Effect value, into
// `yield* p`.
func (tx *lowering) visitEffectValueCall(node *ast.Node) *ast.Node {
	f := tx.Factory()
	callee := tx.moduleKey(node.Expression(), tx.Visitor().VisitNode(node.Expression()))
	run := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), callee)
	tx.EmitContext().SetOriginal(run, node)
	return run
}

// visitServiceClass turns a service class into a class that extends the
// runtime's key class for its key (design D45):
//
//	abstract class Users { abstract find(id: string): … }
//
// becomes
//
//	class Users extends runtime.$service("app/users#Users") {}
//
// The type-only abstract members are erased later by the TypeScript
// transform. A service with `static readonly defaultValue` extends
// runtime.$reference(key, () => Flags.defaultValue()) instead, a Context.Reference
// that needs no provider (D40). A control operation also registers one
// kernel operation per abstract method, after the class, with each
// operation's declared parameter count:
// runtime.$control(Approval, ["approve"], [1]).
func (tx *lowering) visitServiceClass(node *ast.Node) *ast.Node {
	f := tx.Factory()
	ec := tx.EmitContext()
	key := tx.plan.keys[node]

	saved := tx.inEffect
	tx.inEffect = false
	members := tx.Visitor().VisitNodes(node.MemberList())
	tx.inEffect = saved
	if _, written := writtenKey(node); written != nil && members != nil {
		// static readonly key = "<key>" is the key (D501), not a member.
		var kept []*ast.Node
		for _, member := range members.Nodes {
			if ec.MostOriginal(member) != written {
				kept = append(kept, member)
			}
		}
		list := f.NewNodeList(kept)
		list.Loc = members.Loc
		members = list
	}

	helper, arguments := "$service", []*ast.Node{f.NewStringLiteral(key, ast.TokenFlagsNone)}
	if hasDefaultValue(node) {
		// runtime.$reference(key, () => Flags.defaultValue())
		helper = "$reference"
		read := f.NewPropertyAccessExpression(f.NewIdentifier(node.Name().Text()), nil /*questionDotToken*/, f.NewIdentifier("defaultValue"), ast.NodeFlagsNone)
		arguments = append(arguments, tx.generated(f.NewArrowFunction(nil /*modifiers*/, nil /*typeParameters*/, f.NewNodeList(nil), nil /*type*/, nil /*fullSignature*/, f.NewToken(ast.KindEqualsGreaterThanToken), tx.generated(f.NewCallExpression(read, nil, nil, f.NewNodeList(nil), ast.NodeFlagsNone)))))
	}
	base := f.NewCallExpression(tx.runtimeMember(helper), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(arguments), ast.NodeFlagsNone)
	extends := f.NewHeritageClause(ast.KindExtendsKeyword, f.NewNodeList([]*ast.Node{f.NewExpressionWithTypeArguments(base, nil /*typeArguments*/)}))
	class := f.UpdateClassDeclaration(node.AsClassDeclaration(), node.Modifiers(), node.Name(), nil /*typeParameters*/, f.NewNodeList([]*ast.Node{extends}), members)
	ec.SetOriginal(class, node)
	if classKindOf(node) != controlClass {
		return class
	}

	// One entry per operation; overloads share an entry and the widest arity.
	var names []string
	arity := map[string]int{}
	for _, member := range node.Members() {
		if ast.IsMethodDeclaration(member) && !ast.IsStatic(member) && ast.IsIdentifier(member.Name()) {
			name, n := member.Name().Text(), operationArity(member)
			previous, seen := arity[name]
			switch {
			case !seen:
				names = append(names, name)
				arity[name] = n
			case previous >= 0 && (n < 0 || n > previous):
				arity[name] = n
			}
		}
	}
	operations := make([]*ast.Node, 0, len(names))
	arities := make([]*ast.Node, 0, len(names))
	for _, name := range names {
		operations = append(operations, f.NewStringLiteral(name, ast.TokenFlagsNone))
		if n := arity[name]; n < 0 {
			arities = append(arities, f.NewPrefixUnaryExpression(ast.KindMinusToken, f.NewNumericLiteral("1", ast.TokenFlagsNone)))
		} else {
			arities = append(arities, f.NewNumericLiteral(strconv.Itoa(n), ast.TokenFlagsNone))
		}
	}
	register := f.NewCallExpression(tx.runtimeMember("$control"), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{
		f.NewIdentifier(node.Name().Text()),
		f.NewArrayLiteralExpression(f.NewNodeList(operations), false /*multiLine*/),
		f.NewArrayLiteralExpression(f.NewNodeList(arities), false /*multiLine*/),
	}), ast.NodeFlagsNone)
	statement := f.NewExpressionStatement(register)
	ec.SetOriginal(statement, node)
	return f.NewSyntaxList([]*ast.Node{class, statement})
}

// operationArity is the number of parameters a control operation declares,
// not counting a this parameter, or -1 when it has a rest parameter. The
// runtime pads a call's arguments to it, so a clause always receives its
// continuation after the declared parameters, also when the call left an
// optional argument out.
func operationArity(method *ast.Node) int {
	n := 0
	for _, parameter := range method.Parameters() {
		if ast.IsThisParameter(parameter) {
			continue
		}
		if parameter.AsParameterDeclaration().DotDotDotToken != nil {
			return -1
		}
		n++
	}
	return n
}
