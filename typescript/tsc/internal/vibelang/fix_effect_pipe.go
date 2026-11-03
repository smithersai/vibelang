package vibelang

import (
	"context"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// vibelang --fix writes a pipeline of Effect stages with the pipe operator
// (VIP-23), the rewrite a migration from Effect TypeScript needs most
// after yield*, since a .pipe on a call reads as piping its success value
// (EK4502):
//
//	load(id).pipe(                      load(id)
//	  Effect.map(toUser),                 |> Effect.map(%, toUser)
//	  Effect.retry(policy),               |> Effect.retry(%, policy)
//	  Effect.asVoid,                      |> Effect.asVoid(%)
//	  audit("load"),                      |> audit("load")(%)
//	)
//
// A stage that names an effect export with a data-first signature takes the
// topic as its first argument, and any other stage is applied to it, as
// .pipe applied it. Each stage still receives what the stage before it
// returned, and the arguments of a stage are evaluated after the stages
// before it were applied, which only an effect constructor separates from
// their order in .pipe: both build programs, and building one runs nothing.
// It rewrites a .pipe whose receiver is an Effect or that has a stage of
// Effect's own module. Any other .pipe, such as a Stream's or a Schema's,
// keeps its meaning and stays.

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4502.Code}, GetCodeActions: effectPipeActions})
}

func effectPipeActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	call := tsFormNodeAt(fix.SourceFile, fix.Span, isPipeCall)
	if call == nil {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	rewrite := planEffectPipe(c, fix.SourceFile, call)
	if !rewrite.fixable() {
		return nil, nil
	}
	var changes = replaceRange(fix, rewrite.edits[0].start, rewrite.edits[0].end, rewrite.edits[0].text)
	for _, edit := range rewrite.edits[1:] {
		changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
	}
	return []*ls.CodeAction{{Description: "Write " + rewrite.description, Changes: changes}}, nil
}

// isPipeCall reports whether node is x.pipe(…) as the source writes it, not
// a pipe the parser wrote for x |> f(%).
func isPipeCall(node *ast.Node) bool {
	if !ast.IsCallExpression(node) || node.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) != 0 {
		return false
	}
	callee := node.Expression()
	return ast.IsPropertyAccessExpression(callee) && callee.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) == 0 &&
		ast.IsIdentifier(callee.Name()) && callee.Name().Text() == "pipe" && callee.Name().Flags&ast.NodeFlagsReparsed == 0
}

// isEffectPipeline reports whether call, a .pipe, carries an Effect through
// its stages.
func isEffectPipeline(c *checker.Checker, call *ast.Node) bool {
	for _, stage := range call.Arguments() {
		callee := ast.SkipParentheses(stage)
		if ast.IsCallExpression(callee) {
			callee = callee.Expression()
		}
		if module, _ := effectMember(c, callee); module == "Effect" {
			return true
		}
	}
	receiver := ast.SkipParentheses(call.Expression().Expression())
	if t := c.GetTypeAtLocation(receiver); t != nil && isEffectType(c, t) {
		return true
	}
	return ast.IsCallExpression(receiver) && callReturnsEffect(c, receiver)
}

// planEffectPipe plans the rewrite of call, a .pipe of an Effect. It returns
// nil for any other call, and a refusal where a stage has no pipe form.
func planEffectPipe(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if !isPipeCall(call) || !isEffectPipeline(c, call) {
		return nil
	}
	refuse := func(why string) *formRewrite {
		return &formRewrite{why: "No quick fix: " + why + "."}
	}
	callee := call.Expression()
	stages := call.Arguments()
	if call.TypeArguments() != nil || ast.IsOptionalChain(call) || len(stages) == 0 {
		return refuse("the .pipe has type arguments, an optional chain, or no stages")
	}
	if slices.ContainsFunc(stages, ast.IsSpreadElement) {
		return refuse("a stage is a spread")
	}
	if pipeStageAliasContext(c, call) {
		return refuse("a stage needs its native .pipe context to preserve inferred type names")
	}
	if pipeStageInfersFromContext(c, call) {
		return refuse("a generic stage takes its type arguments from the .pipe, which |> would not give it")
	}
	text := file.Text()
	last := stages[len(stages)-1]
	closing := call.End() - 1
	tail := text[last.End():closing]
	if hasComment(tail) {
		return refuse("a comment stands before the .pipe's closing parenthesis")
	}
	var edits []sourceEdit
	open, close := "", ""
	if !outer(call) {
		// x.pipe(a).pipe(b) reads left to right as it stands: the pipe the
		// receiver becomes needs no parentheses.
		if pipeOperandNeedsParentheses(call) {
			open, close = "(", ")"
		}
	}
	first := nodeStart(file, stages[0])
	if gap := text[callee.Expression().End():first]; strings.ContainsAny(gap, "\r\n") || hasComment(gap) {
		parenthesis := strings.IndexByte(gap, '(')
		edits = append(edits, sourceEdit{callee.Expression().End(), callee.Expression().End() + parenthesis + 1, ""}, sourceEdit{first, first, "|> "})
	} else {
		edits = append(edits, sourceEdit{callee.Expression().End(), first, " |> "})
	}
	for i, stage := range stages {
		stageEdits, why := pipeStageEdits(c, file, stage)
		if why != "" {
			return refuse(why)
		}
		edits = append(edits, stageEdits...)
		if i == len(stages)-1 {
			break
		}
		next := nodeStart(file, stages[i+1])
		comma := separatorComma(text, stage.End(), next)
		if comma < 0 {
			return refuse("a stage's comma could not be found")
		}
		if strings.ContainsAny(text[comma:next], "\r\n") || hasComment(text[comma:next]) {
			edits = append(edits, sourceEdit{comma, comma + 1, ""}, sourceEdit{next, next, "|> "})
		} else {
			edits = append(edits, sourceEdit{comma, next, " |> "})
		}
	}
	edits = append(edits, sourceEdit{last.End(), call.End(), close})
	if open != "" {
		start := nodeStart(file, call)
		edits = append(edits, sourceEdit{start, start, open})
	}
	return &formRewrite{edits: joinEditsAt(edits), description: "the pipeline with |>"}
}

// pipeStageAliasContext reports when uncurrying would discard an alias choice
// made by .pipe's contextual stage type. Structurally equivalent types can
// declare different names (VIP-27, detail 277). Compare every stage, not only
// the final result: a following map may wrap the affected type in an array.
func pipeStageAliasContext(c *checker.Checker, call *ast.Node) bool {
	for i, stage := range call.Arguments() {
		stage = ast.SkipParentheses(stage)
		if !ast.IsCallExpression(stage) || !isDataFirstStage(c, stage) {
			continue
		}
		actual, contextual := c.GetTypeAtLocation(stage), c.GetContextualTypeForArgumentAtIndex(call, i)
		if actual == nil || contextual == nil {
			continue
		}
		for _, original := range c.GetSignaturesOfType(actual, checker.SignatureKindCall) {
			if len(original.Parameters()) == 0 {
				continue
			}
			for _, expected := range c.GetSignaturesOfType(contextual, checker.SignatureKindCall) {
				if len(expected.Parameters()) == 0 {
					continue
				}
				a, b := c.GetTypeOfSymbol(original.Parameters()[0]), c.GetTypeOfSymbol(expected.Parameters()[0])
				if !isEffectType(c, a) || !isEffectType(c, b) || a.Flags()&checker.TypeFlagsObject == 0 || b.Flags()&checker.TypeFlagsObject == 0 ||
					a.ObjectFlags()&checker.ObjectFlagsReference == 0 || b.ObjectFlags()&checker.ObjectFlagsReference == 0 {
					continue
				}
				left, right := c.GetTypeArguments(a), c.GetTypeArguments(b)
				if len(left) != 3 || len(right) != 3 {
					continue
				}
				for j, x := range left {
					y := right[j]
					if x == y || !c.IsTypeAssignableTo(x, y) || !c.IsTypeAssignableTo(y, x) {
						continue
					}
					flags := checker.TypeFormatFlagsNoTruncation | checker.TypeFormatFlagsUseFullyQualifiedType
					if c.TypeToStringEx(x, call, flags, nil) != c.TypeToStringEx(y, call, flags, nil) {
						return true
					}
				}
			}
		}
	}
	return false
}

// pipeStageInfersFromContext reports a curried generic stage whose callback
// has unannotated parameters, as observe((o) => o._tag). In .pipe the stage's
// contextual type gives its type arguments. In observe(f)(%) the call stands
// alone, so they fall back to their constraints and the program's type widens:
// Smithers' RunStore met TS2375 on { readonly _tag: string }.
func pipeStageInfersFromContext(c *checker.Checker, call *ast.Node) bool {
	for _, stage := range call.Arguments() {
		stage = ast.SkipParentheses(stage)
		if !ast.IsCallExpression(stage) || stage.TypeArguments() != nil || isDataFirstStage(c, stage) {
			continue
		}
		generic := slices.ContainsFunc(c.GetSignaturesOfType(c.GetTypeAtLocation(stage.Expression()), checker.SignatureKindCall), func(signature *checker.Signature) bool {
			return len(signature.TypeParameters()) > 0
		})
		if generic && slices.ContainsFunc(stage.Arguments(), c.IsContextSensitive) {
			return true
		}
	}
	return false
}

// joinEditsAt returns edits with an insertion and the edit that starts at the
// same offset, as a stage's (%) and the comma after it, as one edit, whose
// text keeps the insertion first.
func joinEditsAt(edits []sourceEdit) []sourceEdit {
	slices.SortStableFunc(edits, func(a, b sourceEdit) int { return a.start - b.start })
	var joined []sourceEdit
	for _, edit := range edits {
		if last := len(joined) - 1; last >= 0 && joined[last].start == edit.start {
			joined[last].end = max(joined[last].end, edit.end)
			joined[last].text += edit.text
			continue
		}
		joined = append(joined, edit)
	}
	return joined
}

// outer reports whether call, a .pipe, is the receiver of another .pipe.
func outer(call *ast.Node) bool {
	parent := call.Parent
	return parent != nil && ast.IsPropertyAccessExpression(parent) && parent.Expression() == call && parent.Parent != nil && isPipeCall(parent.Parent)
}

// pipeOperandNeedsParentheses reports whether a pipe that replaces node needs
// parentheses. |> binds after every operator but assignment, so it stands
// bare only where an assignment expression may.
func pipeOperandNeedsParentheses(node *ast.Node) bool {
	parent := node.Parent
	switch {
	case parent == nil:
		return true
	case ast.IsParenthesizedExpression(parent), ast.IsExpressionStatement(parent), ast.IsReturnStatement(parent), ast.IsArrayLiteralExpression(parent), ast.IsYieldExpression(parent), ast.IsPropertyAssignment(parent):
		return false
	case ast.IsVariableDeclaration(parent):
		return parent.Initializer() != node
	case ast.IsArrowFunction(parent):
		return parent.Body() != node
	case ast.IsCallExpression(parent), ast.IsNewExpression(parent):
		return parent.Expression() == node
	}
	return true
}

// pipeStageEdits returns the edits that write stage as a pipe's body, or why
// there are none.
func pipeStageEdits(c *checker.Checker, file *ast.SourceFile, stage *ast.Node) ([]sourceEdit, string) {
	inner := ast.SkipParentheses(stage)
	start, end := nodeStart(file, stage), stage.End()
	if ast.IsCallExpression(inner) && inner == stage {
		if inner.TypeArguments() == nil && isDataFirstStage(c, inner) {
			arguments := inner.Arguments()
			if len(arguments) == 0 {
				return []sourceEdit{{end - 1, end - 1, "%"}}, ""
			}
			if slices.ContainsFunc(arguments, ast.IsSpreadElement) {
				return nil, "a stage's argument is a spread"
			}
			at := nodeStart(file, arguments[0])
			return []sourceEdit{{at, at, "%, "}}, ""
		}
		return []sourceEdit{{end, end, "(%)"}}, ""
	}
	if ast.IsIdentifier(stage) || ast.IsPropertyAccessExpression(stage) || ast.IsElementAccessExpression(stage) || ast.IsParenthesizedExpression(stage) {
		return []sourceEdit{{end, end, "(%)"}}, ""
	}
	return []sourceEdit{{start, start, "("}, {end, end, ")(%)"}}, ""
}

// isDataFirstStage reports whether call, a data-last stage such as
// Effect.map(f), names an effect export with a signature that takes the
// program first, as Effect's dual functions' first overload does: its first
// parameter is self, and call's arguments fill the rest. A self the stage does
// not receive is not that parameter: Semaphore.withPermits(semaphore, 1) takes
// the Semaphore as self and the program last.
func isDataFirstStage(c *checker.Checker, call *ast.Node) bool {
	if module, _ := effectMember(c, call.Expression()); module == "" {
		return false
	}
	count := len(call.Arguments())
	for _, signature := range c.GetSignaturesOfType(c.GetTypeAtLocation(call.Expression()), checker.SignatureKindCall) {
		parameters := signature.Parameters()
		if len(parameters) > count && parameters[0].Name() == "self" && stageReceives(c, call, c.GetTypeOfSymbol(parameters[0])) {
			return true
		}
	}
	return false
}

// stageReceives reports whether the function call gives takes a value of the
// family of self, the type of a data-first overload's first parameter. Its
// type arguments differ between overloads, so the family is the declared type:
// Effect for Effect.map(f), and a type parameter takes anything.
func stageReceives(c *checker.Checker, call *ast.Node, self *checker.Type) bool {
	signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(call), checker.SignatureKindCall)
	if len(signatures) == 0 {
		return true
	}
	return slices.ContainsFunc(signatures, func(signature *checker.Signature) bool {
		parameters := signature.Parameters()
		if len(parameters) == 0 {
			return false
		}
		received := c.GetTypeOfSymbol(parameters[0])
		if self.Flags()&checker.TypeFlagsTypeParameter != 0 || received.Flags()&checker.TypeFlagsTypeParameter != 0 {
			return true
		}
		return slices.ContainsFunc(self.Distributed(), func(s *checker.Type) bool {
			return slices.ContainsFunc(received.Distributed(), func(r *checker.Type) bool { return s.Symbol() != nil && s.Symbol() == r.Symbol() })
		})
	})
}

// separatorComma returns the offset of the comma in text[from:to], source
// between two arguments, or -1.
func separatorComma(text string, from, to int) int {
	for i := from; i < to; i++ {
		switch {
		case strings.HasPrefix(text[i:to], "//"):
			line := strings.IndexByte(text[i:to], '\n')
			if line < 0 {
				return -1
			}
			i += line
		case strings.HasPrefix(text[i:to], "/*"):
			comment := strings.Index(text[i:to], "*/")
			if comment < 0 {
				return -1
			}
			i += comment + 1
		case text[i] == ',':
			return i
		}
	}
	return -1
}

// effectPipeFixes proposes the rewrite of each .pipe of an Effect in file.
// Edits of a nested pipe stand between its outer pipe's, so one round takes
// them together, save where two would insert at one offset.
func effectPipeFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool, refuse func(FixRefusal, string)) proposal {
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	p := proposal{file: file}
	var taken []sourceEdit
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isPipeCall(node) {
			key := "effectPipe:" + expressionText(file, node)
			if rewrite := planEffectPipe(c, file, node); rewrite != nil && !refused[key] {
				if !rewrite.fixable() {
					line, _ := scannerLineOf(file, nodeStart(file, node))
					refuse(FixRefusal{File: file.FileName(), Line: line + 1, Code: EK4502.Code, Error: rewrite.why}, key)
				} else if !slices.ContainsFunc(rewrite.edits, func(e sourceEdit) bool { return overlapsAny(e, taken) }) {
					taken = append(taken, rewrite.edits...)
					p.fixes = append(p.fixes, fileFix{code: EK4502.Code, edits: rewrite.edits, key: key})
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return p
}
