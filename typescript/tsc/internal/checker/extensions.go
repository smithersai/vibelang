package checker

import (
	"maps"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// WithChecker calls fn with the checker behind r while holding the checker's
// lock, the way the resolver's own methods do. In-tree language extensions use
// it to ask type questions while they transform a file for emit.
func (r *EmitResolver) WithChecker(fn func(c *Checker)) {
	r.checkerMu.Lock()
	defer r.checkerMu.Unlock()
	fn(r.checker)
}

// CallExpressionTypeHook can replace t, the type the checker gives call. It
// runs on every call the checker types, so it must be cheap, and it returns t
// when it has nothing to say.
type CallExpressionTypeHook func(c *Checker, call *ast.Node, t *Type) *Type

var callExpressionTypeHooks []CallExpressionTypeHook

// RegisterCallExpressionTypeHook adds hook to every checker. Call it only from
// the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterCallExpressionTypeHook(hook CallExpressionTypeHook) {
	callExpressionTypeHooks = append(callExpressionTypeHooks, hook)
}

func (c *Checker) applyCallExpressionTypeHooks(call *ast.Node, t *Type) *Type {
	for _, hook := range callExpressionTypeHooks {
		if t == nil {
			break
		}
		t = hook(c, call, t)
	}
	return t
}

// InferredReturnTypeHook can replace t, the return type the checker inferred
// from the body of fn, a function without a return type annotation.
type InferredReturnTypeHook func(c *Checker, fn *ast.Node, t *Type) *Type

var inferredReturnTypeHooks []InferredReturnTypeHook

// RegisterInferredReturnTypeHook adds hook to every checker. Call it only from
// the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterInferredReturnTypeHook(hook InferredReturnTypeHook) {
	inferredReturnTypeHooks = append(inferredReturnTypeHooks, hook)
}

func (c *Checker) applyInferredReturnTypeHooks(fn *ast.Node, t *Type) *Type {
	for _, hook := range inferredReturnTypeHooks {
		t = hook(c, fn, t)
	}
	return t
}

// ExtensionState returns the value an in-tree language extension keeps for c
// under key, calling create to make it on first use. The value lives exactly
// as long as c, so a language server that replaces its checkers on every edit
// does not accumulate it. A checker is used by one goroutine at a time, so
// neither the state map nor the value needs a lock.
func (c *Checker) ExtensionState(key any, create func() any) any {
	if value, ok := c.extensionState[key]; ok {
		return value
	}
	if c.extensionState == nil {
		c.extensionState = map[any]any{}
	}
	value := create()
	c.extensionState[key] = value
	return value
}

// CatchVariableTypeHook gives the variable of a catch clause that has no type
// annotation its type, or returns nil to leave TypeScript's any or unknown.
// declaration is the catch clause's variable declaration.
type CatchVariableTypeHook func(c *Checker, declaration *ast.Node) *Type

var catchVariableTypeHooks []CatchVariableTypeHook

// RegisterCatchVariableTypeHook adds hook to every checker. Call it only from
// the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterCatchVariableTypeHook(hook CatchVariableTypeHook) {
	catchVariableTypeHooks = append(catchVariableTypeHooks, hook)
}

func (c *Checker) applyCatchVariableTypeHooks(declaration *ast.Node) *Type {
	for _, hook := range catchVariableTypeHooks {
		if t := hook(c, declaration); t != nil {
			return t
		}
	}
	return nil
}

// NewTypeReference instantiates target, a generic class or interface type,
// with typeArguments.
func (c *Checker) NewTypeReference(target *Type, typeArguments []*Type) *Type {
	return c.createTypeReference(target, typeArguments)
}

// CompilerOptions returns the options of the program that c checks.
func (c *Checker) CompilerOptions() *core.CompilerOptions {
	return c.compilerOptions
}

// ImportBindingValueReference reports whether an import alias was referenced
// in emitted value code. Type-only references do not initialize its module.
// The caller has checked the source file; this reads the same alias-reference
// evidence the emitter uses, without entering the emit resolver's lock.
func (c *Checker) ImportBindingValueReference(name *ast.Node) (referenced, known bool) {
	symbol := c.GetSymbolAtLocation(name)
	if symbol == nil || symbol.Flags()&ast.SymbolFlagsAlias == 0 || !c.canCollectSymbolAliasAccessibilityData {
		return false, false
	}
	return c.aliasSymbolLinks.Get(symbol).referenced, true
}

// AddDiagnostic records d in the matching semantic or suggestion collection,
// so editor suggestions do not become CLI semantic errors.
// Its node must belong to the file being checked: the program reads each
// file's diagnostics from the checker that checks that file.
func (c *Checker) AddDiagnostic(d *ast.Diagnostic) *ast.Diagnostic {
	if d.Category() == diagnostics.CategorySuggestion {
		return c.addSuggestionDiagnostic(d)
	}
	return c.addDiagnostic(d)
}

// MarkSymbolReferenced records that output the compiler writes reads symbol,
// which no name in the source does, so the file does not report it unused. A
// SourceFileCheckHook may call it: the unused check runs after the hooks.
func (c *Checker) MarkSymbolReferenced(symbol *ast.Symbol) {
	c.symbolReferenced(symbol, ast.SymbolFlagsAll)
}

// SourceFileCheckHook runs after c has checked file, once for each checker
// and file, so it can report diagnostics for file with AddDiagnostic.
type SourceFileCheckHook func(c *Checker, file *ast.SourceFile)

var sourceFileCheckHooks []SourceFileCheckHook

// RegisterSourceFileCheckHook adds hook to every checker. Call it only from
// the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterSourceFileCheckHook(hook SourceFileCheckHook) {
	sourceFileCheckHooks = append(sourceFileCheckHooks, hook)
}

func (c *Checker) applySourceFileCheckHooks(file *ast.SourceFile) {
	for _, hook := range sourceFileCheckHooks {
		if c.isCanceled() {
			return
		}
		hook(c, file)
	}
}

// DiagnosticsFilterHook can drop diagnostics from what c reports for file. It
// returns diagnostics itself when it drops nothing, and a new slice otherwise.
type DiagnosticsFilterHook func(c *Checker, file *ast.SourceFile, diagnostics []*ast.Diagnostic) []*ast.Diagnostic

var diagnosticsFilterHooks []DiagnosticsFilterHook

// RegisterDiagnosticsFilterHook adds hook to every checker. Call it only from
// the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterDiagnosticsFilterHook(hook DiagnosticsFilterHook) {
	diagnosticsFilterHooks = append(diagnosticsFilterHooks, hook)
}

func (c *Checker) applyDiagnosticsFilterHooks(file *ast.SourceFile, diagnostics []*ast.Diagnostic) []*ast.Diagnostic {
	for _, hook := range diagnosticsFilterHooks {
		diagnostics = hook(c, file, diagnostics)
	}
	return diagnostics
}

// GetTypeOfExpressionBeforeWidening returns the type the checker gives the
// expression node, keeping literal freshness: TypeScript widens the type of
// "bad" in `return "bad"` to string in an inferred return type, but not the
// type of a variable declared as the literal type "bad". Language extensions
// that infer a type from expressions widen it the same way.
func (c *Checker) GetTypeOfExpressionBeforeWidening(node *ast.Node) *Type {
	return c.checkExpressionCached(node)
}

// NameResolutionHook can supply a symbol for name, which no scope enclosing
// location declares, before the checker searches the global scope. It returns
// nil when it has nothing to supply. It runs for every name that reaches the
// global scope, so it must be cheap.
type NameResolutionHook func(c *Checker, location *ast.Node, name string, meaning ast.SymbolFlags) *ast.Symbol

var nameResolutionHooks []NameResolutionHook

// RegisterNameResolutionHook adds hook to every checker. Call it only from the
// init function of an in-tree package that tsc/cmd/tsc imports; registration
// is not synchronized.
func RegisterNameResolutionHook(hook NameResolutionHook) {
	nameResolutionHooks = append(nameResolutionHooks, hook)
}

// QualifiedNameResolutionHook can supply a symbol for right in name, a
// qualified name or property access whose left side resolved to namespace,
// when namespace exports nothing named right with meaning. It returns nil
// when it has nothing to supply. It runs only where TypeScript would report
// that namespace has no such member, so it costs nothing on a name that
// resolves.
type QualifiedNameResolutionHook func(c *Checker, name *ast.Node, namespace *ast.Symbol, right *ast.Node, meaning ast.SymbolFlags) *ast.Symbol

var qualifiedNameResolutionHooks []QualifiedNameResolutionHook

// RegisterQualifiedNameResolutionHook adds hook to every checker. Call it
// only from the init function of an in-tree package that tsc/cmd/tsc
// imports; registration is not synchronized.
func RegisterQualifiedNameResolutionHook(hook QualifiedNameResolutionHook) {
	qualifiedNameResolutionHooks = append(qualifiedNameResolutionHooks, hook)
}

func (c *Checker) resolveQualifiedNameFromHooks(name *ast.Node, namespace *ast.Symbol, right *ast.Node, meaning ast.SymbolFlags) *ast.Symbol {
	for _, hook := range qualifiedNameResolutionHooks {
		if symbol := hook(c, name, namespace, right, meaning); symbol != nil {
			return symbol
		}
	}
	return nil
}

// SpellingCandidatesHook returns names that a "Did you mean" suggestion
// (TS2552) may offer at location for meaning, besides those in scope: names
// that a NameResolutionHook supplies, which no symbol table lists.
type SpellingCandidatesHook func(c *Checker, location *ast.Node, meaning ast.SymbolFlags) []*ast.Symbol

var spellingCandidatesHooks []SpellingCandidatesHook

// RegisterSpellingCandidatesHook adds hook to every checker. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterSpellingCandidatesHook(hook SpellingCandidatesHook) {
	spellingCandidatesHooks = append(spellingCandidatesHooks, hook)
}

// SpellingSuggestionFilterHook reports whether a "Did you mean" suggestion
// (TS2552) at location may offer candidate. A language that removes names
// from scope, as VibeLang removes Node's globals, keeps them out of its
// suggestions. It runs for every candidate, so it must be cheap.
type SpellingSuggestionFilterHook func(c *Checker, location *ast.Node, candidate *ast.Symbol) bool

var spellingSuggestionFilterHooks []SpellingSuggestionFilterHook

// RegisterSpellingSuggestionFilterHook adds hook to every checker. Call it
// only from the init function of an in-tree package that tsc/cmd/tsc
// imports; registration is not synchronized.
func RegisterSpellingSuggestionFilterHook(hook SpellingSuggestionFilterHook) {
	spellingSuggestionFilterHooks = append(spellingSuggestionFilterHooks, hook)
}

// spellingSuggestionAllowed reports whether every filter hook lets a
// suggestion at location offer candidate.
func (c *Checker) spellingSuggestionAllowed(location *ast.Node, candidate *ast.Symbol) bool {
	for _, hook := range spellingSuggestionFilterHooks {
		if !hook(c, location, candidate) {
			return false
		}
	}
	return true
}

// suggestBeforeGlobals is the suggestion resolver's step before the global
// scope: the closest of the hooks' candidates and the globals that the
// filter hooks allow, so that a supplied name competes with a global one by
// distance. It returns nil when no hook offers a candidate, and the globals
// are searched as usual.
func (c *Checker) suggestBeforeGlobals(location *ast.Node, name string, meaning ast.SymbolFlags) *ast.Symbol {
	var candidates []*ast.Symbol
	for _, hook := range spellingCandidatesHooks {
		candidates = append(candidates, hook(c, location, meaning)...)
	}
	if len(candidates) == 0 {
		return nil
	}
	symbols := core.ConcatenateSeq(slices.Values(candidates), maps.Values(c.globals))
	allowed := func(yield func(*ast.Symbol) bool) {
		for symbol := range symbols {
			if c.spellingSuggestionAllowed(location, symbol) && !yield(symbol) {
				return
			}
		}
	}
	return c.getSpellingSuggestionForName(name, allowed, meaning)
}

// ResolveLexicalName returns the symbol that name, written where location
// stands, resolves to, without marking the symbol used: what a source
// reference there would mean. A VibeLang intrinsic, which ignores the scopes
// around it, asks what its spelling would capture.
func (c *Checker) ResolveLexicalName(name string, location *ast.Node, meaning ast.SymbolFlags) *ast.Symbol {
	return c.resolveName(location, name, meaning, nil /*nameNotFoundMessage*/, false /*isUse*/, false /*excludeGlobals*/)
}

func (c *Checker) resolveBeforeGlobals(location *ast.Node, name string, meaning ast.SymbolFlags) *ast.Symbol {
	for _, hook := range nameResolutionHooks {
		if symbol := hook(c, location, name, meaning); symbol != nil {
			return symbol
		}
	}
	return nil
}

// EntityNameVisibilityHook reports whether a declaration file may write
// entityName, which resolves to symbol, although no declaration of the file
// declares or imports it. A hook that says yes must make the declaration file
// import the name, for example with a declaration transformer hook.
type EntityNameVisibilityHook func(c *Checker, entityName *ast.Node, symbol *ast.Symbol) bool

var entityNameVisibilityHooks []EntityNameVisibilityHook

// RegisterEntityNameVisibilityHook adds hook to every checker. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterEntityNameVisibilityHook(hook EntityNameVisibilityHook) {
	entityNameVisibilityHooks = append(entityNameVisibilityHooks, hook)
}

func (c *Checker) applyEntityNameVisibilityHooks(entityName *ast.Node, symbol *ast.Symbol) bool {
	for _, hook := range entityNameVisibilityHooks {
		if hook(c, entityName, symbol) {
			return true
		}
	}
	return false
}

// CopiedNameHook reports whether the declaration file of file must not write
// name, which resolves to symbol there, when it copies a type node from
// another file that starts with name. The node builder then treats name as
// out of scope, as TypeScript treats a name the file does not import, and
// writes import("module").Type. A name resolution hook can put a name in scope
// that the source never wrote.
type CopiedNameHook func(c *Checker, file *ast.SourceFile, name string, symbol *ast.Symbol) bool

var copiedNameHooks []CopiedNameHook

// RegisterCopiedNameHook adds hook to every checker. Call it only from the
// init function of an in-tree package that tsc/cmd/tsc imports; registration
// is not synchronized.
func RegisterCopiedNameHook(hook CopiedNameHook) {
	copiedNameHooks = append(copiedNameHooks, hook)
}

func (c *Checker) copiedNameOutOfScope(file *ast.SourceFile, name *ast.Node, symbol *ast.Symbol) bool {
	if from := ast.GetSourceFileOfNode(name); symbol == nil || from == nil || from == file {
		return false
	}
	for _, hook := range copiedNameHooks {
		if hook(c, file, name.Text(), symbol) {
			return true
		}
	}
	return false
}

// ModuleNameHook lets a declaration file write a type from module, a module
// no declaration of file imports, through a name, Name.Type, instead of an
// import type, import("module").Type. It returns an identifier, made with
// newIdentifier, that names module in file, or nil. A hook that returns one
// must make the declaration file import that name.
type ModuleNameHook func(c *Checker, file *ast.SourceFile, module *ast.Symbol, newIdentifier func(name string) *ast.Node) *ast.Node

var moduleNameHooks []ModuleNameHook

// RegisterModuleNameHook adds hook to every checker. Call it only from the
// init function of an in-tree package that tsc/cmd/tsc imports; registration
// is not synchronized.
func RegisterModuleNameHook(hook ModuleNameHook) {
	moduleNameHooks = append(moduleNameHooks, hook)
}

func (c *Checker) moduleNameFromHooks(file *ast.SourceFile, module *ast.Symbol, newIdentifier func(name string) *ast.Node) *ast.Node {
	for _, hook := range moduleNameHooks {
		if name := hook(c, file, module, newIdentifier); name != nil {
			return name
		}
	}
	return nil
}

// unwrapReturnTypeOf returns the type that what fn returns is checked
// against, given returnType, fn's return type: the type an async function or
// a generator wraps, as unwrapReturnType says, unless a hook says otherwise.
func (c *Checker) unwrapReturnTypeOf(fn *ast.Node, returnType *Type) *Type {
	t := c.unwrapReturnType(returnType, ast.GetFunctionFlags(fn))
	for _, hook := range unwrappedReturnTypeHooks {
		t = hook(c, fn, t)
	}
	return t
}

// UnwrappedReturnTypeHook can replace t, the type that the return statements
// and expression body of fn, a function with a return type annotation, are
// checked against. TypeScript checks what an async function returns against
// the type its Promise wraps; an extension can unwrap its own types the same
// way.
type UnwrappedReturnTypeHook func(c *Checker, fn *ast.Node, t *Type) *Type

var unwrappedReturnTypeHooks []UnwrappedReturnTypeHook

// RegisterUnwrappedReturnTypeHook adds hook to every checker. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterUnwrappedReturnTypeHook(hook UnwrappedReturnTypeHook) {
	unwrappedReturnTypeHooks = append(unwrappedReturnTypeHooks, hook)
}

// AnnotatedReturnTypeHook can replace t, the return type that the return type
// annotation of fn declares, as the return type of fn's signature.
type AnnotatedReturnTypeHook func(c *Checker, fn *ast.Node, t *Type) *Type

var annotatedReturnTypeHooks []AnnotatedReturnTypeHook

// RegisterAnnotatedReturnTypeHook adds hook to every checker. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterAnnotatedReturnTypeHook(hook AnnotatedReturnTypeHook) {
	annotatedReturnTypeHooks = append(annotatedReturnTypeHooks, hook)
}

func (c *Checker) applyAnnotatedReturnTypeHooks(fn *ast.Node, t *Type) *Type {
	for _, hook := range annotatedReturnTypeHooks {
		t = hook(c, fn, t)
	}
	return t
}

// ResolvingReturnTypeHook can give the return type of call's signature while
// the checker is resolving that return type, instead of the circularity error
// (TS2577) reading it there would report. VibeLang reads a contract's inferred
// channels from the function's body, and a call of the function in its own
// body, such as n * fact(n - 1), asks for that contract (D52, D57). It returns
// nil when it has nothing to say.
type ResolvingReturnTypeHook func(c *Checker, call *ast.Node, signature *Signature) *Type

var resolvingReturnTypeHooks []ResolvingReturnTypeHook

// RegisterResolvingReturnTypeHook adds hook to every checker. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterResolvingReturnTypeHook(hook ResolvingReturnTypeHook) {
	resolvingReturnTypeHooks = append(resolvingReturnTypeHooks, hook)
}

// resolvingReturnTypeOfCall returns what a hook gives call when the return
// type of signature, or of the declared signature it instantiates, is being
// resolved, and nil otherwise.
func (c *Checker) resolvingReturnTypeOfCall(call *ast.Node, signature *Signature) *Type {
	if len(resolvingReturnTypeHooks) == 0 {
		return nil
	}
	declared := signature
	if declared.target != nil {
		declared = declared.target
	}
	if declared.target != nil || declared.getComposite() != nil || !c.isResolvingReturnTypeOfSignature(declared) {
		return nil
	}
	for _, hook := range resolvingReturnTypeHooks {
		if t := hook(c, call, declared); t != nil {
			if declared != signature {
				t = c.instantiateType(t, signature.mapper)
			}
			return t
		}
	}
	return nil
}

// InferTypeHook reports whether an extension gives node, an infer type
// outside the extends clause of a conditional type, a meaning in its
// position. The checker then reports neither that position nor the unused
// name.
type InferTypeHook func(c *Checker, node *ast.Node) bool

var inferTypeHooks []InferTypeHook

// RegisterInferTypeHook adds hook to every checker. Call it only from the init
// function of an in-tree package that tsc/cmd/tsc imports; registration is not
// synchronized.
func RegisterInferTypeHook(hook InferTypeHook) {
	inferTypeHooks = append(inferTypeHooks, hook)
}

func (c *Checker) inferTypeHasExtensionMeaning(node *ast.Node) bool {
	for _, hook := range inferTypeHooks {
		if hook(c, node) {
			return true
		}
	}
	return false
}

// GetReturnTypeFromBody returns the return type that TypeScript infers from
// the body of fn, before any inferred return type hook replaces it.
func (c *Checker) GetReturnTypeFromBody(fn *ast.Node) *Type {
	return c.getReturnTypeFromBodyWorker(fn, CheckModeNormal)
}
