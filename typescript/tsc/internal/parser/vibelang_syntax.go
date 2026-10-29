package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VibeLang's surface syntax as written.
//
// The parser writes each VibeLang form as the TypeScript it abbreviates, so
// the tree does not say where the form's own tokens stand. A tool that keeps
// the source as written, such as the formatter (package vibelangfmt), parses
// with ParseVibeLangSyntax, which also returns each form TypeScript cannot
// parse and the ranges of its tokens. Ranges never include leading trivia.
// A form parsed during a lookahead that the parser then abandons is dropped
// with the lookahead (ParserState.vibelangSyntaxLen).

// VibeSyntaxKind is the kind of a recorded VibeLang form.
type VibeSyntaxKind int

const (
	// VibeSyntaxEffectType is an Effect type, A!E!R: Range.
	VibeSyntaxEffectType VibeSyntaxKind = iota + 1
	// VibeSyntaxMutable is mutable and the member name after it: Range runs
	// from mutable through the name. With Index, the name is preceded by [ and
	// Range runs through the token after it.
	VibeSyntaxMutable
	// VibeSyntaxDeclaration is error, schema error, service, control, schema,
	// data, or layer (Name): Range is the statement from its first modifier, Head
	// runs from the word through the declared name, and Open and Close are the
	// body's braces, empty when the declaration has no body. Class is set for
	// an error written with a class's features (D278): abstract, a heritage
	// clause, or a member other than a field. For service Name: Type (D281),
	// Head runs through the shape and Right is the shape. For data (D307),
	// Variants lists the variants.
	VibeSyntaxDeclaration
	// VibeSyntaxBlockParam is a block after a call or a name (D188): Head is the
	// callee, Open and Close the block's braces.
	VibeSyntaxBlockParam
	// VibeSyntaxDo is do { ... } (D187): Word, Open, Close.
	VibeSyntaxDo
	// VibeSyntaxForkBlock is fork { ... } (D166): Word, Open, Close.
	VibeSyntaxForkBlock
	// VibeSyntaxPrefix is a keyword before a unary operand: try, fork, join, a
	// throw expression, or an await operation such as await.all (Word, which for an
	// await operation runs through the operation's name).
	VibeSyntaxPrefix
	// VibeSyntaxCatch is x catch y (D236): Word is catch, Left the left side,
	// and Right the handler or the fallback.
	VibeSyntaxCatch
	// VibeSyntaxPipe is x |> body (D154): Word runs from | through >, Left is
	// the left side, and Right the body.
	VibeSyntaxPipe
	// VibeSyntaxTopic is %, a pipe's topic: Word.
	VibeSyntaxTopic
	// VibeSyntaxIs is subject is pattern (D211): Word is is, Right the pattern.
	VibeSyntaxIs
	// VibeSyntaxMatch is match (subject) { arms } (D206): Word is match, Left
	// the subject, Open and Close the braces, and Arms the arms.
	VibeSyntaxMatch
	// VibeSyntaxBlockStatement is a statement made of a header and a block:
	// provide or with and the providers (D172), or uninterruptible, restore,
	// or interruptible (D180). Head is the header, Open and Close the braces.
	VibeSyntaxBlockStatement
	// VibeSyntaxForConcurrent is for concurrent(n) (...) (D169): Word is for,
	// Head runs from concurrent through the limit's closing parenthesis.
	VibeSyntaxForConcurrent
	// VibeSyntaxClause is one catch, handle, or finally clause of a try
	// statement (Name): Head runs from the keyword to the clause's block, and
	// Open and Close are the block's braces. Every catch and handle clause of a
	// .vibe file is recorded, and a finally clause only when it binds the
	// exit, finally (exit) { ... } (D178).
	VibeSyntaxClause
	// VibeSyntaxStatement is a statement with no other record that only
	// VibeLang parses, select { ... }: Range.
	VibeSyntaxStatement
)

// VibeSyntax is one recorded VibeLang form. Which fields are set depends on
// Kind; the others are empty.
type VibeSyntax struct {
	Kind  VibeSyntaxKind
	Range core.TextRange
	Word  core.TextRange
	Head  core.TextRange
	Left  core.TextRange
	Right core.TextRange
	Open  core.TextRange
	Close core.TextRange
	Name  string
	Index bool
	Class bool
	Arms  []VibeSyntaxArm
	// Variants are the variants of a data declaration.
	Variants []VibeSyntaxVariant
}

// VibeSyntaxVariant is one variant of a data declaration (D307): Name is
// its name, Open and Close the braces of its fields, empty when it has none.
type VibeSyntaxVariant struct {
	Name  core.TextRange
	Open  core.TextRange
	Close core.TextRange
}

// VibeSyntaxArm is one arm of a match: Head runs from when through the
// pattern, or is the default keyword; Value is the arm's value; Semicolon is
// the semicolon that ends the arm, empty when a line break ends it.
type VibeSyntaxArm struct {
	Head      core.TextRange
	Value     core.TextRange
	Semicolon core.TextRange
}

// ParseVibeLangSyntax parses a .vibe file as ParseSourceFile does, and returns
// the VibeLang forms it holds, in the order the parser finished them.
func ParseVibeLangSyntax(opts ast.SourceFileParseOptions, sourceText string) (*ast.SourceFile, []VibeSyntax) {
	p := getParser()
	defer putParser(p)
	p.initializeState(opts, sourceText, core.ScriptKindTS)
	forms := []VibeSyntax{}
	p.vibelangSyntax = &forms
	p.nextToken()
	file := p.parseSourceFileWorker()
	return file, forms
}

// recordVibeSyntax records form when the parser was started by
// ParseVibeLangSyntax.
func (p *Parser) recordVibeSyntax(form VibeSyntax) {
	if p.vibelangSyntax != nil {
		*p.vibelangSyntax = append(*p.vibelangSyntax, form)
	}
}

// vibelangSyntaxCount is the number of forms recorded so far, which a
// lookahead restores when it rewinds.
func (p *Parser) vibelangSyntaxCount() int {
	if p.vibelangSyntax == nil {
		return 0
	}
	return len(*p.vibelangSyntax)
}

// vibelangSyntaxRewind drops the forms recorded after the first count.
func (p *Parser) vibelangSyntaxRewind(count int) {
	if p.vibelangSyntax != nil && len(*p.vibelangSyntax) > count {
		*p.vibelangSyntax = (*p.vibelangSyntax)[:count]
	}
}

// sourceRange returns node's range without its leading trivia.
func (p *Parser) sourceRange(node *ast.Node) core.TextRange {
	return core.NewTextRange(scanner.SkipTrivia(p.sourceText, node.Pos()), node.End())
}

// blockBraces returns the ranges of the braces of block, a parsed block.
func (p *Parser) blockBraces(block *ast.Node) (core.TextRange, core.TextRange) {
	open := scanner.SkipTrivia(p.sourceText, block.Pos())
	return core.NewTextRange(open, open+1), core.NewTextRange(block.End()-1, block.End())
}

// recordVibeSyntaxBlock records a form of kind that is a word or a callee and a
// block: Word or Head is at, the block's braces come from block.
func (p *Parser) recordVibeSyntaxBlock(kind VibeSyntaxKind, at core.TextRange, block *ast.Node) {
	open, closing := p.blockBraces(block)
	form := VibeSyntax{Kind: kind, Range: core.NewTextRange(at.Pos(), block.End()), Open: open, Close: closing}
	if kind == VibeSyntaxBlockParam {
		form.Head = at
	} else {
		form.Word = at
	}
	p.recordVibeSyntax(form)
}

// recordVibeSyntaxClause records a catch, handle, or finally clause whose header
// starts at start and whose block is block.
func (p *Parser) recordVibeSyntaxClause(name string, start int, block *ast.Node) {
	open, closing := p.blockBraces(block)
	p.recordVibeSyntax(VibeSyntax{
		Kind:  VibeSyntaxClause,
		Name:  name,
		Range: core.NewTextRange(start, block.End()),
		Head:  core.NewTextRange(start, open.Pos()),
		Open:  open,
		Close: closing,
	})
}
