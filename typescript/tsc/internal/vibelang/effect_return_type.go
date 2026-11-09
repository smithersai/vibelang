package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// An effect function returns an Effect, as an async function returns a
// Promise (VIP-1), so a return type written on one is an Effect type:
// effect function load(id): User!NotFound. A return type that is not an
// Effect, effect function load(id): User, is EK0106. Its quick fix writes
// the Effect of that type, User!!. For a broad any/unknown annotation on
// a body, omit the annotation instead, retaining the inferred channels.
// vibelang --fix applies these repairs through its error-preserving gate.

// EK0106: an effect function's return type that is not an Effect. {0} is
// the written type, {1} the Effect type to write instead.
var EK0106 = message(106, errorCategory, "An effect function returns an Effect, so its return type can't be {0}: write {1}, or leave the return type out.")

// inferredEffectReturn describes EK0106's repair that removes a broad
// annotation, any or unknown, so the function infers its Effect.
const inferredEffectReturn = "no return annotation (infer the Effect)"

// effectReturnTypeOmitted is EK0106's text when the repair removes the
// annotation: "write <the repair>, or leave the return type out" would say
// the same thing twice. {0} is the written type.
var effectReturnTypeOmitted = EK0106.With("An effect function returns an Effect, so its return type can't be {0}: leave the return type out, and the function infers its Effect.")

func init() {
	registry[EK0106.Code] = EK0106
	fileChecks = append(fileChecks, checkEffectReturnTypes)
	tsFormRules[EK0106.Code] = &tsFormRule{
		message: EK0106,
		find:    func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
	}
}

// isWrittenReturnTypeOfEffectFunction reports whether node is the return
// type written on an effect function. An effect function* returns a Stream
// (VIP-21), so its return type is not one.
func isWrittenReturnTypeOfEffectFunction(node *ast.Node) bool {
	fn := node.Parent
	return fn != nil && ast.IsFunctionLike(fn) && fn.Type() == node && isMarkedEffect(fn) && !isEffectBlock(fn) && ast.GetFunctionFlags(fn)&ast.FunctionFlagsGenerator == 0
}

// checkEffectReturnTypes reports EK0106 at each effect function of file
// whose written return type is not an Effect.
func checkEffectReturnTypes(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if t := node.Type(); t != nil && ast.IsFunctionLike(node) && !ast.IsIndexSignatureDeclaration(node) && isWrittenReturnTypeOfEffectFunction(t) {
			if written := c.GetTypeFromTypeNode(t); !isOneEffectType(c, written) && written != c.GetErrorType() {
				text := nodeText(file, t)
				rewrite := effectReturnTypeRewrite(c, file, t)
				omits := rewrite.description == inferredEffectReturn
				if omits {
					reportAt(c, file, tsFormSpan(file, t), effectReturnTypeOmitted, text)
				} else {
					reportAt(c, file, tsFormSpan(file, t), EK0106, text, rewrite.description)
				}

			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isOneEffectType reports whether t, an effect function's written return
// type, is one Effect type. A union of different Effect types is not one,
// even when each member is an Effect, as TS1064 rejects a union of Promises
// as an async function's return type (Chapter 1, Static rules). Identical
// members reduce to one type before this test.
func isOneEffectType(c *checker.Checker, t *checker.Type) bool {
	return t != nil && t.Flags()&checker.TypeFlagsUnion == 0 && isEffectType(c, t)
}

// effectReturnTypeRewrite plans the EK0106 fix at t, an effect function's
// return type: the Effect that succeeds with t, written T!! (VIP-3).
func effectReturnTypeRewrite(c *checker.Checker, file *ast.SourceFile, t *ast.Node) *formRewrite {
	// A broad annotation did not constrain the success, failure or environment.
	// Keep the marked body intact and infer all three, rather than inventing
	// empty error/requirement slots. Bodyless signatures still need a contract.
	if written := c.GetTypeFromTypeNode(t); written.Flags()&checker.TypeFlagsAnyOrUnknown != 0 && t.Parent.Body() != nil {
		// The shared comment guard also recognizes comment-looking literal
		// text. Do not turn that text into an actual comment when omitting T.
		literalComment := false
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			switch n.Kind {
			case ast.KindStringLiteral, ast.KindNoSubstitutionTemplateLiteral, ast.KindTemplateHead, ast.KindTemplateMiddle, ast.KindTemplateTail:
				if rewriteComments.MatchString(nodeText(file, n)) {
					literalComment = true
					return true
				}
			}
			return n.ForEachChild(visit)
		}
		visit(t)
		if literalComment {
			return &formRewrite{description: c.TypeToString(written) + "!!", why: "No quick fix: this return type contains comment-looking literal text. Leave the return type out to infer the Effect."}
		}
		colon := t.Pos() - 1
		if colon >= 0 && file.Text()[colon] == ':' {
			comments := rewriteComments.FindAllString(file.Text()[colon:t.End()], -1)
			var text strings.Builder
			for _, comment := range comments {
				text.WriteByte(' ')
				text.WriteString(comment)
				if strings.HasPrefix(comment, "//") {
					text.WriteByte('\n')
				}
			}
			return &formRewrite{edits: []sourceEdit{{colon, t.End(), text.String()}}, description: inferredEffectReturn}
		}
	}
	if written := c.GetTypeFromTypeNode(t); written.Flags()&checker.TypeFlagsUnion != 0 && isEffectType(c, written) {
		// A union of Effects becomes the one Effect of its joined channels, as
		// TS1064 suggests Promise<string | number> for Promise<number> | Promise<string>.
		joined := bangText(c.TypeToString(successType(c, written)), c.TypeToString(channelType(c, written, "_E")), c.TypeToString(channelType(c, written, "_R")))
		if !strings.HasSuffix(joined, "!!") {
			joined = strings.TrimSuffix(joined, "!") // A!E, as Chapter 1 writes User!NotFound
		}
		return &formRewrite{edits: []sourceEdit{{nodeStart(file, t), t.End(), joined}}, description: joined}
	}
	text := nodeText(file, t)
	if ast.IsUnionTypeNode(t) || ast.IsIntersectionTypeNode(t) || ast.IsFunctionTypeNode(t) || ast.IsConditionalTypeNode(t) {
		text = "(" + text + ")"
	}
	start := nodeStart(file, t)
	return &formRewrite{edits: []sourceEdit{{start, t.End(), text + "!!"}}, description: text + "!!"}
}
