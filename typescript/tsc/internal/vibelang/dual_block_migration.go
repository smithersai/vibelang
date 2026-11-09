package vibelang

// Retired dual trailing blocks retain declared-signature analysis solely for
// diagnostics; it does not select expression types, forms or emitted code.
// A changed meaning reports EK1023; independent TypeScript errors remain.

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func init() {
	checker.RegisterDiagnosticsFilterHook(explainDualBlock)
}

// dualBlockMigrationNote marks every dual-block site for the docs migration
// tool.
const dualBlockMigrationNote = "Through VibeLang 0.0.10, a block after an Effect dual took the place of its program. Write it as an effect block there."

// legacyDualBlockForm is where D188 placed a block param through 0.0.10.
type legacyDualBlockForm uint8

const (
	dualBlockNone      legacyDualBlockForm = iota // appended, as every block is now
	dualBlockPrepended                            // f(block, args): a data-first dual takes its program first
	dualBlockApplied                              // f(args)(block): the call returns a function of the program
)

// legacyDualBlock returns D188's placement of call's block, read from the
// callee's declared signatures without overload resolution, in D188's order:
// prepended when a signature takes an Effect first and the written arguments
// after it; else applied when a signature that takes the written arguments
// returns a function whose first parameter is an Effect, unless another
// signature takes the block directly where that function takes it, as
// Layer.effect(S) { … } does. A block written with no arguments,
// f { block }, is never prepended: f(block) is already the data-first call.
// Nor is a block after an Effect written first where a data-first signature
// takes a value second, as in x |> Effect.bind(%, "name") { … }: the written
// arguments already fill that signature's program, so D188's other forms
// did not fit and the block was appended there.
func legacyDualBlock(c *checker.Checker, call *ast.Node) legacyDualBlockForm {
	if !isBlockParamCall(call) {
		return dualBlockNone
	}
	n := len(call.Arguments()) - 1
	signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(call.Expression()), checker.SignatureKindCall)
	if n > 0 && isEffectType(c, c.GetTypeAtLocation(call.Arguments()[0])) && slices.ContainsFunc(signatures, func(signature *checker.Signature) bool {
		parameters := signature.Parameters()
		return takesEffectFirst(c, signature) && acceptsArguments(signature, n+1) && len(parameters) > 1 && !isEffectType(c, c.GetTypeOfSymbol(parameters[1]))
	}) {
		return dualBlockNone
	}
	if n > 0 && slices.ContainsFunc(signatures, func(signature *checker.Signature) bool { return takesProgramFirst(c, signature, n) }) {
		return dualBlockPrepended
	}
	for _, signature := range signatures {
		if !acceptsArguments(signature, n) {
			continue
		}
		for _, inner := range c.GetSignaturesOfType(c.GetReturnTypeOfSignature(signature), checker.SignatureKindCall) {
			if takesEffectFirst(c, inner) && !takesBlockDirectly(c, signatures, n, inner) {
				return dualBlockApplied
			}
		}
	}
	return dualBlockNone
}

// takesProgramFirst reports whether signature takes an Effect first and n
// more arguments after it, which D188 rotated to take the block last.
func takesProgramFirst(c *checker.Checker, signature *checker.Signature, n int) bool {
	parameters := signature.Parameters()
	return takesEffectFirst(c, signature) && n+1 <= len(parameters) && signature.MinArgumentCount() <= n+1 &&
		!(signature.HasRestParameter() && n+1 >= len(parameters))
}

// takesBlockDirectly reports whether one of signatures takes the block as its
// own parameter n in the role inner takes it, an Effect parameter of the same
// name, as Layer.effect(service, effect) does beside its data-last form
// Layer.effect(service)(effect). D188 then appended the block.
func takesBlockDirectly(c *checker.Checker, signatures []*checker.Signature, n int, inner *checker.Signature) bool {
	name := inner.Parameters()[0].Name()
	for _, signature := range signatures {
		parameters := signature.Parameters()
		if n < len(parameters) && acceptsArguments(signature, n+1) && parameters[n].Name() == name && isEffectType(c, c.GetTypeOfSymbol(parameters[n])) {
			return true
		}
	}
	return false
}

func acceptsArguments(signature *checker.Signature, n int) bool {
	return n >= signature.MinArgumentCount() && (signature.HasRestParameter() || n <= len(signature.Parameters()))
}

// takesEffectFirst reports whether signature's first parameter is an Effect.
func takesEffectFirst(c *checker.Checker, signature *checker.Signature) bool {
	parameters := signature.Parameters()
	return len(parameters) != 0 && isEffectType(c, c.GetTypeOfSymbol(parameters[0]))
}

// dualBlockCalls returns file's block param calls that D188 placed
// elsewhere, outermost first.
func dualBlockCalls(c *checker.Checker, file *ast.SourceFile) []*ast.Node {
	if !isVibeLangFile(file) {
		return nil
	}
	var calls []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if inHatch(n) || n.Kind == ast.KindModuleDeclaration {
			return false
		}
		if ast.IsCallExpression(n) && legacyDualBlock(c, n) != dualBlockNone {
			calls = append(calls, n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return calls
}

type dualBlockNotesKey struct{}

// explainDualBlock keeps TypeScript's error at a dual's block and adds the
// effect block spelling, or reports EK1023 where the appended call
// type-checks.
func explainDualBlock(c *checker.Checker, file *ast.SourceFile, ds []*ast.Diagnostic) []*ast.Diagnostic {
	calls := dualBlockCalls(c, file)
	if len(calls) == 0 {
		return ds
	}
	noted := c.ExtensionState(dualBlockNotesKey{}, func() any { return map[*ast.Diagnostic]bool{} }).(map[*ast.Diagnostic]bool)
	ds = slices.Clone(ds)
	for _, call := range calls {
		block := call.Arguments()[len(call.Arguments())-1]
		// TypeScript's error for the call, preferring one outside the block,
		// never one that belongs to another dual block nested in it.
		var found, inBody *ast.Diagnostic
		for _, d := range ds {
			if d.Source() != "" || d.Category() != diagnostics.CategoryError || d.Pos() < call.Pos() || call.End() < d.End() {
				continue
			}
			if slices.ContainsFunc(calls, func(other *ast.Node) bool {
				return other != call && call.Pos() <= other.Pos() && other.End() <= call.End() && other.Pos() <= d.Pos() && d.End() <= other.End()
			}) {
				continue
			}
			if strictlyInside(file, block.Body(), d.Loc()) {
				if inBody == nil {
					inBody = d
				}
				continue
			}
			found = d
			break
		}
		if found == nil {
			found = inBody
		}
		if found == nil {
			found = newDiagnostic(optionsFor(c, file), call, EK1023, nodeText(file, call.Expression()))
			if found == nil {
				continue
			}
			ds = append(ds, found)
		} else if noted[found] {
			continue
		} else {
			noted[found] = true
		}
		note(found, "{0}", dualBlockSpelling(c, file, call))
		note(found, dualBlockMigrationNote)

	}
	return ds
}

// dualBlockSpelling is the note that names where the callee takes its
// program and gives the spelling with an effect block there.
func dualBlockSpelling(c *checker.Checker, file *ast.SourceFile, call *ast.Node) string {
	callee := nodeText(file, call.Expression())
	var args []string
	for _, argument := range call.Arguments()[:len(call.Arguments())-1] {
		args = append(args, expressionText(file, argument))
	}
	written := shortText(strings.Join(args, ", "), "…")
	if legacyDualBlock(c, call) == dualBlockPrepended {
		return "A block is its call's last argument. `" + callee + "` takes its program first: write `" + callee + "(effect { … }, " + written + ")`."
	}
	head := callee + "(" + written + ")"
	return "A block is its call's last argument. `" + head + "` returns the function that takes the program: write `" + head + "(effect { … })`."
}

// strictlyInside reports whether loc lies inside body's braces.
func strictlyInside(file *ast.SourceFile, body *ast.Node, loc core.TextRange) bool {
	return nodeStart(file, body) < loc.Pos() && loc.End() < body.End()
}
