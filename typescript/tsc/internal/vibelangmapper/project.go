// Package vibelangmapper gives stock TypeScript 7 a view of VibeLang (.vibe)
// files. Project turns one file's text into virtual TypeScript plus a span
// map back to the original; Serve answers TypeScript's content mapper
// protocol (see internal/contentmapper) with that projection.
//
// Project is the only definition of what a .vibe file means to a host
// that is not the VibeLang fork: tsc, the TypeScript 7 language server, and
// later a bundler or a Volar shim all call it. It is a pure function of the
// file's text and its FileContext, the file's name and module key, because
// TypeScript caches a transform by the file's name and content and never
// tells a mapper about other files. The module key comes from package.json
// files, which the server reports as watched files.
//
// The projection builds one lowering plan per file (plan.go) and renders it.
// Its rules, in dependency order:
//
//  1. Names (names.go): the prelude names the file uses, and helper names
//     that collide with no identifier of the file.
//  2. Declarations and contracts (declarations.go): errors, services,
//     controls, D1 abstract classes, layers, readonly members (D134), and
//     A!E!R contracts, D57's infer included.
//  3. Function bodies (this file): a function with a body is an Effect
//     function unless its return annotation is a plain type (L2).
//  4. Calls in an Effect body run (L3), service member calls read the
//     service (D41), and an Effect value called with no arguments runs (D90).
//
// Some of the forms, as written and as projected:
//
//	error NotFound { id: string }   class NotFound extends TaggedError("NotFound")<{ readonly id: string }> {}
//	service Users { find(...) }     interface Users { find(...); brand } abstract class Users extends $service<Users>(key) {}
//	User!NotFound!Db                Effect.Effect<User, NotFound, Db>
//	function f(p) { body }          function f(p) { return $gen(function* () { body }) }
//	c(...)  in an Effect body       (yield* $run(c(...)))
//	throw x in an Effect body       return yield* $fail(x)
//
// Everything else passes through as verbatim text, and VibeLang syntax with no
// rule yet draws an EK9001 diagnostic. The helpers come from the prelude,
// prelude.d.ts in the vibelang-ts-mapper package, which every projected file
// imports.
package vibelangmapper

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// PreludeModule is the module every projected file imports its names from.
const PreludeModule = "vibelang-ts-mapper/prelude"

const inlineModuleProjectionMessage = "The TypeScript mapper cannot project inline modules with their ECMAScript module semantics; build with vibelang."

// Diagnostic codes the projector reports, under the source EK.
const (
	// CodePlainContractEffect marks an Effect call, or a throw that can escape, under a plain contract (D282).
	CodePlainContractEffect = 2003
	// CodeUnprojectedForm marks VibeLang syntax the projector does not lower yet.
	CodeUnprojectedForm = 9001
	// CodeVersionMismatch marks a project whose effect or @effect packages
	// differ from the versions the forms table pins (module.go). (9002 is
	// CodeExecSyntax, emit.go.)
	CodeVersionMismatch = 9004
	// CodeInvalidOption marks an invalid option of the mapper's tsconfig
	// entry (server.go, Options).
	CodeInvalidOption = 9003
)

// projectedFileName is the name the parser sees. The parser reads VibeLang
// syntax only in files whose name ends in .vibe; the name itself never
// reaches the output.
var projectedFileName = tspath.RootedFilePathFromAbsolute("/projected.vibe")

// FileContext is what a projection knows about its file besides the text.
type FileContext struct {
	// FileName is the file's absolute name, as TypeScript gives it.
	FileName string
	// ModuleKey names the file's module in the keys of the services it
	// declares, as the fork computes it (module.go): "app/src/users" for
	// src/users.vibe in the package app.
	ModuleKey string
	// Tracing is the project's tracing mode (D34, Options): "exported",
	// "all", or "". Spans change no type, so only the executable
	// rendering reads it.
	Tracing string
}

// Projection is the virtual TypeScript for one .vibe file.
type Projection struct {
	// Text is the virtual TypeScript source.
	Text string
	// Segments map Text back to the original, ordered by virtual start. Text
	// outside every segment is synthesized.
	Segments []spanmap.Segment
	// Diagnostics are the projector's own errors, in original coordinates.
	Diagnostics []Diagnostic
	// Purity says, for each top-level Effect function, whether its body is
	// provably pure or only looks plain, from syntax (purity.go).
	Purity []FunctionPurity
}

// Diagnostic is an error the projector reports about the original text.
type Diagnostic struct {
	Start   int
	Length  int
	Code    int32
	Message string
}

// env is what the walk knows about the code around a node.
type env struct {
	// holdCalls keeps untried calls as values in an operand. Explicit try
	// still runs in the enclosing Effect body.
	holdCalls bool
	rawTry    *ast.Node
	// effect reports whether the node is in an Effect body, a projected
	// function's generator, where calls run and throw fails.
	effect bool
	// frame is the generator an Effect body's code is in.
	frame *frame
	// continuation names a handle clause's continuation inside the clause.
	continuation string
	// producer reports that the generator is a producer's (producers.go):
	// yield emits, and a try statement stays the generator's own.
	producer bool
	// voidFail reports that a throw must not make A never: the function is
	// a declaration or a method that returns no value, whose TypeScript
	// return type is void even when every path throws.
	voidFail bool
}

// projector holds the state of one Project call.
type projector struct {
	file *ast.SourceFile
	text string
	// keywords are the VIP keywords lower writes over (vipKeywords).
	keywords []keyword
	ctx      FileContext
	names    *names
	plan     plan
	// plainBuiltinBodies carries proven synchronous D54 bodies for execution.
	plainBuiltinBodies map[*ast.Node][]edit
	plainBuiltin       bool
	// forms answers the L1 form decisions (forms_resolve.go).
	forms formResolver
	// sources memoizes isSource (synth.go).
	sources map[*ast.Node]bool
	// loopRegion is the loop body scopeLoopStatement is lowering inside its
	// region, which visits it there as an ordinary statement.
	loopRegion *ast.Node
	// services are the services, controls, and D1 abstract classes the file
	// declares at its top level, by name.
	services map[string]*ast.Node
	// functions are the names of the functions the file declares at its top level.
	functions map[string]bool
	// statementStarts holds the start of each expression statement in an
	// Effect body that a statement list holds, so a run that begins one can
	// guard against ASI.
	statementStarts map[int]bool
	// pipeTopics names the lexical value of each pipe's input (D154).
	pipeTopics map[*ast.Node]string
	// completions counts the completion records of region statements, for
	// their names.
	completions int
	// statement is the top-level statement being walked; reported records
	// which statements already have an EK9001, so each gets at most one.
	statement   *ast.Node
	reported    map[*ast.Node]bool
	diagnostics []Diagnostic
}

// Project returns the virtual TypeScript for the .vibe file whose text is
// text, in context ctx. It is a pure function of the two. It never fails:
// text it cannot lower passes through verbatim, and VibeLang syntax it does not
// lower yet draws an EK9001 diagnostic.
func Project(text string, ctx FileContext) Projection {
	p := lower(text, ctx)
	text = p.text // without the try keywords lower blanks
	p.brandPureExports()
	out, segments, overlap, ok := p.plan.render(checking{names: p.names}, text, p.names.importLine)
	if !ok {
		// Invalid or overlapping edits cannot render; pass the file through
		// unchanged rather than send TypeScript a broken map.
		var verbatim plan
		out, segments, _, _ = verbatim.render(checking{names: p.names}, text, func() string { return "" })
		p.diagnostics = append(p.diagnostics, Diagnostic{
			Start:   overlap,
			Code:    CodeUnprojectedForm,
			Message: "The TypeScript 7 mapper produced invalid or overlapping edits here; the file is passed through unchanged.",
		})
	}
	return Projection{Text: out, Segments: withoutKeywords(segments, p.keywords), Diagnostics: p.diagnostics, Purity: p.purity()}
}

// lower parses text and walks it in context ctx, recording the lowering
// plan that both renderings share: Project renders it for checking, and the
// executable rendering (emit) renders the same plan. It is the one place the
// walk is set up, so the two renderings never see different plans.
func lower(text string, ctx FileContext) *projector {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: projectedFileName}, text, core.ScriptKindTS)
	operandTries := tryOperandMarks(file, text)
	keywords := vipKeywords(file, text)
	if len(keywords) > 0 {
		text = blank(text, keywords)
		file = parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: projectedFileName}, text, core.ScriptKindTS)
	}
	restoreTryOperandMarks(file, text, operandTries)
	p := &projector{
		file:            file,
		text:            text,
		keywords:        keywords,
		ctx:             ctx,
		names:           newNames(file, text),
		forms:           newFormResolver(file),
		sources:         map[*ast.Node]bool{},
		services:        map[string]*ast.Node{},
		functions:       map[string]bool{},
		statementStarts: map[int]bool{},
		reported:        map[*ast.Node]bool{},
	}
	for _, statement := range file.Statements.Nodes {
		if isServiceClass(statement) || isServiceShapeClass(statement) {
			p.services[statement.Name().Text()] = statement
		}
		if statement.Kind == ast.KindFunctionDeclaration && statement.Name() != nil {
			p.functions[statement.Name().Text()] = true
		}
	}
	for _, statement := range file.Statements.Nodes {
		p.statement = statement
		p.visit(statement, env{})
	}
	p.checkSyntaxDiagnostics()
	p.checkDoControlFlow()
	p.checkCatchExpressionHatches()
	p.normalizeRegionResults()
	return p
}

// visit walks node and records the edits that lower it.
func (p *projector) visit(node *ast.Node, e env) {
	if e.holdCalls && node != e.rawTry && node.Flags&ast.NodeFlagsVibeLangTry != 0 {
		p.tryOperandExpression(node, e)
		return
	}
	if e.effect && p.programReturnBoundary(node) {
		p.returnProgram(node, e)
		return
	}
	switch {
	case ast.IsPropertyAccessExpression(node) && node.Name().Text() == "pipe" && node.Name().Flags&ast.NodeFlagsReparsed != 0 && ast.IsCallExpression(node.Parent):
		// D272: the parser contextualizes x |> g(%) as x.pipe(g).
		// Keep its source children mapped while replacing only the pipe syntax.
		call := node.Parent
		stage := call.Arguments()[0]
		p.plan.insert(p.tokenStart(node.Expression()), "(")
		p.visit(node.Expression(), e)
		p.plan.replace(node.Expression().End(), p.tokenStart(stage), ").pipe(")
		p.plan.replace(stage.End(), call.End(), ")")
		return
	case parser.IsVibeLangModuleDeclaration(node) || parser.IsVibeLangModuleReference(node):
		// D364/D366: a text-only projection cannot preserve separate-module
		// evaluation and live bindings. Refuse rather than guess a lowering.
		p.formChoice(node, inlineModuleProjectionMessage)
		return
	case node.Kind == ast.KindImportDeclaration || node.Kind == ast.KindExportDeclaration:
		p.relativeTypeScriptImport(node)
		p.visitChildren(node, e)
		return
	case isSchemaDeclaration(node) || isSchemaInterface(node) || isSchemaAliasType(node):
		p.schemaDeclaration(node)
		return
	case parser.IsDataDeclaration(node) || parser.IsDataConstructors(node) || isDataDefinition(node):
		p.dataDeclaration(node)
		return
	case isErrorDeclaration(node):
		p.errorDeclaration(node)
		return
	case isServiceShapeClass(node):
		p.serviceShapeDeclaration(node)
		return
	case hasInterleavedServiceMembers(node):
		p.interleavedServiceDeclaration(node)
		return
	case isServiceClass(node):
		p.serviceDeclaration(node)
		return
	case isServiceKeywordClass(node):
		p.serviceKeywordClass(node)
		return
	case isLayerDeclaration(node):
		p.layerDeclaration(node)
		return
	case isInferReturnContract(node):
		// f(n: number): infer _ { ... } is a plain function whose return type
		// TypeScript infers from its body; TypeScript has no infer annotation
		// outside a conditional type (TS1338), so the annotation goes.
		p.plan.replace(p.colonBefore(node), node.End(), "")
		return
	case isEffectType(node):
		p.effectType(node, false /*slotsOnly*/)
		return
	case node.Kind == ast.KindTypeReference && ast.IsIdentifier(node.AsTypeReferenceNode().TypeName) &&
		p.names.shadowsPreludeType(node.AsTypeReferenceNode().TypeName.Text()):
		// import { Effect } from "effect" binds a namespace; Effect<A, E, R>
		// as a type is still the prelude's (D4).
		name := node.AsTypeReferenceNode().TypeName
		p.plan.replace(p.tokenStart(name), name.End(), p.names.prelude(name.Text()))
		p.visitList(node.TypeArguments(), e)
		return
	case node.Kind == ast.KindPropertySignature || node.Kind == ast.KindIndexSignature:
		p.readonlyMember(node, e)
		return
	case isFiberHelper(node, "$join", 1):
		p.join(node, e)
		return
	case isFiberHelper(node, "$try", 1):
		p.tryValue(node, e)
		return
	case isFiberHelper(node, "$forConcurrent", 3):
		p.forConcurrent(node, e)
		return
	case tryOperationHelper(node) != "":
		p.tryOperation(node, e)
		return
	case awaitOperationHelper(node) != "":
		p.retiredAwaitOperation(node)
		return
	case p.isHatchCall(node):
		p.hatchCall(node, e)
		return
	case isRetiredCatchStatement(node):
		p.retiredCatchStatement(node)
		return
	case isCatchExpression(node):
		p.catchExpression(node, e)
		return
	case isPipeExpression(node):
		p.pipeExpression(node, e)
		return
	case formsIsTopic(node):
		p.pipeTopic(node)
		return
	case p.isMatchForm(node):
		p.synthesized(node, p.tokenStart(node), node.End(), e)
		return
	case p.isPlainHatchFunction(node):
		p.visitChildren(node, env{})
		return
	case ast.IsPropertyAssignment(node) && p.forms.Argument(node.Initializer()).Class == ClassProgram:
		p.visit(node.Name(), e)
		p.callArgument(node.Initializer(), e)
		return
	case ast.IsShorthandPropertyAssignment(node) && p.forms.Argument(node.Name()).Class == ClassProgram:
		p.plan.insert(p.tokenStart(node), node.Name().Text()+": ")
		p.callArgument(node.Name(), e)
		return
	case isLambda(node):
		p.lambda(node, e)
		return
	case node.Kind == ast.KindTaggedTemplateExpression && e.holdCalls:
		p.visitChildren(node, e)
		return
	case node.Kind == ast.KindCallExpression && (!e.effect || e.holdCalls || p.forms.(*Resolver).holdsProgram(node)):
		// moduleCall applies D152 outside the hatch's TypeScript island.
		p.moduleCall(node, e)
		return
	case isProducer(node):
		p.producerDeclaration(node)
		return
	case isProjectedFunction(node):
		p.functionDeclaration(node)
		return
	case node.Kind == ast.KindMethodDeclaration && ast.IsClassLike(node.Parent) && node.Body() != nil && contractOf(node.Type()) == contractPlain:
		p.functionLike(node, node.Body())
		return
	case node.Kind == ast.KindMethodDeclaration && ast.IsClassLike(node.Parent) && p.isEffectMethod(node):
		p.functionLike(node, node.Body())
		return
	case node.Flags&ast.NodeFlagsReparsed != 0:
		p.unprojected(node)
		return
	}
	if ast.IsPropertyAccessExpression(node) {
		p.checkDataMethodAccess(node)
	}
	if e.effect {
		switch {
		case isTailResume(node) && e.continuation != "":
			p.tailResume(node, e)
			return
		case node.Kind == ast.KindReturnStatement && e.frame.region != nil:
			p.returnStatement(node, e)
			return
		case node.Kind == ast.KindVariableDeclarationList && e.frame.region != nil && node.Flags&ast.NodeFlagsBlockScoped == 0:
			p.regionVar(node, e)
			return
		case node.Kind == ast.KindReturnStatement && p.isCompletionReturn(node):
			// A do expression's completion value, which the parser returns.
			p.plan.insert(p.tokenStart(node.Expression()), "return ")
			p.visit(node.Expression(), e)
			return
		case node.Kind == ast.KindBreakStatement || node.Kind == ast.KindContinueStatement:
			p.jumpStatement(node, e)
			return
		case node.Kind == ast.KindYieldExpression && e.producer:
			p.yieldExpression(node, e)
			return
		case node.Kind == ast.KindForOfStatement && node.Flags&ast.NodeFlagsReparsed == 0:
			p.forOfStatement(node, e)
			return
		case isJumpTarget(node):
			p.jumpTarget(node, e)
			return
		case node.Kind == ast.KindTryStatement && node.Flags&ast.NodeFlagsVibeLang != 0 && !e.producer:
			p.handleStatement(node, e)
			return
		case node.Kind == ast.KindTryStatement && !e.producer:
			p.tryStatement(node, e)
			return
		case isProvideBlock(node) && !e.producer:
			p.provideBlock(node, e)
			return
		case maskWord(node) != "" && !e.producer:
			p.maskBlock(node, maskWord(node), e)
			return
		case isUsingDeclaration(node):
			p.usingDeclaration(node, e)
			return
		case !e.producer && node != p.loopRegion && p.isLoopStatementRegion(node):
			p.scopeLoopStatement(node, e)
			return
		case node.Kind == ast.KindBlock && node.Flags&ast.NodeFlagsVibeLang == 0 && maskWord(node) == "" && !e.producer &&
			ownsForks(node) && p.holdsScope(node.Statements()):
			p.scopeStatement(node, e)
			return
		}
		switch node.Kind {
		case ast.KindExpressionStatement:
			if isStatementListItem(node) {
				p.statementStarts[p.tokenStart(node)] = true
			}
		case ast.KindTaggedTemplateExpression:
			p.runTemplate(node, e)
			return
		case ast.KindCallExpression:
			if isRunnableCall(node) {
				p.runCall(node, e)
				return
			}
		case ast.KindThrowStatement:
			if node.Expression() != nil {
				p.throwStatement(node, e)
				return
			}
		}
		// A nested function or class body is not part of the generator, so
		// yield* is not valid there. Only nested function declarations are
		// projected, as Effects of their own.
		if ast.IsFunctionLike(node) || ast.IsClassLike(node) {
			e.effect = false
		}
	}
	p.visitChildren(node, e)
}

// visitChildren walks node's children in order.
func (p *projector) visitChildren(node *ast.Node, e env) {
	node.ForEachChild(func(child *ast.Node) bool {
		p.visit(child, e)
		return false
	})
}

// visitList walks nodes in order.
func (p *projector) visitList(nodes []*ast.Node, e env) {
	for _, node := range nodes {
		p.visit(node, e)
	}
}

// formResolver answers the form decisions the projection needs from the
// file's syntax alone: a lambda's or method's form, a block param's
// placement, and whether an argument passes by name (L1). *Resolver
// (forms_resolve.go) implements it over the generated forms table.
type formResolver interface {
	Lambda(fn *ast.Node) Decision
	Block(call *ast.Node) Decision
	Argument(expr *ast.Node) Decision
}

// newFormResolver returns the resolver for file over the embedded forms
// table, or over an empty table if the embedded one does not read, so every
// decision falls back to L1's defaults.
func newFormResolver(file *ast.SourceFile) formResolver {
	table, err := DefaultTable()
	if err != nil {
		table = NewTable(Header{}, nil, nil)
	}
	return NewResolver(file, table)
}

// isEffectMethod reports whether method, a method of a class with a body,
// projects to an Effect function. A class that implements a service, one
// the file declares or one imported from another module, implements Effect
// contracts (D92, D128), so its instance methods are Effect functions; any
// other method takes the form its body decides (L1's defaults), or its
// return annotation's.
func (p *projector) isEffectMethod(method *ast.Node) bool {
	m := method.AsMethodDeclaration()
	if method.Body() == nil || m.AsteriskToken != nil || ast.HasSyntacticModifier(method, ast.ModifierFlagsAsync) {
		return false
	}
	if !ast.IsStatic(method) {
		for _, heritage := range ast.GetImplementsHeritageClauseElements(method.Parent) {
			name := heritage
			switch heritage.Kind {
			case ast.KindExpressionWithTypeArguments:
				name = heritage.Expression()
			case ast.KindTypeReference:
				name = heritage.AsTypeReferenceNode().TypeName
			}
			if ast.IsIdentifier(name) {
				if p.services[name.Text()] != nil || strings.HasPrefix(p.names.importedFrom[name.Text()], ".") {
					return contractOf(method.Type()) != contractPlain
				}
			}
		}
	}
	switch p.forms.Lambda(method).Form {
	case FormEffectFn, FormProgram, FormDual:
		return true
	}
	return false
}

// isStatementListItem reports whether statement sits in a list of
// statements, where a statement that starts with ( continues the previous
// line unless it starts with a semicolon. The body of an if, a loop, or a
// label follows a ) or a keyword, which ends no statement, and there a
// semicolon would end the body as an empty statement (TS1313).
func isStatementListItem(statement *ast.Node) bool {
	switch statement.Parent.Kind {
	case ast.KindBlock, ast.KindSourceFile, ast.KindCaseClause, ast.KindDefaultClause, ast.KindModuleBlock:
		return true
	}
	return false
}

// isProjectedFunction reports whether node is a function declaration that
// projects to an Effect function, or to a plain one under a plain return
// annotation: one with a braced body that is neither async nor a generator.
func isProjectedFunction(node *ast.Node) bool {
	if node.Kind != ast.KindFunctionDeclaration || node.Flags&ast.NodeFlagsReparsed != 0 {
		return false
	}
	fn := node.AsFunctionDeclaration()
	return fn.Body != nil && fn.AsteriskToken == nil && !ast.HasSyntacticModifier(node, ast.ModifierFlagsAsync)
}

// functionDeclaration lowers a function declaration with a body. Without a
// return annotation, or with an Effect contract, the body is an Effect:
// `function f(p) { return $gen(function* () { body }) }`, and stock
// TypeScript infers or checks f's Effect<A, E, R> from the generator. A
// contract with an infer channel (D57) wraps the generator in $contract
// instead of annotating. A plain return annotation keeps a plain function
// (L2), whose calls do not run. Keep the declaration itself: nested and
// block-local Effect functions must hoist even when called before their line
// or declared after a return (S21-70), just as in the fork lowering.
func (p *projector) functionDeclaration(node *ast.Node) {
	p.functionLike(node, node.Body())
	p.preparePlainBuiltinBody(node)
}

// functionLike lowers fn, a function declaration or a method with body, as
// functionDeclaration says.
func (p *projector) functionLike(fn *ast.Node, body *ast.Node) {
	if p.forms.(*Resolver).isFactory(fn) {
		p.factory(fn)
		return
	}
	open := p.tokenStart(body)
	closing := body.End() - 1
	if open >= len(p.text) || p.text[open] != '{' || closing <= open || p.text[closing] != '}' {
		// An unterminated body; TypeScript reports the syntax error itself.
		return
	}
	returnType := fn.Type()
	kind := contractOf(returnType)
	if kind != contractPlain {
		p.callbackParameters(fn)
	}
	fn.ForEachChild(func(child *ast.Node) bool {
		if child != body && child != returnType {
			p.visit(child, env{})
		}
		return false
	})
	switch kind {
	case contractPlain:
		p.checkPlainContractEffects(fn)
		p.visit(returnType, env{})
		p.visitList(body.Statements(), env{})
		return
	case contractInfer:
		// function f(p): A!infer E { body }
		// function f(p) { return $contract<A, $Infer, never>()($gen(function* () { body }))}
		colon := p.colonBefore(returnType)
		if colon < 0 {
			p.unprojected(returnType)
			return
		}
		self := selfArg(body)
		p.plan.mark(editContract, partOpen, colon, p.tokenStart(returnType), self)
		p.effectType(returnType, true /*slotsOnly*/)
		p.plan.mark(editContract, partMiddle, returnType.End(), open, self)
		p.visitList(body.Statements(), p.bodyEnv(fn, body))
		p.plan.mark(editContract, partClose, closing+1, closing+1, self)
		return
	}
	if returnType != nil {
		p.visit(returnType, env{})
	}
	p.plan.mark(editEffectBody, partOpen, open+1, open+1, selfArg(body))
	p.visitList(body.Statements(), p.bodyEnv(fn, body))
	p.plan.mark(editEffectBody, partClose, closing, closing, "")
}

// bodyEnv returns the env of fn's Effect body. A function declaration or a
// method without a return annotation whose body returns no value has the
// TypeScript return type void, even when every path throws, and the fork's
// A is that type; its throws must not make A never.
func (p *projector) bodyEnv(fn *ast.Node, body *ast.Node) env {
	e := newEffectEnv()
	if (fn.Kind == ast.KindFunctionDeclaration || fn.Kind == ast.KindMethodDeclaration) && fn.Type() == nil && !returnsValue(body) {
		e.voidFail = true
	}
	return e
}

// returnsValue reports whether body has a return statement with a value,
// outside the functions and classes nested in it.
func returnsValue(body *ast.Node) bool {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case node.Kind == ast.KindReturnStatement:
			return node.Expression() != nil
		case ast.IsFunctionLike(node) || ast.IsClassLike(node):
			return false
		}
		return node.ForEachChild(visit)
	}
	return body.ForEachChild(visit)
}

// selfArg returns the arg of an Effect body whose code refers to this, so
// its generator receives the function's this: "self", or "".
func selfArg(body *ast.Node) string {
	if usesThis(body) {
		return "self"
	}
	return ""
}

// usesThis reports whether body refers to this, looking into arrow
// functions, which share their enclosing function's this, but not into
// other functions or classes.
func usesThis(body *ast.Node) bool {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case node.Kind == ast.KindThisKeyword:
			return true
		case node.Kind == ast.KindArrowFunction:
		case ast.IsFunctionLike(node) || ast.IsClassLike(node):
			return false
		}
		return node.ForEachChild(visit)
	}
	return body.ForEachChild(visit)
}

// contractKind says what a function's return annotation makes of its body.
type contractKind uint8

const (
	// contractNone: no annotation; the body is an Effect and A, E, R are inferred.
	contractNone contractKind = iota
	// contractEffect: an Effect contract that the body is checked against.
	contractEffect
	// contractInfer: an A!E!R contract with an infer channel (D57).
	contractInfer
	// contractPlain: a plain type; the function stays plain (L2).
	contractPlain
)

// contractOf classifies a function's return annotation.
func contractOf(returnType *ast.Node) contractKind {
	switch {
	case returnType == nil:
		return contractNone
	case isEffectType(returnType) || isWrittenEffectReference(returnType):
		for _, slot := range returnType.TypeArguments() {
			if slot.Kind == ast.KindInferType {
				return contractInfer
			}
		}
		return contractEffect
	}
	return contractPlain
}

// isInferReturnContract reports whether t is a function's whole return
// annotation `infer _`, which makes the function plain, with the return type
// TypeScript infers from its body.
func isInferReturnContract(t *ast.Node) bool {
	fn := t.Parent
	return t.Kind == ast.KindInferType && fn != nil && ast.IsFunctionLikeDeclaration(fn) && fn.Type() == t
}

// isWrittenEffectReference reports whether t is Effect<...> or
// Effect.Effect<...> written as a type reference: the prelude's Effect type.
func isWrittenEffectReference(t *ast.Node) bool {
	if t.Kind != ast.KindTypeReference {
		return false
	}
	name := t.AsTypeReferenceNode().TypeName
	switch name.Kind {
	case ast.KindIdentifier:
		return name.Text() == "Effect"
	case ast.KindQualifiedName:
		q := name.AsQualifiedName()
		return q.Right.Text() == "Effect" && q.Left.Kind == ast.KindIdentifier && q.Left.Text() == "Effect"
	}
	return false
}

// colonBefore returns the position of the : that introduces annotation, or -1.
func (p *projector) colonBefore(annotation *ast.Node) int {
	for i := p.tokenStart(annotation) - 1; i >= 0; i-- {
		switch p.text[i] {
		case ':':
			return i
		case ' ', '\t', '\n', '\r':
			continue
		}
		return -1
	}
	return -1
}

// isRunnableCall reports whether call runs where it stands. Synthesized
// calls belong to VibeLang forms that have rules of their own, and import()
// and super() are not calls of a function.
func isRunnableCall(call *ast.Node) bool {
	if call.Flags&ast.NodeFlagsReparsed != 0 {
		return false
	}
	callee := call.Expression().Kind
	return callee != ast.KindImportKeyword && callee != ast.KindSuperKeyword
}

// runCall lowers a call c in an Effect body to `(yield* $run(c))`: $run runs
// an Effect, and lifts any other value to one, so every call has its success
// type (L3). A run that begins an expression statement in a statement list
// starts with a semicolon, because VibeLang code omits semicolons and a line
// that starts with ( would otherwise continue the previous one.
func (p *projector) runCall(call *ast.Node, e env) {
	if p.structuredCall(call) {
		p.discardedStructuredCall(call)
		p.moduleCall(call, e)
		return
	}
	if p.dataMethod(call, e) || p.predicateCall(call, e) {
		return
	}
	start := p.tokenStart(call)
	if p.statementStarts[start] {
		p.plan.insert(start, ";")
		delete(p.statementStarts, start)
	}
	runArg := p.programCallChannels(call)
	// Effect.service returns its key at runtime; this explicit lookup must
	// run it even though D24 keeps a key returned as data by other calls.
	if p.forms.(*Resolver).Callee(call).Canonical == "effect/Effect#service" {
		runArg = "service"
	}
	p.plan.mark(editRun, partOpen, start, start, runArg)
	scoped := p.isBlockFork(call, e)
	if scoped {
		p.plan.mark(editScoped, partOpen, start, start, "")
		p.plan.witness(p.tokenStart(call.Expression()), helperRef("$scoped")+"(")
		p.plan.witness(call.Expression().End(), ")")
	}
	if isKeywordFork(call) && (p.names.declared["fork"] || p.names.topLevel["fork"]) {
		// The keyword's callee is the prelude's fork whatever the file
		// declares (rule H5): reach it through the prelude's own import.
		callee := call.Expression()
		p.plan.replace(p.tokenStart(callee), callee.End(), p.names.prelude("fork"))
	} else {
		p.callee(call, e)
	}
	// The parser represents `fork program` as a call without source
	// parentheses. Supply them before lowering its by-name operand, so a
	// fiber held by an await operation is started once at its declaration.
	keywordFork := ast.IsIdentifier(call.Expression()) && call.Expression().Text() == "fork" &&
		len(call.Arguments()) == 1 && blockArgument(call) == nil &&
		scanner.SkipTrivia(p.text, call.Expression().End()) == p.tokenStart(call.Arguments()[0])
	if keywordFork {
		p.plan.replace(call.Expression().End(), p.tokenStart(call.Arguments()[0]), "(")
	}
	if arguments := call.Arguments(); e.continuation != "" && len(arguments) > 0 && isContinuationArgument(arguments[0]) {
		p.continuationArguments(call, e)
	} else {
		p.callArguments(call, e)
	}
	if keywordFork {
		p.plan.insert(call.End(), ")")
	}
	if scoped {
		p.plan.mark(editScoped, partClose, call.End(), call.End(), "")
	}
	p.plan.mark(editRun, partClose, call.End(), call.End(), runArg)
}

// isBlockFork reports whether call, in an Effect body, is the prelude's fork:
// the region around it owns the fiber, so the fork's Scope leaves R (D19,
// D408). A lambda's expression body is such a region too (D353).
func (p *projector) isBlockFork(call *ast.Node, e env) bool {
	return e.frame != nil && p.isPreludeForkCall(call)
}

// isKeywordFork reports whether call is the keyword fork x or fork { … },
// whose callee the parser marks an intrinsic: the prelude's fork whatever a
// scope declares (rule H5, D391).
func isKeywordFork(call *ast.Node) bool {
	callee := call.Expression()
	return ast.IsIdentifier(callee) && callee.Text() == "fork" && callee.Flags&ast.NodeFlagsVibeLangIntrinsic != 0
}

// isPreludeForkCall reports whether call calls the prelude's fork: the
// keyword form always, and fork(x) where the name means the prelude's.
func (p *projector) isPreludeForkCall(call *ast.Node) bool {
	callee := call.Expression()
	return ast.IsIdentifier(callee) && callee.Text() == "fork" && (isKeywordFork(call) || p.isPreludeFork())
}

// isPreludeFork reports whether the name fork means the prelude's fork in
// this file, or the runtime's imported by name.
func (p *projector) isPreludeFork() bool {
	if from, ok := p.names.importedFrom["fork"]; ok {
		return from == "vibelang-runtime" && p.names.declarations["fork"] == 1
	}
	return !p.names.declared["fork"]
}

// callee walks call's callee and type arguments. A member call S.m(...) on
// a name that may be a service key reads the member through $use, which adds
// the service to R (D41); a call of a name with no arguments goes through
// $value, so an Effect value, a key or a Config, runs (D90). Returned
// callees use the same adapter; member calls retain their receiver.
func (p *projector) callee(call *ast.Node, e env) {
	callee := call.Expression()
	if p.builtinCallee(call) || p.memberValueCall(call, e) {
		return
	}
	switch {
	case ast.IsPropertyAccessExpression(callee) && call.QuestionDotToken() == nil && p.mayBeServiceKey(callee.Expression()) && !p.keyOwnedMember(callee):
		receiver := callee.Expression()
		p.plan.mark(editServiceCall, partOpen, p.tokenStart(receiver), p.tokenStart(receiver), "")
		p.visit(receiver, e)
		p.plan.mark(editServiceCall, partClose, receiver.End(), receiver.End(), "")
		p.visit(callee.Name(), e)
	case len(call.Arguments()) == 0 && call.TypeArguments() == nil && call.QuestionDotToken() == nil &&
		(callee.Kind == ast.KindIdentifier && !p.functions[callee.Text()] || p.isModuleMember(callee) || ast.IsCallExpression(ast.SkipParentheses(callee))):
		p.plan.mark(editValueCall, partOpen, p.tokenStart(callee), p.tokenStart(callee), "")
		p.visit(callee, e)
		p.plan.mark(editValueCall, partClose, callee.End(), callee.End(), "")
	default:
		p.visit(callee, e)
	}
	if arguments := call.TypeArgumentList(); arguments != nil {
		p.visitList(arguments.Nodes, e)
	}
}

// isCompletionReturn reports whether node is a return the parser wrote for
// a do expression's completion value (D187), which has no return keyword
// of its own in the source.
func (p *projector) isCompletionReturn(node *ast.Node) bool {
	expression := node.Expression()
	start := p.tokenStart(node)
	return expression != nil && !startsWord(p.text[start:], "return") && p.tokenStart(expression) == start
}

// isModuleMember reports whether callee is a member of one of effect's
// modules, such as Effect.currentSpan: a namespace's member is a function
// or a value, never a method, so a call of it with no arguments can go
// through $value, which runs an Effect value (D90).
func (p *projector) isModuleMember(callee *ast.Node) bool {
	if callee.Kind != ast.KindPropertyAccessExpression || callee.QuestionDotToken() != nil {
		return false
	}
	receiver := callee.Expression()
	if receiver.Kind != ast.KindIdentifier || receiver.Flags&ast.NodeFlagsReparsed != 0 {
		return false
	}
	name := receiver.Text()
	if from, ok := p.names.importedFrom[name]; ok {
		return (from == "effect" || strings.HasPrefix(from, "effect/")) && p.names.declarations[name] == 1
	}
	return preludeNames[name] && !builtinGlobals[name] && !p.names.declared[name] && name[0] >= 'A' && name[0] <= 'Z'
}

// mayBeServiceKey reports whether receiver, the object of a member call, is
// a pinned Context key export, or a name that may hold a key. The pinned
// table recognizes package keys through aliases, including namespace
// members. $use leaves other values unchanged by a structural type/runtime
// test; no name alone is taken as proof of a service lookup.
func (p *projector) mayBeServiceKey(receiver *ast.Node) bool {
	if p.pinnedContextKey(receiver) {
		return true
	}
	if receiver.Kind != ast.KindIdentifier || receiver.Flags&ast.NodeFlagsReparsed != 0 {
		return false
	}
	name := receiver.Text()
	if name == "" || name[0] < 'A' || name[0] > 'Z' {
		return false
	}
	if p.services[name] != nil {
		return true
	}
	if from, ok := p.names.importedFrom[name]; ok {
		// effect's modules are namespaces; a key from a package is a member of one.
		return from != "effect" && !strings.HasPrefix(from, "effect/")
	}
	return !(preludeNames[name] || builtinGlobals[name] || javaScriptGlobals[name]) || p.names.declared[name]
}

// javaScriptGlobals are global objects whose members are plain functions,
// never service keys.
var javaScriptGlobals = map[string]bool{
	"Math": true, "JSON": true, "Object": true, "Promise": true, "Date": true, "Reflect": true, "Proxy": true, "Map": true,
	"Set": true, "WeakMap": true, "WeakSet": true, "Error": true, "Intl": true, "Atomics": true, "ArrayBuffer": true,
	"Uint8Array": true, "TextEncoder": true, "TextDecoder": true, "URL": true, "Buffer": true,
}

// throwStatement lowers `throw x` in an Effect body to
// `return yield* $fail(x)`, which adds x's type to the function's errors,
// or, where A must stay void (env.voidFail), to
// `return (yield* $fail(x)) as void`.
func (p *projector) throwStatement(node *ast.Node, e env) {
	start := p.tokenStart(node)
	if p.text[start:min(start+len("throw"), len(p.text))] != "throw" {
		p.unprojected(node)
		return
	}
	expression := node.Expression()
	// Replace the space after throw too: `$fail(x)`, not `$fail( x)`.
	arg := ""
	if e.voidFail {
		arg = "void"
	}
	p.plan.mark(editFail, partOpen, start, p.tokenStart(expression), arg)
	p.visit(expression, e)
	p.plan.mark(editFail, partClose, expression.End(), expression.End(), arg)
}

// unprojected records that node, a node the parser synthesized for a VibeLang
// form, has no lowering here. Its source passes through unchanged, so stock
// TypeScript will usually report a syntax error there too; EK9001 says why.
func (p *projector) unprojected(node *ast.Node) {
	if node.Kind == ast.KindReadonlyKeyword || node.Kind == ast.KindAbstractKeyword || p.reported[p.statement] {
		return
	}
	p.reported[p.statement] = true
	start := scanner.SkipTrivia(p.text, node.Pos())
	end := max(node.End(), start)
	p.diagnostics = append(p.diagnostics, Diagnostic{
		Start:   start,
		Length:  end - start,
		Code:    CodeUnprojectedForm,
		Message: "The TypeScript 7 mapper does not lower this VibeLang form yet; TypeScript sees its source text unchanged.",
	})
}

// tokenStart returns the position of node's first token, after its leading
// trivia.
func (p *projector) tokenStart(node *ast.Node) int {
	return scanner.GetTokenPosOfNode(node, p.file, false /*includeJSDoc*/)
}

// relativeTypeScriptImport implements D31 for stock checking as well as
// JavaScript: a relative .js specifier resolves its TypeScript source
// without requiring allowImportingTsExtensions in the user's project.
func (p *projector) relativeTypeScriptImport(node *ast.Node) {
	var specifier *ast.Node
	if node.Kind == ast.KindImportDeclaration {
		specifier = node.AsImportDeclaration().ModuleSpecifier
	} else {
		specifier = node.AsExportDeclaration().ModuleSpecifier
	}
	if specifier == nil || !ast.IsStringLiteral(specifier) {
		return
	}
	module := specifier.Text()
	if !strings.HasPrefix(module, ".") || !strings.HasSuffix(module, ".ts") {
		return
	}
	start := p.tokenStart(specifier)
	quote := p.text[start : start+1]
	p.plan.replace(start, specifier.End(), quote+strings.TrimSuffix(module, ".ts")+".js"+quote)
}

// runTemplate preserves native tag evaluation while applying the call run rule.
func (p *projector) runTemplate(node *ast.Node, e env) {
	start := p.tokenStart(node)
	if p.statementStarts[start] {
		p.plan.insert(start, ";")
		delete(p.statementStarts, start)
	}
	p.plan.mark(editRun, partOpen, start, start, "")
	p.visitChildren(node, e)
	p.plan.mark(editRun, partClose, node.End(), node.End(), "")
}
