package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func init() {
	ls.RegisterCodeFixProvider(patternValueAdmissionFix)
	tsFormFixCodes = append(tsFormFixCodes, EK0702.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0702.Code)
}

// Keep the previous dynamic dispatch at the pattern's evaluation point. The
// runtime helpers retain matcher identity, hint, extraction and exceptions;
// an explicit guard makes that dynamic operation visible instead of claiming
// a static callable signature. Fresh names cannot capture a written binding.
var patternValueAdmissionFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{702},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		file, text := fix.SourceFile, fix.SourceFile.Text()
		var actions []*ls.CodeAction
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			bare, extract := isPatternCall(node, "$is"), isPatternCall(node, "$extract")
			if !bare && !extract {
				return node.ForEachChild(visit)
			}
			matcher := node.Arguments()[0]
			start := nodeStart(file, matcher)
			if start != fix.Span.Pos() || matcher.End() != fix.Span.End() {
				return node.ForEachChild(visit)
			}
			t := c.TypeOfPatternMatcher(matcher)
			if t == nil || t == c.GetErrorType() {
				return false
			}
			span := ordinaryExtractorSpan(file, matcher)
			if !extract && span.End() != matcher.End() {
				return false // a primitive-spelled extractor has a different lowering
			}
			unchecked := t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0
			if !unchecked && (!isObjectLikeMatcher(t) || hasOwnPatternMatcher(c, t) || len(c.GetCallSignatures(t))+len(c.GetConstructSignatures(t)) != 0) {
				return false
			}
			if !patternGuardPreservesReferences(c, file, node, extract) {
				return false
			}
			names := &freshNames{file: file}
			subject := names.freshName("$patternSubject")
			helper, base := "$is", "$patternIs"
			if extract {
				helper, base = "$extract", "$patternExtract"
			}
			alias := names.freshName(base)
			expression := alias + "(" + text[start:matcher.End()] + ", " + subject + ")"
			if extract {
				open := strings.IndexByte(text[matcher.End():span.End()], '(') + matcher.End()
				if open < matcher.End() || span.End() <= open {
					return false
				}
				expression = alias + "(" + text[start:matcher.End()] + text[matcher.End():open] + ", " + subject + ") is [" + text[open+1:span.End()-1] + "]"
			}
			replacement := "(let " + subject + " and if (" + expression + "))"
			insertion := retiredAwaitImportPosition(file)
			actions = append(actions, &ls.CodeAction{Description: "Preserve dynamic pattern matching with a runtime guard", Changes: []*lsproto.TextEdit{
				{Range: fix.LS.RangeOf(file, core.NewTextRange(insertion, insertion)), NewText: "\nimport { " + helper + " as " + alias + " } from \"vibelang-runtime\";\n"},
				{Range: fix.LS.RangeOf(file, span), NewText: replacement},
			}})
			return false
		}
		file.AsNode().ForEachChild(visit)
		return actions, nil
	},
}

// A runtime guard cannot carry the original pattern's narrowing to a later
// written read of its subject. Refuse that migration instead of silently
// widening an inferred public return type. An extractor migration also needs
// one helper call at that source location; the captured inline result satisfies
// this check without changing the matcher's evaluation count.
func patternGuardPreservesReferences(c *checker.Checker, file *ast.SourceFile, call *ast.Node, extractor bool) bool {
	matcher := call.Arguments()[0]
	if extractor {
		count := 0
		var countCalls func(*ast.Node) bool
		countCalls = func(n *ast.Node) bool {
			if isPatternCall(n, "$extract") && n.Arguments()[0].Loc == matcher.Loc {
				count++
			}
			return n.ForEachChild(countCalls)
		}
		file.AsNode().ForEachChild(countCalls)
		if count != 1 {
			return false
		}
	}
	subject := call.Arguments()[1]
	for {
		subject = ast.SkipParentheses(subject)
		if captured := capturedSubject(c, subject); captured != nil {
			subject = captured
			continue
		}
		if ast.IsAccessExpression(subject) {
			subject = subject.Expression()
			continue
		}
		break
	}
	if !ast.IsIdentifier(subject) && subject.Kind != ast.KindThisKeyword {
		return false
	}
	safe := true
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.Flags&ast.NodeFlagsReparsed == 0 && n.Loc != subject.Loc &&
			(ast.IsIdentifier(n) || n.Kind == ast.KindThisKeyword) && !ast.IsDeclarationName(n) && c.IsMatchingReference(n, subject) {
			safe = false
			return true
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return safe
}
