package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VIP-7, decided detail 100: ordinary constructors do not extract fields.
var EK0704 = message(704, errorCategory, "{0} has no own matcher, so its extractor cannot extract values. Test the class without parentheses, then destructure its properties with an object pattern.")

func init() {
	registry[EK0704.Code] = EK0704
	fileChecks = append(fileChecks, checkOrdinaryExtractors)
	checker.RegisterCallExpressionTypeHook(ordinaryExtractorRecoveryType)
	ls.RegisterCodeFixProvider(ordinaryExtractorFix)
}

func ordinaryExtractorType(c *checker.Checker, call *ast.Node) *checker.Type {
	if !isPatternCall(call, "$extract") && !isPatternCall(call, "$is") {
		return nil
	}
	matcher := call.Arguments()[0]
	// Primitive-spelled extractors initially lower to the membership helper.
	// The written parentheses distinguish them from an admitted bare pattern,
	// even when a local class shadows String, Number, Boolean, BigInt or Symbol.
	if isPatternCall(call, "$is") {
		file := ast.GetSourceFileOfNode(call)
		if file == nil || ordinaryExtractorSpan(file, matcher).End() == matcher.End() {
			return nil
		}
	}
	if _, known := builtinMatcherOf(c, matcher); known {
		return nil
	}
	if serviceNamedBy(c, matcher) != nil {
		return nil // EK3004 reports a class pattern naming a service
	}
	constructor := c.TypeOfPatternMatcher(matcher)
	if constructor.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 ||
		len(c.GetSignaturesOfType(constructor, checker.SignatureKindConstruct)) == 0 ||
		isGlobal(c, constructor.Symbol()) {
		return nil
	}
	if symbol := constructor.Symbol(); symbol != nil {
		if declaration := symbol.ValueDeclaration(); declaration != nil {
			if form, _ := errorFormOf(declaration); form != errorFormNone {
				return nil
			}
		}
	}
	if name := customMatcherPropertyName(c); name != "" {
		if property := c.GetPropertyOfType(constructor, name); property != nil {
			for _, declaration := range property.Declarations() {
				owner := declaration.Parent
				// Inherited class matchers do not belong to the derived constructor.
				if owner == nil || !ast.IsClassLike(owner) {
					return nil
				}
				if symbol := constructor.Symbol(); symbol != nil {
					if symbol.ValueDeclaration() == owner {
						return nil
					}
					if owner.Name() != nil {
						if declaring := c.GetSymbolAtLocation(owner.Name()); declaring != nil &&
							c.GetMergedSymbol(declaring) == c.GetMergedSymbol(symbol) {
							return nil
						}
					}
				}
			}
		}
	}
	return constructor
}

// A rejected extractor has no extracted tuple. Recover its synthesized helper
// as any so tuple indices and arity comparisons do not add generated errors;
// source expressions and arm bodies keep their own native diagnostics.
func ordinaryExtractorRecoveryType(c *checker.Checker, call *ast.Node, t *checker.Type) *checker.Type {
	if ordinaryExtractorType(c, call) != nil {
		return c.GetAnyType()
	}
	return t
}

// The generated helper spans only the first pattern token. Scan the written
// argument list to report and replace the complete extractor, including ().
func ordinaryExtractorSpan(file *ast.SourceFile, matcher *ast.Node) core.TextRange {
	start := scanner.SkipTrivia(file.Text(), matcher.Pos())
	s := scanner.NewScanner()
	s.SetText(file.Text())
	s.ResetPos(matcher.End())
	if s.Scan() != ast.KindOpenParenToken {
		return core.NewTextRange(start, matcher.End())
	}
	depth := 1
	for depth > 0 {
		switch s.Scan() {
		case ast.KindOpenParenToken:
			depth++
		case ast.KindCloseParenToken:
			depth--
		case ast.KindEndOfFile:
			return core.NewTextRange(start, matcher.End())
		}
	}
	return core.NewTextRange(start, s.TokenEnd())
}

func checkOrdinaryExtractors(c *checker.Checker, file *ast.SourceFile) {
	seen := map[core.TextRange]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ordinaryExtractorType(c, node) != nil {
			matcher := node.Arguments()[0]
			span := ordinaryExtractorSpan(file, matcher)
			if !seen[span] {
				seen[span] = true
				note(reportAt(c, file, span, EK0704, file.Text()[span.Pos():matcher.End()]),
					"Use a bare class pattern, or match its parameter properties with an object pattern.")
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func ordinaryExtractorBindings(file *ast.SourceFile, matcher *ast.Node, span core.TextRange) ([]int, core.TextRange, bool) {
	s := scanner.NewScanner()
	s.SetText(file.Text())
	s.ResetPos(matcher.End())
	if s.Scan() != ast.KindOpenParenToken {
		return nil, core.TextRange{}, false
	}
	insideStart := s.TokenEnd()
	var starts []int
	token := s.Scan()
	for token != ast.KindCloseParenToken {
		if token != ast.KindLetKeyword && token != ast.KindConstKeyword && token != ast.KindVarKeyword {
			return nil, core.TextRange{}, false
		}
		starts = append(starts, s.TokenStart())
		if s.Scan() != ast.KindIdentifier {
			return nil, core.TextRange{}, false
		}
		token = s.Scan()
		if token == ast.KindCommaToken {
			token = s.Scan()
		} else if token != ast.KindCloseParenToken {
			return nil, core.TextRange{}, false
		}
	}
	return starts, core.NewTextRange(insideStart, s.TokenStart()), s.TokenEnd() == span.End()
}

func ordinaryExtractorProperties(c *checker.Checker, constructor *checker.Type) []string {
	symbol := constructor.Symbol()
	if symbol == nil || symbol.ValueDeclaration() == nil || !ast.IsClassLike(symbol.ValueDeclaration()) {
		return nil
	}
	for _, member := range symbol.ValueDeclaration().Members() {
		if member.Kind != ast.KindConstructor || member.Body() == nil {
			continue
		}
		var names []string
		for _, parameter := range member.Parameters() {
			if ast.IsParameterPropertyDeclaration(parameter, member) && ast.IsIdentifier(parameter.Name()) {
				names = append(names, parameter.Name().Text())
			}
		}
		return names
	}
	return nil
}

var ordinaryExtractorFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK0704.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		var actions []*ls.CodeAction
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if constructor := ordinaryExtractorType(c, node); constructor != nil {
				matcher := node.Arguments()[0]
				span := ordinaryExtractorSpan(fix.SourceFile, matcher)
				if span == fix.Span {
					bare := fix.SourceFile.Text()[span.Pos():matcher.End()]
					action := func(description, text string) *ls.CodeAction {
						return &ls.CodeAction{Description: description, Changes: []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: text}}}
					}
					if bindings, inside, ok := ordinaryExtractorBindings(fix.SourceFile, matcher, span); ok && len(bindings) != 0 {
						properties := ordinaryExtractorProperties(c, constructor)
						if len(properties) == len(bindings) {
							// Insert property keys without discarding argument comments or line breaks.
							text := fix.SourceFile.Text()
							var body strings.Builder
							pos := inside.Pos()
							for i, start := range bindings {
								body.WriteString(text[pos:start])
								body.WriteString(properties[i] + ": ")
								pos = start
							}
							body.WriteString(text[pos:inside.End()])
							beforeOpen := text[matcher.End() : inside.Pos()-1]
							actions = append(actions, action("Write the class test and its parameter properties", bare+" and "+beforeOpen+"{ "+body.String()+" }"))
						}
					}
					// --fix applies the first action, and a "Write" title names
					// the rewrite it applies; the bare test is the alternative
					// only where the parameter properties can be matched.
					if len(actions) == 0 {
						actions = append(actions, action("Write the bare class test", bare))
					} else {
						actions = append(actions, action("Test the class without extracting values", bare))
					}
					return true
				}
			}
			return node.ForEachChild(visit)
		}
		fix.SourceFile.AsNode().ForEachChild(visit)
		return actions, nil
	},
}
