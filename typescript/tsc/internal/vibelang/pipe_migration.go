package vibelang

// D382/D383: D110 survives only as a recorder and a migration. No answer
// from this file participates in expression typing, form selection or emit.
import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() {
	checker.RegisterDiagnosticsFilterHook(pipeMigrationDiagnostics)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{1023}, GetCodeActions: pipeMigrationActions})
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: []int32{2345, 2769}, GetCodeActions: pipeMigrationActions})
}

type pipeMigrationNotesKey struct{}

// Keep TypeScript's error where the new value reading does not fit. Where
// it still fits, EK1023 prevents the silent change. Notes are attached once
// even when an editor requests the same diagnostics repeatedly.
func pipeMigrationDiagnostics(c *checker.Checker, file *ast.SourceFile, ds []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return ds
	}
	noted := c.ExtensionState(pipeMigrationNotesKey{}, func() any { return map[*ast.Diagnostic]bool{} }).(map[*ast.Diagnostic]bool)
	for _, site := range legacyPipeSites(c, file) {
		if site.Kind != LegacyPipeLookAhead {
			continue
		}
		call, _ := ownerCall(site.Node)
		var d *ast.Diagnostic
		for _, candidate := range ds {
			if candidate.Source() == "" && candidate.Category() == diagnostics.CategoryError && call.Pos() <= candidate.Pos() && candidate.End() <= call.End() {
				d = candidate
				break
			}
		}
		if d == nil {
			d = newDiagnostic(optionsFor(c, file), site.Node, EK1023)
			ds = append(slices.Clone(ds), d)
		} else {
			if noted[d] {
				continue
			}
			noted[d] = true
		}
		// fix-snippets.ts recognizes a migration by this note's first words.
		note(d, "Through VibeLang 0.0.10, pipe took this first argument as a program. To keep that meaning, hold the first argument as a program with its type written, const first: A!E!R = () => …, and pass first. vibelang --fix writes it and builds the stages in their original order.")
		if rewrite := pipeMigrationRewrite(c, file, call); rewrite.why != "" {
			note(d, "{0}", rewrite.why)
		}
	}
	return ds
}

func pipeMigrationActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	for _, site := range legacyPipeSites(c, fix.SourceFile) {
		if site.Kind != LegacyPipeLookAhead {
			continue
		}
		call, _ := ownerCall(site.Node)
		if call.Pos() <= fix.Span.Pos() && fix.Span.End() <= call.End() {
			r := pipeMigrationRewrite(c, fix.SourceFile, call)
			if !r.fixable() {
				return nil, nil
			}
			e := r.edits[0]
			return []*ls.CodeAction{{Description: "Preserve the legacy pipe program", Changes: replaceRange(fix, e.start, e.end, e.text)}}, nil
		}
	}
	return nil, nil
}

// Bind the program and all observable stage operands in their original
// construction order. Effect's pure dual constructors can be written in
// data-first form, retaining contextual typing of generic callbacks. Other
// stage values are bound once. Only the application of an earlier program
// stage moves inside the next program, as in the approved nested-call rewrite.
func pipeMigrationRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	refuse := func(why string) *formRewrite {
		return &formRewrite{why: "This pipe cannot be fixed automatically: " + why}
	}
	a := analyzerFor(c)
	first := a.legacyPipeFirst(call)
	if first == nil {
		return refuse("the legacy first argument could not be classified.")
	}
	if call.TypeArguments() != nil || ast.IsOptionalChain(call) {
		return refuse("explicit type arguments or an optional call need an explicit signature.")
	}
	for _, arg := range call.Arguments() {
		if ast.IsSpreadElement(arg) {
			return refuse("a spread stage needs an explicit signature.")
		}
	}
	signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(first), checker.SignatureKindCall)
	if len(signatures) != 1 || len(signatures[0].TypeParameters()) != 0 {
		return refuse("the program's signature is incomplete.")
	}
	returned := c.GetReturnTypeOfSignature(signatures[0])
	if !isEffectType(c, returned) {
		returned = c.GetWidenedType(c.GetBaseTypeOfLiteralType(returned))
	}
	programType := bangTypes(c.TypeToString(returned))
	if !isEffectType(c, returned) {
		programType = "(" + programType + ")!!"
	}
	next := 0
	fresh := func() string {
		for {
			name := fmt.Sprintf("$pipe%d", next)
			next++
			if !strings.Contains(file.Text(), name) {
				return name
			}
		}
	}
	indent := lineIndent(file.Text(), nodeStart(file, call))
	var bindings []string
	bind := func(text, annotation string) string {
		name := fresh()
		bindings = append(bindings, "const "+name+annotation+" = "+text)
		return name
	}
	program := expressionText(file, call.Arguments()[0])
	if !isLambda(first) {
		// A stored function has no destination conversion in a variable
		// initializer. Capture it now, then make its program explicit.
		program = "() => " + bind(program, "") + "()"
	}
	previous := bind(program, ": "+programType)
	for i, argument := range call.Arguments()[1:] {
		stage := ast.SkipParentheses(argument)
		signatures := a.legacyStageSignatures(stage)
		if len(signatures) == 0 {
			return refuse("a stage's signature is incomplete.")
		}
		for _, sig := range signatures {
			if i > 0 {
				if len(sig.Parameters()) == 0 {
					return refuse("a stage has no program parameter.")
				}
				e := a.classify([]*checker.Type{c.GetTypeOfSymbol(sig.Parameters()[0])})
				if !e.program || e.plainFn || e.effectFn {
					return refuse("a later stage can consume the intermediate program as data; choose an explicit signature.")
				}
			}
			if i < len(call.Arguments())-2 {
				if !isEffectType(c, c.GetReturnTypeOfSignature(sig)) {
					return refuse("an intermediate stage does not definitely return an Effect.")
				}
				declaration := sig.Declaration()
				if declaration == nil {
					return refuse("an intermediate stage's construction cannot be classified.")
				}
				source := ast.GetSourceFileOfNode(declaration)
				if !strings.Contains(source.FileName().AsString(), "/node_modules/effect/") &&
					(!isLowerable(declaration) || a.isFactory(declaration)) {
					return refuse("an intermediate stage may do work while building its program.")
				}
			}
		}
		input := previous
		if i > 0 {
			input = "() => " + previous
		}
		direct := -1
		if ast.IsCallExpression(stage) && stage.TypeArguments() == nil && !ast.IsOptionalChain(stage) {
			module, _ := effectMember(c, stage.Expression())
			if module != "" {
				for _, sig := range c.GetSignaturesOfType(c.GetTypeAtLocation(stage.Expression()), checker.SignatureKindCall) {
					if len(sig.Parameters()) != len(stage.Arguments())+1 {
						continue
					}
					for index, param := range sig.Parameters() {
						if a.isExpectedEffect(c.GetTypeOfSymbol(param)) {
							direct = index
							break
						}
					}
					if direct >= 0 {
						break
					}
				}
			}
			for _, arg := range stage.Arguments() {
				fn := ast.SkipParentheses(arg)
				// A named function can observe its own identity across runs.
				// Recreating it inside an outer program would change that.
				if i < len(call.Arguments())-2 && ast.IsFunctionExpression(fn) && fn.Name() != nil {
					return refuse("a named callback's identity must be preserved across runs; bind it before the pipe.")
				}
				if ast.IsSpreadElement(arg) || unsafePipeStageArgument(c, arg) {
					return refuse("a stage argument calls code outside .vibe and effect, or uses a spread; moving it into a program cannot be proved exact.")
				}
			}
		}
		if direct >= 0 {
			var args []string
			for _, arg := range stage.Arguments() {
				text := expressionText(file, arg)
				// Function bodies do not run during construction. Keep literals in
				// place so the data-first signature still supplies their context.
				if a.finalConversion(ast.SkipParentheses(arg)) == convertByName {
					// D147 still applies to the stage's own arguments in S4.
					// Capturing its success value would run it during construction.
					t := c.GetTypeAtLocation(arg)
					text = bind("() => ("+text+")", ": "+bangTypes(c.TypeToString(t)))
				} else if !isLambda(ast.SkipParentheses(arg)) && !ast.IsLiteralExpression(arg) {
					text = bind(text, "")
				}
				args = append(args, text)
			}
			args = slices.Insert(args, direct, input)
			previous = expressionText(file, stage.Expression()) + "(" + strings.Join(args, ", ") + ")"
		} else {
			stageName := bind(expressionText(file, argument), "")
			previous = stageName + "(" + input + ")"
		}
	}
	text := "do {\n" + indent + "  " + strings.Join(bindings, "\n"+indent+"  ") + "\n" + indent + "  " + previous + "\n" + indent + "}"
	return &formRewrite{edits: []sourceEdit{{nodeStart(file, call), call.End(), text}}, description: "explicit nested program stages"}
}

func unsafePipeStageArgument(c *checker.Checker, n *ast.Node) bool {
	if isLambda(n) {
		return false
	}
	if ast.IsCallExpression(n) {
		sig := c.GetResolvedSignature(n)
		if sig == nil || sig.Declaration() == nil {
			return true
		}
		file := ast.GetSourceFileOfNode(sig.Declaration())
		if !isVibeLangFile(file) && !strings.Contains(file.FileName().AsString(), "/node_modules/effect/") {
			return true
		}
	}
	return n.ForEachChild(func(child *ast.Node) bool { return unsafePipeStageArgument(c, child) })
}

// pipeConditionalFixes parenthesizes the conditional body of each pipe that
// EK2301 rejects. Through VibeLang 0.0.11, x |> f(%) ? a : b compiled as
// x |> (f(%) ? a : b); the parser still reads it so (vibelang_pipes.go), and
// the parentheses keep that meaning.
func pipeConditionalFixes(file *ast.SourceFile, refused map[string]bool) []fileFix {
	if !isVibeLangFile(file) || !slices.ContainsFunc(file.Diagnostics(), func(d *ast.Diagnostic) bool { return d.Source() == diagnosticSource && d.Code() == 2301 }) {
		return nil
	}
	var fixes []fileFix
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsBinaryExpression(node) && node.Flags&ast.NodeFlagsVibeLang != 0 && node.AsBinaryExpression().OperatorToken.Kind == ast.KindBarToken {
			if body := node.AsBinaryExpression().Right; body.Kind == ast.KindConditionalExpression {
				start := nodeStart(file, body)
				key := fmt.Sprintf("pipeConditional:%d", start)
				if !refused[key] {
					fixes = append(fixes, fileFix{code: 2301, edits: []sourceEdit{{start, start, "("}, {body.End(), body.End(), ")"}}, key: key})
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return fixes
}

func pipeMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool, refuse func(FixRefusal, string)) proposal {
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	candidates := pipeConditionalFixes(file, refused)
	for _, site := range legacyPipeSites(c, file) {
		if site.Kind != LegacyPipeLookAhead {
			continue
		}
		call, _ := ownerCall(site.Node)
		key := "pipeLookAhead:" + expressionText(file, call)
		if refused[key] {
			continue
		}
		r := pipeMigrationRewrite(c, file, call)
		if !r.fixable() {
			line, _ := scannerLineOf(file, site.Span.Pos())
			refuse(FixRefusal{File: file.FileName(), Line: line + 1, Code: 1023, Error: r.why}, key)
			continue
		}
		candidates = append(candidates, fileFix{code: 1023, edits: r.edits, key: key})
	}
	// Innermost sites first. Rechecking each round discovers the outer site
	// with its updated source, rather than applying overlapping stale edits.
	slices.SortStableFunc(candidates, func(x, y fileFix) int { return x.edits[0].end - x.edits[0].start - (y.edits[0].end - y.edits[0].start) })
	p := proposal{file: file}
	var taken []sourceEdit
	for _, candidate := range candidates {
		if !overlapsAny(candidate.edits[0], taken) {
			p.fixes = append(p.fixes, candidate)
			taken = append(taken, candidate.edits...)
		}
	}
	return p
}
