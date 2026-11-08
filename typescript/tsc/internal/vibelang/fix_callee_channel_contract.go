package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const calleeChannelContractFixTitle = "Preserve the error channel with an explicit return contract"

// VIP-1/VIP-27: native yield-union inference can absorb an error subclass.
// A tagged catch that relied on the old inferred union can retain that API
// with a written contract. Only repair an actual native catch diagnostic;
// ordinary inference and already written contracts remain untouched.
func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		ErrorCodes: []int32{2339, 2345, 2769},
		GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			if fix.Program == nil || fix.SourceFile == nil || !isVibeLangFile(fix.SourceFile) {
				return nil, nil
			}
			c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
			defer done()
			_, rewrite := calleeChannelContractAt(c, fix.SourceFile, fix.Span.Pos(), fix.Span.End())
			if !rewrite.fixable() {
				return nil, nil
			}
			var changes []*lsproto.TextEdit
			for _, edit := range rewrite.edits {
				changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
			}
			return []*ls.CodeAction{{Description: calleeChannelContractFixTitle, Changes: changes}}, nil
		},
	})
}

// Find a data-first catch or an Effect's pipe.
// The operation must resolve to Effect's export, including imported aliases.
func calleeChannelContractAt(c *checker.Checker, file *ast.SourceFile, pos, end int) (*ast.Node, *formRewrite) {
	var input, tag *ast.Node
	tagCatch := func(call *ast.Node) bool {
		if !ast.IsCallExpression(call) {
			return false
		}
		module, name := effectMember(c, call.Expression())
		return module == "Effect" && name == "catchTag"
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if nodeStart(file, n) > pos || n.End() < end {
			return false
		}
		if ast.IsCallExpression(n) {
			switch {
			case tagCatch(n) && len(n.Arguments()) == 3:
				input, tag = n.Arguments()[0], n.Arguments()[1]
			case ast.IsPropertyAccessExpression(n.Expression()) && n.Expression().Name().Text() == "pipe":
				for _, arg := range n.Arguments() {
					if tagCatch(arg) && len(arg.Arguments()) == 2 && arg.Pos() <= pos && end <= arg.End() {
						input, tag = n.Expression().Expression(), arg.Arguments()[0]
					}
				}
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if input == nil || tag == nil || !ast.IsStringLiteral(tag) || !ast.IsCallExpression(ast.SkipParentheses(input)) {
		return nil, nil
	}
	input = ast.SkipParentheses(input)
	sig := c.GetResolvedSignature(input)
	if sig == nil || sig.Target() != nil {
		return nil, nil
	}
	fn := implementationOf(sig.Declaration())
	a := analyzerFor(c)
	if fn == nil || sig.Declaration() != fn || ast.GetSourceFileOfNode(fn) != file || fn.Type() != nil || fn.Body() == nil || len(fn.TypeParameters()) != 0 || isProgramArrow(fn) || !a.isEffect(fn) {
		return nil, nil
	}
	info := a.effectOf(fn)
	if info == nil || a.recursive[fn] {
		return nil, nil
	}
	returned := c.GetReturnTypeOfSignature(sig)
	effect := effectInterface(c, returned)
	currentE := channelType(c, returned, "_E")
	if effect == nil || currentE == nil {
		return nil, nil
	}
	legacyE := beforeInfallibleCalleeRuns(a, fn, info, effect)
	if legacyE == nil {
		return nil, nil
	}
	tags := func(t *checker.Type) *checker.Type {
		var values []*checker.Type
		for _, part := range t.Distributed() {
			if property := c.GetPropertyOfType(part, "_tag"); property != nil {
				values = append(values, c.GetTypeOfSymbol(property))
			}
		}
		return c.GetUnionType(values)
	}
	requested := c.GetTypeAtLocation(tag)
	if !c.IsTypeAssignableTo(requested, tags(legacyE)) || c.IsTypeAssignableTo(requested, tags(currentE)) {
		return nil, nil
	}
	if legacyE == currentE || !c.IsTypeAssignableTo(legacyE, currentE) || !c.IsTypeAssignableTo(currentE, legacyE) {
		return nil, nil
	}
	at := returnTypePosition(file, fn)
	if at < 0 {
		return nil, nil
	}
	preserve := c.NewTypeReference(effect, []*checker.Type{successType(c, returned), legacyE, channelType(c, returned, "_R")})
	text := c.TypeToStringEx(preserve, fn, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
	return fn, &formRewrite{description: calleeChannelContractFixTitle, edits: []sourceEdit{{at, at, ": " + text}}}
}

// beforeInfallibleCalleeRuns replays the previous union inference for this
// repair's narrow case. Infallible Vibe callees added no error rows and no
// runs. Keep all foreign and annotated runs: they may already have reduced
// the error union before the inference fix. Count identical triples so a
// foreign run equal to a Vibe run is still kept.
func beforeInfallibleCalleeRuns(a *analyzer, fn *ast.Node, info *effectInfo, effect *checker.Type) *checker.Type {
	c := a.checker
	omit := map[effectRun]int{}
	supported := true
	a.forEachRunningCallInBody(fn, func(call *ast.Node) bool {
		if !a.runs(call) {
			return false
		}
		sig := a.callSignature(call)
		if sig == nil || sig.Target() != nil {
			return false
		}
		callee := implementationOf(sig.Declaration())
		if callee == nil || !isLowerable(callee) || !a.isEffect(callee) || isProgramArrow(callee) {
			return false
		}
		if k := a.contractOf(callee); k != nil && !k.inferredAny() {
			return false
		}
		if a.effects[callee] == nil || a.recursive[callee] || c.IsResolvingReturnTypeOf(sig) {
			return false
		}
		t := runningCallResult(c, call, sig)
		run := effectRun{channelType(c, t, "_A"), channelType(c, t, "_E"), channelType(c, t, "_R")}
		if ownerFunction(call) != fn || run.success == nil || run.errors == nil || run.requirements == nil || run.errors.Flags()&checker.TypeFlagsNever == 0 {
			supported = false
			return true
		}
		omit[run]++
		return false
	})
	if !supported || len(omit) == 0 {
		return nil
	}
	previous := *info
	previous.runs = make([]effectRun, 0, len(info.runs))
	removed := false
	for _, run := range info.runs {
		if omit[run] > 0 {
			omit[run]--
			removed = true
		} else {
			previous.runs = append(previous.runs, run)
		}
	}
	if !removed {
		return nil
	}
	errors, _ := a.channelUnions(&previous, effect)
	return errors
}
