package parser

import (
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Module declarations (D283), with the grammar of TC39's module declarations
// proposal (https://github.com/tc39/proposal-module-declarations):
//
//	ModuleDeclaration : module [no LineTerminator here] Identifier { ModuleBody? }
//	ModuleSpecifier   : StringLiteral | Identifier
//
//	module text {
//	  export function clean(value: string): string { return value.trim() }
//	}
//	import { clean } from text
//
// The body is TypeScript, checked and compiled as a .ts file would be. The
// parser reads it in TypeScript mode only to find its closing brace, and
// keeps none of it: the declaration becomes a ModuleDeclaration flagged
// NodeFlagsVibeLang whose block is empty. Each top-level module declaration
// gets its own source file, a supplemental file of the .vibe file (the
// content mapper's seam, ast.ContentMapperSourceFileInfo), named
// main.vibe.text.ts beside main.vibe. Its text is the .vibe file's text with
// every character outside the body replaced by a space, so every position in
// it is the same position in the .vibe file, its relative imports resolve
// from the .vibe file's directory, and it cannot see the .vibe file's
// bindings. An identifier module specifier becomes a string literal that
// names that file, ./main.vibe.text.js, flagged NodeFlagsVibeLang, which the
// program resolves to the supplemental file (compiler/fileloader.go).

// isStartOfVibeLangModuleDeclaration reports whether the current token,
// module, starts a module declaration: an identifier follows it on the same
// line, and a { follows the identifier. A { in the identifier's place starts
// one without its name, which the checker refuses (EK4003), rather than a
// block passed to a function named module.
func (p *Parser) isStartOfVibeLangModuleDeclaration() bool {
	return p.isVibeLangFile() && p.token == ast.KindModuleKeyword && p.lookAhead(func(p *Parser) bool {
		p.nextToken()
		if p.hasPrecedingLineBreak() {
			return false
		}
		if p.token == ast.KindOpenBraceToken {
			return true
		}
		if !p.isIdentifier() {
			return false
		}
		p.nextToken()
		return p.token == ast.KindOpenBraceToken
	})
}

// parseVibeLangModuleDeclaration parses module Name { body } at the current
// token, or returns nil when the token starts no module declaration.
func (p *Parser) parseVibeLangModuleDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	if !p.isStartOfVibeLangModuleDeclaration() || modifiers != nil && core.Some(modifiers.Nodes, isDeclareModifier) {
		return nil // declare module x { } stays TypeScript's, which the checker reports in a .vibe file
	}
	keyword := p.scanner.TokenStart()
	p.nextToken() // module
	var name *ast.Node
	if p.token == ast.KindOpenBraceToken {
		name = p.createMissingIdentifier() // module { }: EK4003 asks for the name
	} else {
		name = p.parseIdentifier()
	}
	blockPos := p.nodePos()
	open := p.scanner.TokenStart()
	p.parseExpected(ast.KindOpenBraceToken)
	p.skipTypeScriptModuleBody()
	closing := p.scanner.TokenStart()
	p.parseExpected(ast.KindCloseBraceToken)
	block := p.finishNode(p.factory.NewModuleBlock(p.newNodeList(core.NewTextRange(open+1, open+1), nil)), blockPos)
	node := p.finishNode(p.factory.NewModuleDeclaration(modifiers, ast.KindModuleKeyword, name, nil /*attributes*/, block), pos)
	node.Flags |= ast.NodeFlagsVibeLang
	p.withJSDoc(node, jsdoc)
	p.recordVibeSyntax(VibeSyntax{
		Kind:  VibeSyntaxModule,
		Name:  name.Text(),
		Range: core.NewTextRange(scanner.SkipTrivia(p.sourceText, pos), node.End()),
		Head:  core.NewTextRange(keyword, name.End()),
		Open:  core.NewTextRange(open, open+1),
		Close: core.NewTextRange(closing, closing+1),
	})
	return node
}

// skipTypeScriptModuleBody parses a module body as TypeScript to find its
// closing brace and drops what it parsed: the body's own source file reports
// its syntax errors. The module block is marked with an error only when its
// closing brace is missing (ModuleDeclarationBody).
func (p *Parser) skipTypeScriptModuleBody() {
	saveTypeScript := p.vibelangTypeScript
	saveContextFlags := p.contextFlags
	saveHasParseError := p.hasParseError
	saveHasAwaitIdentifier := p.statementHasAwaitIdentifier
	diagnosticsLen := len(p.diagnostics)
	jsdocInfosLen := len(p.jsdocInfos)
	syntaxLen := p.vibelangSyntaxCount()
	p.vibelangTypeScript = true
	p.setContextFlags(ast.NodeFlagsAwaitContext, true) // a module's top level may await
	p.parseList(PCBlockStatements, (*Parser).parseStatement)
	p.vibelangTypeScript = saveTypeScript
	p.contextFlags = saveContextFlags
	p.statementHasAwaitIdentifier = saveHasAwaitIdentifier
	p.diagnostics = p.diagnostics[:diagnosticsLen]
	p.hasParseError = saveHasParseError
	p.jsdocInfos = p.jsdocInfos[:jsdocInfosLen]
	p.vibelangSyntaxRewind(syntaxLen)
}

// parseVibeLangModuleReference parses an identifier module specifier, from
// text, as the string literal that names the module declaration's file. It
// returns nil when the current token is not an identifier in a .vibe file.
func (p *Parser) parseVibeLangModuleReference() *ast.Node {
	if !p.isVibeLangFile() || p.token != ast.KindIdentifier {
		return nil
	}
	return p.vibelangModuleReference(p.parseIdentifier())
}

// vibelangModuleReference returns the string literal that stands for name, an
// identifier written as a module specifier.
func (p *Parser) vibelangModuleReference(name *ast.Node) *ast.Node {
	literal := p.factory.NewStringLiteral(ModuleDeclarationSpecifier(p.opts.FileName, name.Text()), ast.TokenFlagsNone)
	p.vibelangSynthesized(literal, name.Loc)
	literal.Flags |= ast.NodeFlagsVibeLang
	p.recordVibeSyntax(VibeSyntax{Kind: VibeSyntaxModuleReference, Name: name.Text(), Word: core.NewTextRange(scanner.SkipTrivia(p.sourceText, name.Pos()), name.End())})
	return literal
}

// isVibeLangModuleImport reports whether import followed by an identifier,
// already parsed, is `import text;`, an import of a module declaration for
// its effects.
func (p *Parser) isVibeLangModuleImport() bool {
	return p.isVibeLangFile() && p.token != ast.KindEqualsToken && p.token != ast.KindCommaToken && p.token != ast.KindFromKeyword && p.canParseSemicolon()
}

// parseVibeLangModuleImport finishes `import text;`, whose identifier is
// already parsed.
func (p *Parser) parseVibeLangModuleImport(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList, name *ast.Node) *ast.Node {
	specifier := p.vibelangModuleReference(name)
	p.parseSemicolon()
	result := p.finishNode(p.factory.NewImportDeclaration(modifiers, nil /*importClause*/, specifier, nil /*attributes*/), pos)
	p.withJSDoc(result, jsdoc)
	return result
}

// ModuleDeclarationFileSuffix is what a module declaration's file name adds
// to the .vibe file's name: .text.ts for module text. The name is lower case,
// so the file's path key is the same on every file system.
func ModuleDeclarationFileSuffix(name string) string {
	return "." + tspath.ToFileNameLowerCase(name) + tspath.ExtensionTs
}

// ModuleDeclarationSpecifier is the specifier that names module declaration
// name of the .vibe file fileName: ./main.vibe.text.js.
func ModuleDeclarationSpecifier(fileName tspath.RootedFilePath, name string) string {
	return "./" + fileName.BaseName() + "." + tspath.ToFileNameLowerCase(name) + tspath.ExtensionJs
}

// IsVibeLangModuleDeclaration reports whether node is a module declaration
// (D283) of a .vibe file.
func IsVibeLangModuleDeclaration(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindModuleDeclaration && node.Flags&ast.NodeFlagsVibeLang != 0
}

// IsVibeLangModuleReference reports whether node is the string literal an
// identifier module specifier became.
func IsVibeLangModuleReference(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindStringLiteral && node.Flags&ast.NodeFlagsVibeLang != 0
}

// ModuleDeclarationBody returns the range of a module declaration's body:
// everything between its braces, or after the open brace to the block's end
// when the closing brace is missing. The parser marks the block with an error
// only then (skipTypeScriptModuleBody), and its end is the end of the body's
// last token.
func ModuleDeclarationBody(file *ast.SourceFile, node *ast.Node) core.TextRange {
	block := node.Body()
	open := scanner.SkipTrivia(file.Text(), block.Pos())
	end := block.End()
	if block.Flags&ast.NodeFlagsThisNodeHasError == 0 {
		end-- // the closing brace
	}
	return core.NewTextRange(open+1, end)
}

// attachVibeLangModules gives file, a .vibe file, one supplemental source
// file for each module declaration at its top level. A second declaration of
// a name, and one without a name, gets none; the checker reports it.
func (p *Parser) attachVibeLangModules(file *ast.SourceFile) {
	var modules []*ast.SourceFile
	seen := map[string]bool{}
	for _, statement := range file.Statements.Nodes {
		if !IsVibeLangModuleDeclaration(statement) || statement.Name().Text() == "" {
			continue
		}
		suffix := ModuleDeclarationFileSuffix(statement.Name().Text())
		if seen[suffix] {
			continue
		}
		seen[suffix] = true
		body := ModuleDeclarationBody(file, statement)
		opts := p.opts
		opts.FileName = opts.FileName.AppendSuffix(suffix)
		if opts.PathKey != "" { // a caller outside a program may parse with a file name only
			opts.PathKey = opts.PathKey.AppendCanonicalSuffix(suffix)
		}
		opts.ExternalModuleIndicatorOptions.Force = true // a module declaration is always a module
		module := parseModuleBody(opts, blankOutside(p.sourceText, body), body.Pos())
		module.SetContentMapperInfo(ast.ContentMapperSourceFileInfo{
			// A content-mapped file to every tool: it emits no JavaScript of its
			// own, and editors and diagnostics map it to the .vibe file.
			ContentMapper:   ast.EmbeddedModuleContentMapper,
			ParseOptions:    p.opts,
			VirtualFileName: opts.FileName,
			OriginalText:    p.sourceText,
			SpanMap: spanmap.New([]spanmap.Segment{{
				VirtualStart: core.TextPos(body.Pos()), VirtualEnd: core.TextPos(body.End()),
				OriginalStart: core.TextPos(body.Pos()), OriginalEnd: core.TextPos(body.End()),
				Kind: spanmap.KindVerbatim, Features: spanmap.FeatureAll,
			}}),
			CanonicalSourceFile: file,
			EmbeddedModule: &ast.EmbeddedModule{
				Name:        statement.Name().Text(),
				Specifier:   ModuleDeclarationSpecifier(p.opts.FileName, statement.Name().Text()),
				Declaration: statement,
			},
		})
		modules = append(modules, module)
	}
	if len(modules) != 0 {
		file.SetContentMapperInfo(ast.ContentMapperSourceFileInfo{ParseOptions: p.opts, SupplementalSourceFiles: modules})
	}
}

// parseModuleBody parses a module declaration's file from start, where its
// body starts, so that its first statement's leading trivia is the body's
// and not the blanked text before it.
func parseModuleBody(opts ast.SourceFileParseOptions, text string, start int) *ast.SourceFile {
	p := getParser()
	defer putParser(p)
	p.initializeState(opts, text, core.ScriptKindTS)
	p.scanner.ResetPos(start)
	p.nextToken()
	return p.parseSourceFileWorker()
}

// blankOutside returns text with every character outside body replaced by
// spaces, one per byte, and every line terminator kept, so positions and
// lines stay where they are.
func blankOutside(text string, body core.TextRange) string {
	out := make([]byte, len(text))
	for i := 0; i < len(text); {
		if i >= body.Pos() && i < body.End() {
			copy(out[i:body.End()], text[i:body.End()])
			i = body.End()
			continue
		}
		r, size := utf8.DecodeRuneInString(text[i:])
		if r == '\n' || r == '\r' || r == 0x2028 || r == 0x2029 {
			copy(out[i:i+size], text[i:i+size])
		} else {
			for j := range size {
				out[i+j] = ' '
			}
		}
		i += size
	}
	return string(out)
}

// The forms a module declaration records for ParseVibeLangSyntax. Their
// values stay clear of the kinds in vibelang_syntax.go.
const (
	// VibeSyntaxModule is module Name { ... } (D283): Range is the statement
	// from its first modifier, Head runs from module through the name, Open
	// and Close are the braces, and Name is the name.
	VibeSyntaxModule VibeSyntaxKind = 100 + iota
	// VibeSyntaxModuleReference is a module specifier written as an
	// identifier, from text (D283): Word, and Name the identifier.
	VibeSyntaxModuleReference
)

// VIP-40 reserves expressions and non-top-level declarations. Consume the
// whole rejected form, keeping native trailing-block recovery out of it.
const ModuleExpressionMessage = "A module expression is not supported. Write module name { … } at the top level and import from name."
const ModulePlacementMessage = "A module declaration stands at the top level of a .vibe file. Move it to the top level."
const ModuleExportMessage = "A module declaration is not exported; re-export its members with export { … } from name."

func (p *Parser) rejectVibeLangModule(code int32, message string) *ast.Node {
	pos := p.nodePos()
	keyword := p.tokenRange()
	p.nextToken()
	if p.token != ast.KindOpenBraceToken {
		p.parseIdentifier()
	}
	p.parseExpected(ast.KindOpenBraceToken)
	p.skipTypeScriptModuleBody()
	p.parseExpected(ast.KindCloseBraceToken)
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, keyword, "EK", diagnostics.CategoryError, code, message))
	return p.finishNode(p.factory.NewKeywordExpression(ast.KindNullKeyword), pos)
}
