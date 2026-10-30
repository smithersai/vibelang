package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Contracts.
//
// The return type annotation of a .vibe function with a body is the function's
// contract, Effect<A, E, R>: the whole computation, as Promise<string> is the
// whole computation of an async function. The function is an Effect whatever
// its body runs. Its returns are checked against A, so a returned value that A
// does not accept is TypeScript's own error. An expected failure that can
// escape the body and that E does not accept is EK9201; a requirement that R
// does not accept is EK9202. A contract may be wider than the body, never
// narrower (Chapter 14).
//
// A channel written `infer Name` comes from the body (D57). The signature's
// return type holds what was inferred, so callers and declaration files see
// the full contract. A type argument left out of Effect<...> means what it
// means in TypeScript: Effect<User> checks E and R as never (D309). A
// non-Effect annotation makes a plain function,
// which never fails and needs nothing (D67, D282): a failure that can escape
// it, or an Effect it runs, is EK9203 (plain_failures.go).

func init() {
	fileChecks = append(fileChecks, checkContracts)
}

// The channels of Effect<A, E, R>, in order.
const (
	channelA = iota
	channelE
	channelR
)

// A contract is the Effect<A, E, R> return annotation of a function that the
// lowering can turn into an Effect.
type contract struct {
	annotation *ast.Node   // the return type annotation
	reference  *ast.Node   // the reference to Effect whose type arguments are the channels; nil when the annotation names a whole Effect type, as a type alias does
	channels   []*ast.Node // reference's type arguments, A, E, R; fewer when some are left out
}

// inferred reports whether channel is written `infer Name`.
func (k *contract) inferred(channel int) bool {
	return channel < len(k.channels) && k.channels[channel].Kind == ast.KindInferType
}

func (k *contract) inferredAny() bool {
	return k.inferred(channelA) || k.inferred(channelE) || k.inferred(channelR)
}

// contractOf returns fn's contract, or nil when fn is not a function that the
// lowering can turn into an Effect, has no return type annotation, or is
// annotated with a type that is not an Effect.
func (a *analyzer) contractOf(fn *ast.Node) *contract {
	if k, ok := a.contracts[fn]; ok {
		return k
	}
	var k *contract
	if isLowerable(fn) && fn.Type() != nil {
		annotation := fn.Type()
		if t := a.checker.GetTypeFromTypeNode(annotation); isEffectType(a.checker, t) {
			k = &contract{annotation: annotation}
			// effect's own Effect<A, E, R>, or the prelude's alias of it, names
			// the channels; another alias names a whole Effect type.
			if annotation.Kind == ast.KindTypeReference && (t.Alias() == nil || t.Alias().Symbol().Name() == "Effect") {
				k.reference = annotation
				if arguments := annotation.TypeArgumentList(); arguments != nil {
					k.channels = arguments.Nodes
				}
			}
		}
	}
	a.contracts[fn] = k
	return k
}

// hasContract reports whether fn is a .vibe function whose return annotation
// is an Effect. Such a function is an Effect whatever its body runs.
func (a *analyzer) hasContract(fn *ast.Node) bool {
	return a.contractOf(fn) != nil
}

// hasPlainContract identifies a plain contract without inspecting the body
// (D67, D282, D500): a plain return annotation or `: infer _`, a protocol
// method or one implementing a plain member (D397), or a literal whose
// destination gives the plain form.
func (a *analyzer) hasPlainContract(fn *ast.Node) bool {
	if isPlainGenerator(fn) {
		return true // D296: a JavaScript iterator annotation is a plain contract
	}
	if fn == nil || !isLowerable(fn) || isProducer(fn) {
		return false
	}
	if annotation := fn.Type(); annotation != nil {
		return !a.isEffectAnnotation(annotation)
	}
	if fn.Kind == ast.KindMethodDeclaration {
		return a.plainMemberOwner(fn) != ""
	}
	if isLambda(fn) {
		e := a.classify(a.contextualTypes(fn))
		return e.plainFn && !e.effectFn && !e.program
	}
	return false
}

// hasInferredChannel reports whether node is a .vibe function whose return
// annotation writes a channel as `infer Name`. Its declaration file declares
// the return type the checker gives it, the full contract with the inferred
// channels filled in, instead of copying the annotation.
func hasInferredChannel(node *ast.Node) bool {
	if hasInferredReturn(node) {
		return true
	}
	if !isLowerable(node) || node.Type() == nil || node.Type().Kind != ast.KindTypeReference {
		return false
	}
	for _, argument := range node.Type().TypeArguments() {
		if argument.Kind == ast.KindInferType {
			return true
		}
	}
	return false
}

// hasInferredReturn reports whether fn is a .vibe function whose return
// annotation is `infer _`: a plain function whose return type TypeScript
// infers from its body, as it infers an unannotated TypeScript function's
// (D500). Its declaration file declares that inferred type.
func hasInferredReturn(fn *ast.Node) bool {
	if fn == nil || !isLowerable(fn) || fn.Type() == nil {
		return false
	}
	return isInferredReturnAnnotation(fn.Type())
}

// isInferredReturnAnnotation reports whether t, a return annotation, is
// written `infer _`.
func isInferredReturnAnnotation(t *ast.Node) bool {
	if t == nil || t.Kind != ast.KindInferType {
		return false
	}
	parameter := t.AsInferTypeNode().TypeParameter
	return parameter != nil && parameter.Name() != nil && parameter.Name().Text() == "_" && parameter.AsTypeParameterDeclaration().Constraint == nil
}

// inferredReturnInference infers nothing from a literal's `: infer _`
// annotation, whose type is its body's, as TypeScript infers nothing from an
// unannotated literal's return type before checking its body (D500).
func inferredReturnInference(c *checker.Checker, fn *ast.Node, t *checker.Type) *checker.Type {
	if hasInferredReturn(fn) {
		return nil
	}
	return t
}

// unwrappedReturnType checks what a .vibe function with a contract returns
// against the contract's A, as TypeScript checks what an async function
// returns against the type its Promise wraps.
func unwrappedReturnType(c *checker.Checker, fn *ast.Node, t *checker.Type) *checker.Type {
	if !isLowerable(fn) || analyzerFor(c).contractOf(fn) == nil || analyzerFor(c).isFactory(fn) {
		return t
	}
	if success := successType(c, c.GetReturnTypeOfSignature(c.GetSignatureFromDeclaration(fn))); success != nil {
		return success
	}
	return t
}

// annotatedReturnType fills in each channel of fn's contract that is written
// `infer Name` with what fn's body gives it (D57): A from what the body
// returns, as TypeScript infers a return type, and E and R from what the body
// raises and needs.
func annotatedReturnType(c *checker.Checker, fn *ast.Node, t *checker.Type) *checker.Type {
	if !isLowerable(fn) {
		return t
	}
	a := analyzerFor(c)
	k := a.contractOf(fn)
	if k == nil || !k.inferredAny() {
		return t
	}
	effect := effectInterface(c, t)
	if effect == nil {
		return t
	}
	channels := []*checker.Type{successType(c, t), channelType(c, t, "_E"), channelType(c, t, "_R")}
	if k.inferred(channelA) {
		channels[channelA] = c.GetReturnTypeFromBody(fn)
	}
	if k.inferred(channelE) || k.inferred(channelR) {
		var info *effectInfo
		if a.isFactory(fn) {
			info = a.factoryInfo(fn)
		} else {
			info = a.effectOf(fn)
		}
		if info == nil {
			info = &effectInfo{} // fn's body is being collected
		}
		if k.inferred(channelE) {
			channels[channelE] = c.GetUnionType(info.errors)
		}
		if k.inferred(channelR) {
			channels[channelR] = c.GetUnionType(info.requirements)
		}
	}
	return c.NewTypeReference(effect, channels)
}

// inferChannel reports whether node, an infer type, is a channel of a
// contract, where `infer Name` asks for the channel to be inferred (D57). The
// name is not in scope anywhere, so it is never unused.
func inferChannel(c *checker.Checker, node *ast.Node) bool {
	if node.Parent != nil && node.Parent.Type() == node && hasInferredReturn(node.Parent) {
		return true // `: infer _`, the inferred plain return (D500)
	}
	reference := node.Parent
	if reference == nil || reference.Kind != ast.KindTypeReference || reference.Parent == nil {
		return false
	}
	fn := reference.Parent
	if fn.Type() != reference || !isLowerable(fn) {
		return false
	}
	k := analyzerFor(c).contractOf(fn)
	return k != nil && k.reference == reference
}

// calleeContract returns the E and R that a call contributes when its callee
// is a .vibe function with a contract, from the signature the call resolved
// to, so a generic contract is instantiated. ok is false when the contract
// infers a channel: the caller then reads the callee's body, which never asks
// for a return type that a call cycle may be computing.
func (a *analyzer) calleeContract(callee *ast.Node, call *ast.Node, sig *checker.Signature) (e, r *checker.Type, ok bool) {
	k := a.contractOf(callee)
	if k == nil || k.inferredAny() {
		return nil, nil, false
	}
	t := runningCallResult(a.checker, call, sig)
	e, r = channelType(a.checker, t, "_E"), channelType(a.checker, t, "_R")
	if e == nil || r == nil {
		// The call resolved to a form that returns no Effect, such as a
		// lambda's plain form (D113): the caller reads the callee's body.
		return nil, nil, false
	}
	return e, r, true
}

// checkContracts reports, for each function in file that the lowering can
// turn into an Effect: EK9203 for a return annotation that is not a contract
// or leaves a channel out, EK9201 for an expected failure that escapes the
// contract's E, and EK9202 for a requirement that escapes its R.
func checkContracts(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isLowerable(node) && node.Type() != nil {
			a.checkContract(file, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func (a *analyzer) checkContract(file *ast.SourceFile, fn *ast.Node) {
	c := a.checker
	k := a.contractOf(fn)
	switch {
	case k == nil:
		if a.reportFailingPlainContract(fn) {
			return // D282: a plain function never fails
		}
		// A plain annotation keeps its type on a function that compiles to
		// plain JavaScript (D67). On one whose body runs an Effect it is not
		// what the function returns, and a method is no exception: its
		// declaration file and every caller that reaches it through a type
		// would see the annotation (D74). A method that implements a
		// plain-function member, such as Equal.symbol, is checked against
		// that member instead (EK4301, D55).
		if !a.canBePlain(fn) && (fn.Kind != ast.KindMethodDeclaration || a.plainMemberOwner(fn) == "") {
			a.reportRunningPlainContract(fn)
		}
		return
	}
	if a.isFactory(fn) {
		return // checkFactories checks the returned programs' channels
	}
	info := a.effectOf(fn)
	if info == nil {
		return
	}
	contractType := c.GetReturnTypeOfSignature(c.GetSignatureFromDeclaration(fn))
	name := functionDisplayName(fn)
	var errorEscapes, requirementEscapes []escape
	if !k.inferred(channelE) {
		errorEscapes = escapes(c, info.errors, info.errorSources, channelType(c, contractType, "_E"))
	}
	if !k.inferred(channelR) {
		requirementEscapes = escapes(c, info.requirements, info.requirementSources, channelType(c, contractType, "_R"))
	}
	if !k.inferred(channelE) {
		declared := channelType(c, contractType, "_E")
		for _, escape := range errorEscapes {
			d := report(c, escape.source, EK9201, c.TypeToString(escape.t), name, "its contract says E = "+c.TypeToString(declared))
			note(d, "Catch it inside {0}, or change the contract to {1}.", name, contractText(c, contractType, channelE, escape.t))
		}
	}
	if !k.inferred(channelR) {
		declared := channelType(c, contractType, "_R")
		for _, escape := range requirementEscapes {
			d := report(c, escape.source, EK9202, name, c.TypeToString(escape.t), c.TypeToString(declared))
			note(d, "Provide {0} inside {1} with provide layer { … }, or add it to the contract: {2}.", c.TypeToString(escape.t), name, contractText(c, contractType, channelR, escape.t))
		}
	}
}

// An escape is what one call or throw adds to a channel that the contract's
// channel does not accept.
type escape struct {
	t      *checker.Type
	source *ast.Node
}

// escapes returns, for each source, the members of what it adds that
// declared does not accept, joined.
func escapes(c *checker.Checker, types []*checker.Type, sources []*ast.Node, declared *checker.Type) []escape {
	if declared == nil {
		return nil
	}
	var order []*ast.Node
	bySource := map[*ast.Node][]*checker.Type{}
	for i, t := range types {
		for _, member := range unionMembers(t) {
			if channelAssignableTo(c, member, declared, nil) {
				continue
			}
			source := sources[i]
			if _, seen := bySource[source]; !seen {
				order = append(order, source)
			}
			bySource[source] = append(bySource[source], member)
		}
	}
	result := make([]escape, 0, len(order))
	for _, source := range order {
		result = append(result, escape{t: c.GetUnionType(bySource[source]), source: source})
	}
	return result
}

// channelAssignableTo checks the whole channel before inspecting a conditional's
// branches. Alias variance can reject two different instantiations of Exclude
// even when both possible source branches fit the target (C-7). Checking both
// branches with the checker proves the same upper bound without assuming that
// a particular conditional branch will be selected.
func channelAssignableTo(c *checker.Checker, source, target *checker.Type, visiting map[*checker.Type]bool) bool {
	if c.IsTypeAssignableTo(source, target) {
		return true
	}
	if source.Flags()&checker.TypeFlagsConditional == 0 || visiting[source] {
		return false
	}
	if visiting == nil {
		visiting = map[*checker.Type]bool{}
	}
	visiting[source] = true
	defer delete(visiting, source)
	return channelAssignableTo(c, c.GetTrueTypeOfConditionalType(source), target, visiting) &&
		channelAssignableTo(c, c.GetFalseTypeOfConditionalType(source), target, visiting)
}

// contractText writes contract, an Effect<A, E, R>, with extra joined to the
// given channel, for a fix that widens the contract. It writes the ! form.
func contractText(c *checker.Checker, contract *checker.Type, channel int, extra *checker.Type) string {
	channels := []*checker.Type{successType(c, contract), channelType(c, contract, "_E"), channelType(c, contract, "_R")}
	channels[channel] = c.GetUnionType([]*checker.Type{channels[channel], extra})
	texts := make([]string, len(channels))
	for i, t := range channels {
		texts[i] = c.TypeToString(t)
	}
	return bangText(texts...)
}

// functionDisplayName names fn in a diagnostic: its name, the name of the
// variable it initializes, or "this function".
func functionDisplayName(fn *ast.Node) string {
	if name := functionName(fn); name != "" {
		return name
	}
	return "this function"
}
