package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// An Effect function whose body performs no Effect operation and cannot fail
// gets a plain variant, an optimization that changes no form, declaration, or
// diagnostic (D421, D500): TypeScript sees (...) => Effect<A, never, never>
// (Chapter 15), and plain code may not call it. It compiles to two functions:
//
//	function double$direct(n) { return n * 2 }                          // VibeLang callers use this
//	export function double(...args) { return Effect.sync(() => double$direct(...args)) }
//
// A VibeLang call in Effect code calls double$direct inline: double(4) has
// the type number, runs no Effect, and costs what a JavaScript call costs.
// Passed where a plain function is expected, double is EK4301 (D500).
//
// Eligibility is a greatest fixpoint over the call graph (D56): a group of
// functions that call one another compiles to plain JavaScript when each
// would with the calls inside the group counted as plain. Their calls of one
// another run eagerly up to the shared budget, then on heap frames
// (plain_cycles.go).

type plainState uint8

const (
	plainUnknown   plainState = iota
	plainExploring            // in the group being decided: a call to it counts as plain
	plainYes
	plainNo
)

// isPlainCandidate reports whether D10 decides how fn compiles: a named .vibe
// function declaration with a body and no overloads, or an annotated arrow
// that a const holds (constArrowOf), whose plain cycles recurse as a
// declaration's do (D412).
func isPlainCandidate(fn *ast.Node) bool {
	if fn != nil && fn.Kind == ast.KindArrowFunction {
		return constArrowOf(fn) != nil
	}
	if fn == nil || fn.Kind != ast.KindFunctionDeclaration || fn.Name() == nil || !isLowerable(fn) || isProducer(fn) {
		return false
	}
	symbol := fn.Symbol()
	return symbol != nil && len(symbol.Declarations()) == 1
}

// constArrowOf returns the variable statement of fn, an arrow function with a
// return annotation, when it is the initializer of the one declaration of a
// const statement, const name = (…): T => …, whose name nothing else
// declares, and its body reads none of this, super, arguments or new.target,
// so a function declaration of that name means what the arrow means. It
// returns nil otherwise.
func constArrowOf(fn *ast.Node) *ast.Node {
	if fn == nil || fn.Kind != ast.KindArrowFunction || fn.Type() == nil || !isLowerable(fn) {
		return nil
	}
	declaration := fn.Parent
	for declaration != nil && ast.IsParenthesizedExpression(declaration) {
		declaration = declaration.Parent
	}
	if declaration == nil || !ast.IsVariableDeclaration(declaration) || declaration.Initializer() == nil || ast.SkipParentheses(declaration.Initializer()) != fn ||
		!ast.IsIdentifier(declaration.Name()) || declaration.Type() != nil || declaration.AsVariableDeclaration().ExclamationToken != nil {
		return nil
	}
	list := declaration.Parent
	if list == nil || !ast.IsVariableDeclarationList(list) || list.Flags&ast.NodeFlagsBlockScoped != ast.NodeFlagsConst || len(list.AsVariableDeclarationList().Declarations.Nodes) != 1 {
		return nil
	}
	statement := list.Parent
	if statement == nil || !ast.IsVariableStatement(statement) || ast.HasSyntacticModifier(statement, ast.ModifierFlagsAmbient) {
		return nil
	}
	if symbol := declaration.Symbol(); symbol == nil || len(symbol.Declarations()) != 1 || readsLexicalContext(fn.Body()) {
		return nil
	}
	return statement
}

// readsLexicalContext reports whether body, outside the functions it declares
// other than arrows, reads this, super, arguments or new.target.
func readsLexicalContext(body *ast.Node) bool {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case node.Kind == ast.KindThisKeyword || node.Kind == ast.KindSuperKeyword || node.Kind == ast.KindMetaProperty:
			return true
		case ast.IsIdentifier(node) && node.Text() == "arguments":
			return true
		case ast.IsFunctionLike(node) && node.Kind != ast.KindArrowFunction, ast.IsClassLike(node):
			return false
		}
		return node.ForEachChild(visit)
	}
	return body != nil && visit(body)
}

// isSplittable reports whether fn, when it compiles to plain JavaScript,
// compiles to a $direct variant and an Effect form: a plain candidate with no
// return type annotation or an Effect contract. A function annotated with a
// plain return type keeps that type, and its callers call it as it is.
func (a *analyzer) isSplittable(fn *ast.Node) bool {
	if fn == nil || fn.Kind != ast.KindFunctionDeclaration || !isPlainCandidate(fn) || a.isFactory(fn) {
		return false
	}
	t := fn.Type()
	return t == nil || a.isEffectAnnotation(t)
}

// widensContract reports whether fn's contract writes an error or a
// requirement that its body need not raise or use, such as
// `number!Gone!Needed` on a body that returns 1. A caller sees the contract,
// not the body (Chapter 14), so such a function is an Effect and has no
// $direct variant. A channel written `infer Name` comes from the body, and a
// contract whose E and R are never, such as `number!!`, keeps the plain path.
func (a *analyzer) widensContract(fn *ast.Node) bool {
	k := a.contractOf(fn)
	if k == nil {
		return false
	}
	t := a.checker.GetTypeFromTypeNode(k.annotation)
	for channel, name := range map[int]string{channelE: "_E", channelR: "_R"} {
		if k.inferred(channel) {
			continue
		}
		if written := channelType(a.checker, t, name); written == nil || written.Flags()&checker.TypeFlagsNever == 0 {
			return true
		}
	}
	return false
}

// isEffectAnnotation reports whether the type node t names an Effect.
func (a *analyzer) isEffectAnnotation(t *ast.Node) bool {
	return isEffectType(a.checker, a.checker.GetTypeFromTypeNode(t))
}

// isPlainFunction reports whether fn, a plain candidate, compiles to plain
// JavaScript.
func (a *analyzer) isPlainFunction(fn *ast.Node) bool {
	if !isPlainCandidate(fn) || a.isFactory(fn) {
		return false
	}
	switch a.plain[fn] {
	case plainYes, plainExploring:
		return true
	case plainNo:
		return false
	}
	type member struct {
		ok   bool
		deps []*ast.Node
	}
	group := map[*ast.Node]*member{}
	queue := []*ast.Node{fn}
	for len(queue) > 0 {
		d := queue[len(queue)-1]
		queue = queue[:len(queue)-1]
		if _, seen := group[d]; seen || a.plain[d] == plainYes || a.plain[d] == plainNo {
			continue
		}
		a.plain[d] = plainExploring
		// D269 factories have no direct variant; S5-1 returned subtypes still run.
		m := &member{ok: !a.isFactory(d) && !a.widensContract(d) && !hasEscapingThrow(d) && !declaresUsing(d) && !hasVibeLangStatement(d) && !a.hasEscapingFailure(d) && !a.hasStreamLoop(d) && !a.hasProgramReturn(d)}
		group[d] = m
		if !m.ok {
			// d's own body rules it out, whatever its callees compile to, so
			// they need no exploring. Exploring them anyway walked every
			// function the call graph reaches: in the language server, whose
			// checkers start empty, the first hover in a module analyzed the
			// whole program.
			continue
		}
		// D147 excludes by-name arguments; D265 and D269 also hold contextual object
		// fields and declared Effect consts.
		a.forEachRunningCallInBody(d, func(call *ast.Node) bool {
			if holdsProgram(a.checker, call) {
				return false
			}
			if callee := a.candidateCallee(call); callee != nil {
				if !a.isSplittable(d) && a.isSplittable(callee) {
					// d is plain-annotated, and callee an Effect function:
					// plain code may not call it, variant or not (D500).
					m.ok = false
					return true
				}
				switch a.plain[callee] {
				case plainNo:
					m.ok = false
					return true // a callee rules d out; the rest of its body cannot change that
				case plainUnknown, plainExploring:
					m.deps = append(m.deps, callee)
					queue = append(queue, callee)
				}
				return false
			}
			if a.performs(call) {
				m.ok = false
				return true
			}
			return false
		})
	}
	for changed := true; changed; {
		changed = false
		for _, m := range group {
			if !m.ok {
				continue
			}
			for _, dep := range m.deps {
				if dm, ok := group[dep]; ok && !dm.ok || a.plain[dep] == plainNo {
					m.ok = false
					changed = true
					break
				}
			}
		}
	}
	for d, m := range group {
		if m.ok {
			a.plain[d] = plainYes
		} else {
			a.plain[d] = plainNo
		}
	}
	return a.plain[fn] == plainYes
}

// candidateCallee returns the plain candidate that call calls, or nil.
func (a *analyzer) candidateCallee(call *ast.Node) *ast.Node {
	signature := a.checker.GetResolvedSignature(call)
	if signature == nil {
		return nil
	}
	if fn := implementationOf(signature.Declaration()); isPlainCandidate(fn) {
		// A plain generic factory can return an Effect at this particular
		// call. Its result runs even though the declaration's body is plain.
		if !a.isSplittable(fn) && callRunsResult(a.checker, call, a.checker.GetReturnTypeOfSignature(signature)) {
			return nil
		}
		return fn
	}
	return nil
}

// declaresUsing reports whether fn's own body declares a using variable,
// which acquires an Effect resource, so fn compiles to frames (D54).
func declaresUsing(fn *ast.Node) bool {
	return firstUsing(fn) != nil
}

// firstUsing returns the first using declaration list in fn's own body, or
// nil.
func firstUsing(fn *ast.Node) *ast.Node {
	var found *ast.Node
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if n.Kind == ast.KindVariableDeclarationList && isUsingList(n) {
			found = n
			return true
		}
		return n.ForEachChild(visit)
	}
	visit(fn.Body())
	return found
}

// isUsingList reports whether list, a variable declaration list, declares
// using or await using variables. The block-scoped flags of await using are
// those of const and using together, so a test for either flag alone would
// match const.
func isUsingList(list *ast.Node) bool {
	kind := list.Flags & ast.NodeFlagsBlockScoped
	return kind == ast.NodeFlagsUsing || kind == ast.NodeFlagsAwaitUsing
}

// directReference describes how code in the callee expression's file reaches
// the $direct variant of a plain function.
type directReference struct {
	own       bool      // the function is its own plain form: a plain-annotated cycle member (D412)
	name      string    // the source name the reference reaches the function by: its own name, the local name of its import, or the member name after a namespace
	property  string    // through an import or a namespace, the name the module exports the variant under, such as "double$direct" (variantExportName)
	access    *ast.Node // for M.double through a namespace import, the access expression
	specifier *ast.Node // for an import, the named specifier or default clause that must bring the variant in
}

// directReferenceOf returns how node, the callee of a call or a function
// value, reaches the $direct variant of fn, a plain function: by its own name
// in fn's file, by a named or default import of fn's .vibe module, or through
// a namespace import of it. It returns nil when the variant is out of reach,
// and the reference then uses fn's Effect form.
func (a *analyzer) directReferenceOf(node *ast.Node, fn *ast.Node) *directReference {
	switch {
	case ast.IsIdentifier(node):
		symbol := a.checker.GetResolvedSymbol(node)
		if symbol == nil {
			return nil
		}
		if symbol.Flags()&ast.SymbolFlagsAlias == 0 {
			// An exported declaration's name resolves to its local symbol.
			if slices.Contains(symbol.Declarations(), fn) {
				return &directReference{name: node.Text()}
			}
			return nil
		}
		for _, d := range symbol.Declarations() {
			// A default binding belongs to the clause, whether or not the
			// same clause also contains named or namespace bindings.
			valueImport := ast.IsImportSpecifier(d) && !d.AsImportSpecifier().IsTypeOnly || ast.IsImportClause(d) && !d.AsImportClause().IsTypeOnly()
			if valueImport && a.declares(a.checker.GetAliasedSymbol(symbol), fn) {
				return &directReference{name: node.Text(), property: a.importedVariantName(d), specifier: d}
			}
		}
	case ast.IsPropertyAccessExpression(node) && ast.IsIdentifier(node.Expression()) && ast.IsIdentifier(node.Name()):
		namespace := a.checker.GetResolvedSymbol(node.Expression())
		if namespace == nil || namespace.Flags()&ast.SymbolFlagsAlias == 0 || !slices.ContainsFunc(namespace.Declarations(), ast.IsNamespaceImport) {
			return nil
		}
		if a.declares(a.checker.GetSymbolAtLocation(node.Name()), fn) {
			exports := moduleExportNames(a.checker, a.checker.GetAliasedSymbol(namespace))
			return &directReference{name: node.Name().Text(), property: variantExportName(exports, node.Name().Text()), access: node}
		}
	}
	return nil
}

// importedVariantName returns the name under which the module that binding,
// an import specifier or default import clause, imports from exports the
// $direct variant of the export that binding imports (variantExportName).
func (a *analyzer) importedVariantName(binding *ast.Node) string {
	name := "default"
	if ast.IsImportSpecifier(binding) {
		name = binding.AsImportSpecifier().PropertyNameOrName().Text()
	}
	var module *ast.Symbol
	if declaration := ast.FindAncestor(binding, ast.IsImportDeclaration); declaration != nil {
		module = a.checker.ResolveExternalModuleName(declaration.ModuleSpecifier(), nil /*importAttributesType*/)
	}
	return variantExportName(moduleExportNames(a.checker, module), name)
}

// declares reports whether symbol, or the symbol it aliases, declares fn.
func (a *analyzer) declares(symbol *ast.Symbol, fn *ast.Node) bool {
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = a.checker.GetAliasedSymbol(symbol)
	}
	return symbol != nil && slices.Contains(symbol.Declarations(), fn)
}

// directCallee returns how call, a call in a .vibe file that calls a plain
// function by name, reaches that function's $direct variant, or nil. Such a
// call runs inline wherever it is, at a module's top level too: it computes a
// value and runs no program, as Chapter 13's table says.
func (a *analyzer) directCallee(call *ast.Node) *directReference {
	if !isVibeLangFile(ast.GetSourceFileOfNode(call)) || inHatch(call) || holdsProgram(a.checker, call) {
		return nil // hatches and D269/D265 program positions keep the inert Effect form
	}
	fn := esFunctionOf(a.checker, ast.GetInvokedExpression(call))
	if fn == nil || !a.isSplittable(fn) || !a.isPlainFunction(fn) {
		return nil
	}
	return a.directReferenceOf(ast.GetInvokedExpression(call), fn)
}

// programEffectInterface returns the generic Effect interface that effect's
// Effect module declares, or nil when the program does not include effect.
// Unlike an Effect found in some type on the way, it does not depend on the
// order in which the checker checks things.
func (a *analyzer) programEffectInterface() *checker.Type {
	if a.programEffectSearched {
		return a.programEffect
	}
	a.programEffectSearched = true
	for _, file := range a.checker.Program().SourceFiles() {
		if !isEffectModuleFile(file, "Effect") || file.Symbol == nil {
			continue
		}
		for _, export := range a.checker.GetExportsOfModule(file.Symbol) {
			if export.Name() == "Effect" && export.Flags()&ast.SymbolFlagsInterface != 0 {
				a.programEffect = a.checker.GetDeclaredTypeOfSymbol(export)
				return a.programEffect
			}
		}
	}
	return nil
}

// plainPlan records what the lowering does with plain functions in one file.
type plainPlan struct {
	budgetDirects   map[*ast.Node]bool             // acyclic helpers with a private budget-forwarding entry
	directs         map[*ast.Node]bool             // function declarations split into a $direct variant and an Effect wrapper
	cyclicDirects   map[*ast.Node]bool             // plain functions on a cycle, split into an Effect generator and a $direct variant that runs it (plain_cycles.go)
	ownCycles       map[*ast.Node]bool             // the plain-annotated ones, whose own name is the plain variant (D412)
	fastRefs        map[*directReference]bool      // cycle entries that can forward a hidden eager budget
	rawRefs         map[*directReference]bool      // references to cycle members with an original JS body
	cycleRefs       map[*ast.Node]*directReference // cycle calls: direct in the eager body, yield* in the heap body
	directRefs      map[*ast.Node]*directReference // calls and function values that reach a $direct variant
	directImports   map[*ast.Node][]*ast.Node      // import declarations, and the specifiers whose $direct variants they bring in
	directExports   map[*ast.Node][]*ast.Node      // named export declarations, and their plain-function specifiers
	exportedImports map[*ast.Node]*ast.Node        // local export specifiers of an imported plain function, and the import binding they name
	directDefaults  map[*ast.Node]*directReference // export default assignments of a plain function, and how they reach its variant
	variantImports  map[*ast.Node]string           // import specifiers and default clauses that bring in a variant, and the name their module exports it under
	variantSources  map[*ast.Node]string           // export specifiers with a module specifier, and the name their module exports the variant under
	ownExports      map[string]bool                // the names the file exports, which its variants' export names avoid (variantExportName)
}

func newPlainPlan() plainPlan {
	return plainPlan{budgetDirects: map[*ast.Node]bool{}, directs: map[*ast.Node]bool{}, cyclicDirects: map[*ast.Node]bool{}, cycleRefs: map[*ast.Node]*directReference{}, rawRefs: map[*directReference]bool{}, fastRefs: map[*directReference]bool{}, directRefs: map[*ast.Node]*directReference{}, directImports: map[*ast.Node][]*ast.Node{}, directExports: map[*ast.Node][]*ast.Node{}, exportedImports: map[*ast.Node]*ast.Node{}, directDefaults: map[*ast.Node]*directReference{}, variantImports: map[*ast.Node]string{}, variantSources: map[*ast.Node]string{}}
}

// planPlain records how the lowering treats node with respect to plain
// functions: a declaration to split, a call that runs inline, or a function
// value passed as its plain variant.
func (p *plainPlan) planPlain(a *analyzer, node *ast.Node) {
	if node.Kind == ast.KindExportDeclaration {
		p.planPlainExports(a, node)
	}
	if node.Kind == ast.KindExportAssignment {
		p.planPlainDefault(a, node)
	}
	if a.isSplittable(node) && a.isPlainFunction(node) {
		if a.onPlainCycle(node) {
			p.cyclicDirects[node] = true
		} else {
			p.directs[node] = true
			p.budgetDirects[node] = a.forwardsPlainBudget(node)
		}
	} else if a.isAnnotatedPlain(node) && a.onPlainCycle(node) {
		// Its own name stays its plain form (D412).
		if p.ownCycles == nil {
			p.ownCycles = map[*ast.Node]bool{}
		}
		p.cyclicDirects[node], p.ownCycles[node] = true, true
	}
	var ref *directReference
	switch {
	case isInvocation(node) && a.isCycleCall(node):
		ref = a.directCallee(node)
		if ref == nil {
			ref = a.ownCycleReference(node)
		}
		if ref != nil {
			p.cycleRefs[node] = ref
			p.rawRefs[ref] = true
			p.fastRefs[ref] = plainBudgetParameters(esFunctionOf(a.checker, ast.GetInvokedExpression(node)))
			p.importVariant(a, ref.specifier)
		}
		return
	case isInvocation(node):
		ref = a.directCallee(node)
	}
	if ref == nil {
		return
	}
	subject := node
	if isInvocation(node) {
		subject = ast.GetInvokedExpression(node)
	}
	if fn := esFunctionOf(a.checker, subject); fn != nil && (a.onPlainCycle(fn) || a.forwardsPlainBudget(fn)) {
		p.fastRefs[ref] = plainBudgetParameters(fn)
		for owner := node.Parent; owner != nil; owner = owner.Parent {
			if ast.IsFunctionLike(owner) && a.onPlainCycle(owner) {
				p.rawRefs[ref] = fn == owner || a.plainReaches(fn, owner)
				break
			}
		}
	}
	p.directRefs[node] = ref
	p.importVariant(a, ref.specifier)
}

// importVariant records that binding, an import specifier or default import
// clause, or nil, must bring in its $direct variant, and the name its module
// exports the variant under.
func (p *plainPlan) importVariant(a *analyzer, binding *ast.Node) {
	if binding == nil {
		return
	}
	declaration := ast.FindAncestor(binding, ast.IsImportDeclaration)
	if declaration != nil && !slices.Contains(p.directImports[declaration], binding) {
		p.directImports[declaration] = append(p.directImports[declaration], binding)
		p.variantImports[binding] = a.importedVariantName(binding)
	}
}

// planPlainDefault records `export default double`, where double is a plain
// function, local, imported or a namespace member. A default import of the
// module reaches double's variant as default$direct (directReferenceOf), so
// the module must export it, as `export default function` does.
func (p *plainPlan) planPlainDefault(a *analyzer, node *ast.Node) {
	assignment := node.AsExportAssignment()
	if assignment.IsExportEquals {
		return
	}
	fn := esFunctionOf(a.checker, assignment.Expression)
	if fn == nil || !a.isSplittable(fn) || !a.isPlainFunction(fn) {
		return
	}
	if ref := a.directReferenceOf(assignment.Expression, fn); ref != nil {
		p.directDefaults[node] = ref
		p.importVariant(a, ref.specifier)
	}
}

// Named exports must forward the same direct variants that their importers
// use. This includes local export lists, aliases, and barrel re-exports.
func (p *plainPlan) planPlainExports(a *analyzer, node *ast.Node) {
	decl := node.AsExportDeclaration()
	if decl.IsTypeOnly || decl.ExportClause == nil || decl.ExportClause.Kind != ast.KindNamedExports {
		return
	}
	for _, specifier := range decl.ExportClause.AsNamedExports().Elements.Nodes {
		if specifier.AsExportSpecifier().IsTypeOnly {
			continue
		}
		symbol := a.checker.GetExportSpecifierLocalTargetSymbol(specifier)
		if symbol == nil {
			continue
		}
		target := symbol
		if target.Flags()&ast.SymbolFlagsAlias != 0 {
			target = a.checker.GetAliasedSymbol(target)
		}
		fn := target.ValueDeclaration()
		if fn == nil || !a.isSplittable(fn) || !a.isPlainFunction(fn) {
			continue
		}
		p.directExports[node] = append(p.directExports[node], specifier)
		if decl.ModuleSpecifier != nil {
			local := specifier.AsExportSpecifier().PropertyName
			if local == nil {
				local = specifier.Name()
			}
			module := a.checker.ResolveExternalModuleName(decl.ModuleSpecifier, nil /*importAttributesType*/)
			p.variantSources[specifier] = variantExportName(moduleExportNames(a.checker, module), local.Text())
			continue
		}
		// A local export can refer to an imported binding. Its direct
		// variant needs an import even if no local call uses the binding.
		for _, imported := range symbol.Declarations() {
			if !ast.IsImportSpecifier(imported) && imported.Kind != ast.KindImportClause {
				continue
			}
			p.exportedImports[specifier] = imported
			p.importVariant(a, imported)
		}
	}
}
