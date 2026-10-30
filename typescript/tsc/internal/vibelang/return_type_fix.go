package vibelang

import (
	"context"
	"regexp"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A function without a return annotation is an Effect function, whatever its
// body does (D500), so plain code that calls or passes a helper whose body
// only computes is EK1001, EK9203 or EK4301. The quick fix of each writes the
// helper's return type, which makes it plain:
//
//	function twice(n: number) { return n * 2 }
//	export const doubled = [1, 2].map(twice)   // EK4301
//
// becomes
//
//	function twice(n: number): number { return n * 2 }
//
// The type is what TypeScript infers from the body, written `: T` when
// TypeScript prints it in at most 12 tokens and `: infer _` otherwise. A
// helper's own unannotated helpers that it calls get theirs too, since a
// plain function may not call an Effect function. vibelang --fix applies it
// (fix.go). It is not offered for an exported helper, whose TypeScript API
// it would change from a cold Effect to a plain function, nor for a helper
// whose body performs an Effect operation or lets a failure escape.

func init() {
	ls.RegisterCodeFixProvider(returnTypeFix)
	tsFormFixCodes = append(tsFormFixCodes, EK1001.Code, EK9203.Code, EK4301.Code)
}

// returnTypeFixTitle starts the title of returnTypeFix's action. vibelang
// --fix applies, for EK1001, EK9203 and EK4301, only an action with this
// title, never another fix of those codes (writtenFormCodes).
const returnTypeFixTitle = "Write the return type of "

// writtenFormCodes are the codes whose only fix vibelang --fix applies is
// returnTypeFix.
var writtenFormCodes = []int32{EK1001.Code, EK9203.Code, EK4301.Code}

// maxReturnTypeTokens is the longest return type the fix writes; a longer one
// is written `infer _` (D500).
const maxReturnTypeTokens = 12

var returnTypeFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: writtenFormCodes,
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		a := analyzerFor(c)
		node := reportedNode(fix.SourceFile, fix.Span, func(*ast.Node) bool { return true })
		helper := a.unannotatedHelperAt(node)
		if helper == nil || ast.GetSourceFileOfNode(helper) != fix.SourceFile {
			return nil, nil
		}
		helpers := a.plainHelperGroup(helper)
		if helpers == nil {
			return nil, nil
		}
		var edits []*lsproto.TextEdit
		title := ""
		for _, fn := range helpers {
			text := a.returnTypeText(fn)
			edit := returnTypeEdits(fix, fn, text)
			if edit == nil {
				return nil, nil
			}
			edits = append(edits, edit...)
			if fn == helper {
				title = returnTypeFixTitle + functionDisplayName(fn) + ": " + text
			}
		}
		return []*ls.CodeAction{{Description: title, Changes: edits}}, nil
	},
}

// unannotatedHelperAt returns the function behind node, the node a written
// form diagnostic was reported at: the function a name passes, the function a
// call calls, or, for a function that runs one, the function its first
// Effect call calls. It returns nil when that is not a .vibe function without
// a return annotation.
func (a *analyzer) unannotatedHelperAt(node *ast.Node) *ast.Node {
	if node == nil {
		return nil
	}
	var fn *ast.Node
	switch {
	case ast.IsIdentifier(node) || ast.IsPropertyAccessExpression(node):
		fn = esFunctionOf(a.checker, node)
	case isInvocation(node):
		fn = a.calledFunction(node)
	case ast.IsFunctionLike(node):
		if pause := a.firstPause(node); pause != nil {
			fn = a.calledFunction(pause)
		}
	case node.Parent != nil && ast.IsFunctionLike(node.Parent) && node.Parent.Type() == node:
		if pause := a.firstPause(node.Parent); pause != nil {
			fn = a.calledFunction(pause)
		}
	}
	if fn == nil || !isLowerable(fn) || fn.Type() != nil || fn.Body() == nil || isProducer(fn) {
		return nil
	}
	if !isWrittenForm(fn) && !isLambda(fn) {
		return nil
	}
	return fn
}

// calledFunction returns the .vibe function that call calls, or nil.
func (a *analyzer) calledFunction(call *ast.Node) *ast.Node {
	sig := a.checker.GetResolvedSignature(call)
	if sig == nil {
		return nil
	}
	return implementationOf(sig.Declaration())
}

// plainHelperGroup returns helper and the unannotated helpers it calls,
// directly or through others, when every one of them is plain but for its
// missing annotation: its body performs no Effect operation and lets no
// failure escape, the calls among them counted as plain. It returns nil when
// one is exported, or is not.
func (a *analyzer) plainHelperGroup(helper *ast.Node) []*ast.Node {
	group := []*ast.Node{helper}
	for i := 0; i < len(group); i++ {
		fn := group[i]
		if isExportedFunction(a.checker, ast.GetSourceFileOfNode(fn), fn) || hasEscapingThrow(fn) || declaresUsing(fn) || hasVibeLangStatement(fn) || a.hasStreamLoop(fn) || a.hasProgramReturn(fn) || a.hasEscapingFailure(fn) || a.isFactory(fn) {
			return nil
		}
		blocked := a.forEachRunningCallInBody(fn, func(call *ast.Node) bool {
			if holdsProgram(a.checker, call) {
				return false
			}
			if callee := a.calledFunction(call); callee != nil && isLowerable(callee) && callee.Type() == nil && callee.Body() != nil && (isWrittenForm(callee) || isLambda(callee)) && !isProducer(callee) {
				if ast.GetSourceFileOfNode(callee) != ast.GetSourceFileOfNode(helper) {
					return true // the fix edits one file
				}
				if !slices.Contains(group, callee) {
					group = append(group, callee)
				}
				return false
			}
			return a.performs(call)
		})
		if blocked {
			return nil
		}
	}
	return group
}

// typeTokens splits a type as TypeScript prints it into tokens.
var typeTokens = regexp.MustCompile(`[A-Za-z_$][\w$]*|\d+|"[^"]*"|\S`)

// returnTypeText returns the return type the fix writes for fn: what
// TypeScript infers from its body, or `infer _` when that takes more than
// maxReturnTypeTokens tokens or cannot be written in fn's file. The type is
// printed through the names that reach it from fn, so Store.Ref<string>
// stays qualified where Ref names the prelude's Ref, and a type no name
// reaches prints as import(…), which is written `infer _`.
func (a *analyzer) returnTypeText(fn *ast.Node) string {
	c := a.checker
	t := c.GetReturnTypeFromBody(fn)
	if t == nil || t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 {
		return "infer _"
	}
	text := c.TypeToStringEx(t, fn, checker.TypeFormatFlagsAllowUniqueESSymbolType, nil)
	if len(typeTokens.FindAllString(text, -1)) > maxReturnTypeTokens || containsAny(text, "import(", "typeof ", "...", "{") {
		return "infer _"
	}
	return text
}

// containsAny reports whether s contains one of subs.
func containsAny(s string, subs ...string) bool {
	return slices.ContainsFunc(subs, func(sub string) bool { return strings.Contains(s, sub) })
}

// returnTypeEdits writes `: text` after fn's parameter list, or returns nil
// when that list has no closing parenthesis, as `x => …` has.
func returnTypeEdits(fix *ls.CodeFixContext, fn *ast.Node, text string) []*lsproto.TextEdit {
	source := fix.SourceFile.Text()
	after := scanner.SkipTrivia(source, fn.ParameterList().End())
	if after >= len(source) || source[after] != ')' {
		return nil
	}
	return replaceRange(fix, after+1, after+1, ": "+text)
}
