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

// VIP-11 denied trailing blocks: a block after a call, f(args) { … }, or
// after a name, f { … }, is not VibeLang. The parser still reads one as the
// call's last argument, the arrow () => { … } (blockparams.go), so EK1101
// reports the block at its opening brace, and its quick fix writes that
// argument out, keeping what the arrow compiles to today:
//
//	Layer.effect(Users) { … }      Layer.effect(Users, effect { … })        a program
//	it.effect("loads") { … }       it.effect("loads", effect () => { … })  an Effect function
//	twice() { … }                  twice(() => { … })                      a plain function
//
// The destination picks the spelling, as it picked the block's form before
// VIP-1: where the parameter expects an Effect the block becomes an effect
// block, where it expects a function returning an Effect an effect arrow,
// and anywhere else the plain arrow the parser builds. fork { … } is fork's own
// block (D166, vibelang_fibers.go), not a block param, so EK1101 leaves it. A block after an Effect dual that D188 placed
// elsewhere through 0.0.10 already has an error, TypeScript's or EK1023,
// whose note and fix restore that placement (dual_block_migration.go), so
// EK1101 skips it rather than advise a second, different spelling.

// EK1101: a trailing block (VIP-11). {0} is the call written with the block as its last argument.
var EK1101 = message(1101, errorCategory, "VibeLang has no trailing blocks (VIP-11): write the block as an argument, {0}; vibelang --fix rewrites it.")

func init() {
	registry[EK1101.Code] = EK1101
	fileChecks = append(fileChecks, checkTrailingBlocks)
	tsFormFixCodes = append(tsFormFixCodes, EK1101.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1101.Code)
	ls.RegisterCodeFixProvider(trailingBlockFix)
}

// trailingBlockCalls returns file's calls that pass a trailing block,
// outermost first.
func trailingBlockCalls(file *ast.SourceFile) []*ast.Node {
	if !isVibeLangFile(file) {
		return nil
	}
	var calls []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if inHatch(n) || n.Kind == ast.KindModuleDeclaration {
			return false
		}
		if isWrittenTrailingBlock(file, n) {
			calls = append(calls, n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return calls
}

// isWrittenTrailingBlock reports whether call passes a block its source
// writes after it. The parser anchors a block param's arrow at the block's
// brace (vibelang_blocks.go); the old layer declaration, layer L: S { … },
// builds Layer.effect(S, () => { … }) from a synthesized callee instead, and
// keeps its own warning, EK2121.
func isWrittenTrailingBlock(file *ast.SourceFile, call *ast.Node) bool {
	if !isBlockParamCall(call) || call.Expression().Flags&ast.NodeFlagsReparsed != 0 {
		return false
	}
	arguments := call.Arguments()
	arrow := arguments[len(arguments)-1]
	token := arrow.AsArrowFunction().EqualsGreaterThanToken
	return token != nil && scanner.SkipTrivia(file.Text(), token.Pos()) == nodeStart(file, arrow.Body())
}

// trailingBlockBrace is the range of the opening brace of call's block.
func trailingBlockBrace(file *ast.SourceFile, call *ast.Node) core.TextRange {
	arguments := call.Arguments()
	brace := nodeStart(file, arguments[len(arguments)-1].Body())
	return core.NewTextRange(brace, brace+1)
}

func checkTrailingBlocks(c *checker.Checker, file *ast.SourceFile) {
	for _, call := range trailingBlockCalls(file) {
		if legacyDualBlock(c, call) != dualBlockNone {
			continue
		}
		reportAt(c, file, trailingBlockBrace(file, call), EK1101, trailingBlockSpelling(c, file, call))
	}
}

// trailingBlockLead is what stands before the block's brace once it is an
// argument: the spelling of the function literal the arrow compiles to.
func trailingBlockLead(c *checker.Checker, call *ast.Node) string {
	arguments := call.Arguments()
	arrow := arguments[len(arguments)-1]
	signature := c.GetResolvedSignature(call)
	if signature == nil {
		return "() => "
	}
	a := analyzerFor(c)
	switch e := a.classify(a.expectedAt(call, signature, []pathStep{{argument: len(arguments) - 1}}, arrow)); {
	case e.program:
		return "effect "
	case e.effectFn:
		return "effect () => "
	}
	return "() => "
}

// trailingBlockSpelling is the message's call: the callee, its written
// arguments when short, and the block as its last argument.
func trailingBlockSpelling(c *checker.Checker, file *ast.SourceFile, call *ast.Node) string {
	arguments := call.Arguments()
	var written []string
	for _, argument := range arguments[:len(arguments)-1] {
		written = append(written, expressionText(file, argument))
	}
	head := ""
	if len(written) != 0 {
		head = shortText(strings.Join(written, ", "), "…") + ", "
	}
	return shortText(nodeText(file, call.Expression()), "f") + "(" + head + trailingBlockLead(c, call) + "{ … })"
}

// trailingBlockRewrite plans the edits that make call's block its last
// written argument: `) {` becomes `, lead{` (or `(lead{` after a bare name)
// and the block's closing brace gains `)`. Nothing moves, so the arguments
// still run in their order. A comment between the call and the block has no
// place in the rewrite, so the fix refuses it.
func trailingBlockRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if legacyDualBlock(c, call) != dualBlockNone {
		return nil // EK1023 or TypeScript's error carries dual_block_migration.go's fix
	}
	text := file.Text()
	arguments := call.Arguments()
	block := arguments[len(arguments)-1]
	brace := nodeStart(file, block.Body())
	lead := trailingBlockLead(c, call)
	before := strings.TrimRight(text[:brace], " \t")
	closing := sourceEdit{block.End(), block.End(), ")"}
	switch {
	case len(before) == call.Expression().End() && len(arguments) == 1:
		// f { … }: the block becomes the only argument.
		return &formRewrite{edits: []sourceEdit{{call.Expression().End(), brace, "(" + lead}, closing}, description: "Pass the block as the call's argument"}
	case strings.HasSuffix(before, ")") && call.Expression().End() < len(before)-1:
		// f(args) { … } or f<T>(args) { … }: the block joins the written list.
		paren := len(before) - 1
		separator := ""
		if len(arguments) > 1 {
			switch strings.TrimSpace(text[arguments[len(arguments)-2].End():paren]) {
			case "":
				separator = ", "
			case ",":
				separator = " " // f(a,) { … }: the written trailing comma separates the block
			default:
				return &formRewrite{why: "A comment stands before the call's closing parenthesis."}
			}
		} else if strings.TrimSpace(text[scanner.SkipTrivia(text, call.Expression().End()):paren]) != "(" && call.TypeArguments() == nil {
			return &formRewrite{why: "A comment stands inside the call's parentheses."}
		}
		return &formRewrite{edits: []sourceEdit{{paren, brace, separator + lead}, closing}, description: "Pass the block as the call's last argument"}
	}
	return &formRewrite{why: "A comment stands between the call and its block."}
}

var trailingBlockFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK1101.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		for _, call := range trailingBlockCalls(fix.SourceFile) {
			if trailingBlockBrace(fix.SourceFile, call) != fix.Span {
				continue
			}
			c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
			defer done()
			r := trailingBlockRewrite(c, fix.SourceFile, call)
			if !r.fixable() {
				return nil, nil
			}
			var changes []*lsproto.TextEdit
			for _, edit := range r.edits {
				changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
			}
			return []*ls.CodeAction{{Description: r.description, Changes: changes}}, nil
		}
		return nil, nil
	},
}
