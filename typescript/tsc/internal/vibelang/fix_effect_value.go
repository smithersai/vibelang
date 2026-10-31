package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// EK1001's other quick fix (VIP-2) holds a program a module builds at its top
// level, which a .ts module keeps as a value, in an effect block:
//
//	export const config = load("x")     export const config = effect { return try load("x") }
//	export const n = p |> Effect.map(%, f)   export const n = effect { return try (p |> Effect.map(%, f)) }
//
// The block is a program of the same type, built when it runs. It applies to
// a call or a pipe that is a variable's whole initializer, an object field's,
// or an array's element, where the value is the program; a program a module
// runs for its effect, in a statement, has no such form.

// holdProgramFixTitle starts the title of holdProgramFix's action, which
// vibelang --fix applies for EK1001 (writtenFormCodes).
const holdProgramFixTitle = "Hold the program in an effect block"

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source:     diagnosticSource,
		ErrorCodes: []int32{EK1001.Code},
		GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			call := tsFormNodeAt(fix.SourceFile, fix.Span, isInvocation)
			if call == nil {
				return nil, nil
			}
			c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
			defer done()
			rewrite := planHoldProgram(c, fix.SourceFile, call)
			if !rewrite.fixable() {
				return nil, nil
			}
			changes := replaceRange(fix, rewrite.edits[0].start, rewrite.edits[0].end, rewrite.edits[0].text)
			return []*ls.CodeAction{{Description: holdProgramFixTitle, Changes: changes}}, nil
		},
	})
}

// planHoldProgram plans the block around the program that call, EK1001's
// call, or the pipe it stands in, builds, or nil where the value is no
// program a position holds.
func planHoldProgram(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	// An unannotated .vibe helper is an Effect function by default (D500): its
	// return type says what it is, which returnTypeFix writes.
	if signature := c.GetResolvedSignature(call); signature != nil {
		if fn := implementationOf(signature.Declaration()); fn != nil && isLowerable(fn) && fn.Type() == nil && fn.Flags&ast.NodeFlagsVibeLangEffect == 0 {
			return nil
		}
	}
	program := call
	for isPipe(program.Parent) {
		program = program.Parent
	}
	if !isPipe(program) && !callReturnsEffect(c, call) {
		return nil
	}
	outer := program
	for ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}
	parent := outer.Parent
	holds := ast.IsVariableDeclaration(parent) && parent.Initializer() == outer ||
		ast.IsPropertyAssignment(parent) && parent.Initializer() == outer ||
		ast.IsPropertyDeclaration(parent) && parent.Initializer() == outer ||
		ast.IsArrayLiteralExpression(parent)
	if !holds {
		return nil
	}
	text := nodeText(file, program)
	if isPipe(program) {
		text = "(" + text + ")"
	} else if pipe := planEffectPipe(c, file, program); pipe.fixable() {
		// try f().pipe(g) is EK4502: the block holds it as a pipe.
		start := nodeStart(file, program)
		text = "(" + applyEdits(file.Text()[:program.End()], pipe.edits)[start:] + ")"
	}
	return &formRewrite{edits: []sourceEdit{{nodeStart(file, outer), outer.End(), "effect { return try " + text + " }"}}, description: "the program in an effect block"}
}
