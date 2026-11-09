package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VIP-11 denies trailing blocks. Ordinary compilation leaves the call and
// brace to TypeScript. Private compatibility decoding supplies the same typed
// diagnostic and source edits as before retirement, without adding callback
// nodes to the ordinary AST or emit.
// EK1101: a trailing block (VIP-11). {0} is the call written with the block as its last argument.
var EK1101 = message(1101, errorCategory, "VibeLang has no trailing blocks (VIP-11): write the block as an argument, {0}.")

func init() {
	registry[EK1101.Code] = EK1101
	fileChecks = append(fileChecks, checkTrailingBlocks)
	compiler.RegisterSyntacticDiagnosticsHook(deniedTrailingBlockDiagnostics)
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
// brace (vibelang_trailing_legacy.go); the old layer declaration, layer L: S { … },
// builds Layer.effect(S, () => { … }) from a synthesized callee instead, and
// keeps its own diagnostic, EK2121.
func isWrittenTrailingBlock(file *ast.SourceFile, call *ast.Node) bool {
	if !isBlockParamCall(call) || call.Expression().Flags&ast.NodeFlagsReparsed != 0 {
		return false
	}
	// A missing "(" after native with is a retired provider header. The
	// recovery call can be the last operand of a compound header; enclosing
	// expressions share its end. Calls inside arguments or the body end earlier.
	for head := call; head != nil && head.End() == call.End(); head = head.Parent {
		parent := head.Parent
		if parent == nil || parent.Kind != ast.KindWithStatement || parent.AsWithStatement().Expression != head {
			continue
		}
		lex := scanner.NewScanner()
		lex.SetText(file.Text()[nodeStart(file, parent):nodeStart(file, head)])
		if lex.Scan() == ast.KindWithKeyword && lex.Scan() == ast.KindEndOfFile {
			return false
		}
		break
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

// deniedTrailingBlockDiagnostics runs before the CLI's native syntax-error
// short circuit. The migration program computes the original typed message;
// its AST never enters ordinary checking or emit.
func deniedTrailingBlockDiagnostics(ctx context.Context, program *compiler.Program, file *ast.SourceFile, native []*ast.Diagnostic) []*ast.Diagnostic {
	if file.ParseOptions().VibeLangLegacyTrailingBlocks || !file.VibeLangDeniedTrailingBlock {
		return native
	}
	migration := trailingBlockMigrationProgram(program)
	legacy := migration.GetSourceFile(file.FileName())
	// Private compatibility decoding retains native JSX diagnostic recovery.
	// Its callback interpretation must not add EK1101 to native TSX errors.
	jsxBraces := map[int]bool{}
	for _, call := range trailingBlockCalls(legacy) {
		if trailingBlockInJsxContainer(call) {
			jsxBraces[trailingBlockBrace(legacy, call).Pos()] = true
		}
	}
	var result []*ast.Diagnostic
	for _, d := range migration.GetSemanticDiagnostics(ctx, legacy) {
		if d.Source() == diagnosticSource && d.Code() == EK1101.Code || hasDualBlockMigrationNote(d) {
			if jsxBraces[d.Pos()] {
				continue
			}
			copied := d.Clone()
			copied.SetFile(file)
			result = append(result, copied)
		}
	}
	// VIP-11 rejects this brace once. Only a semicolon/comma recovery
	// diagnostic at that same brace is redundant. Parentheses, colons and
	// errors elsewhere still describe independent native syntax failures.
	braces := map[int]bool{}
	for _, d := range result {
		if d.Source() == diagnosticSource && d.Code() == EK1101.Code {
			braces[d.Pos()] = true
		}
	}
	combined := make([]*ast.Diagnostic, 0, len(native)+len(result))
	for _, d := range native {
		args := d.MessageArgs()
		separator := d.Source() == "" && d.Code() == 1005 && len(args) == 1 && (args[0] == ";" || args[0] == ",")
		if !separator || !braces[d.Pos()] {
			combined = append(combined, d)
		}
	}
	return append(combined, result...)
}

// A written block or function inside a container is ordinary VibeLang code.
// Only expressions directly enclosed by JSX use native container recovery.
func trailingBlockInJsxContainer(call *ast.Node) bool {
	for parent := call.Parent; parent != nil; parent = parent.Parent {
		switch parent.Kind {
		case ast.KindJsxExpression, ast.KindJsxSpreadAttribute:
			return true
		case ast.KindBlock:
			return false
		}
		if ast.IsFunctionLike(parent) {
			return false
		}
	}
	return false
}

func checkTrailingBlocks(c *checker.Checker, file *ast.SourceFile) {
	if !file.ParseOptions().VibeLangLegacyTrailingBlocks {
		return
	}

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

// trailingBlockMigrationProgram preserves the editor's in-memory snapshot.
// Compatibility decoding is confined to the migration; normal compilation
// never receives this option or a synthesized callback for a trailing block.
func trailingBlockMigrationProgram(program *compiler.Program) *compiler.Program {
	// A project host stops acquiring files when its snapshot is finalized.
	// Reuse the snapshot's read-only FS and loaded source texts through an
	// independent host; newly needed migration dependencies must not call
	// back into that finalized project's parser cache.
	original := program.Host()
	host := compiler.NewCompilerHost(original.FS(), original.DefaultLibraryPath(), nil, nil, original.ContentMapperProject())
	return compiler.NewProgram(compiler.ProgramOptions{
		Config: program.CommandLine(),
		Host:   trailingBlockMigrationHost{CompilerHost: host, program: program},
	})
}

type trailingBlockMigrationHost struct {
	compiler.CompilerHost
	program *compiler.Program
}

func (h trailingBlockMigrationHost) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	if file := h.program.GetSourceFile(opts.FileName); file != nil {
		if !isVibeLangFile(file) {
			return file
		}
		opts.VibeLangLegacyTrailingBlocks = true
		return parser.ParseSourceFile(opts, file.Text(), file.ScriptKind)
	}
	opts.VibeLangLegacyTrailingBlocks = opts.FileName.IsVibeLangSource()
	return h.CompilerHost.GetSourceFile(opts)
}

// hasDualBlockMigrationNote keeps the separate pre-VIP-11 dual-block error
// and its code action available without treating the retired block as code.
func hasDualBlockMigrationNote(d *ast.Diagnostic) bool {
	if strings.Contains(d.String(), dualBlockMigrationNote) {
		return true
	}
	for _, child := range d.MessageChain() {
		if hasDualBlockMigrationNote(child) {
			return true
		}
	}
	return false
}
