// Package vibelangestree converts a .vibe file to ESTree, the tree ESLint
// rules read, for VibeLang's ESLint parser (packages/compiler/eslint.mjs).
//
// The tree is the one the VibeLang parser builds, in which each VibeLang form
// is the TypeScript it abbreviates (internal/parser/vibelang*.go), converted
// as typescript-estree converts TypeScript (convert.go), with the forms a
// rule would misread given ESTree node types of their own (vibelang.go).
// Ranges are UTF-16 offsets into the .vibe text, and the tokens and comments
// are the source's own (tokens.go), so a report, a fix, or an
// eslint-disable comment lands on what the author wrote.
package vibelangestree

import (
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Error is a file the converter cannot turn into ESTree: a syntax error, or
// a node it has no form for. Index is a UTF-16 offset; Line and Column are
// 1-based, as ESLint reports a parsing error.
type Error struct {
	Message string `json:"message"`
	Index   int    `json:"index"`
	Line    int    `json:"lineNumber"`
	Column  int    `json:"column"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("%d:%d: %s", e.Line, e.Column, e.Message)
}

// Parse returns the ESTree Program of text as JSON. fileName decides the
// language: .vibe and .vibex are VibeLang; .vibex and .tsx enable JSX.
// The JSON has no loc, which the JavaScript side computes from the ranges.
func Parse(fileName string, text string) (json string, failure *Error) {
	vibe := tspath.IsVibeLangSource(fileName)
	name := "/estree.ts"
	if vibe {
		name = "/estree" + tspath.VibeLangSourceExtension(fileName)
	}
	kind := core.ScriptKindTS
	if core.GetScriptKindFromFileName(tspath.RootedFilePath(fileName)) == core.ScriptKindTSX {
		kind = core.ScriptKindTSX
		if !vibe {
			name = "/estree.tsx"
		}
	}
	positions := newPositions(text)
	fail := func(pos int, message string) *Error {
		line, column := lineAndColumn(text, pos, positions)
		return &Error{Message: message, Index: positions.utf16(pos), Line: line, Column: column}
	}
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, text, kind)
	var modules map[*ast.Node]*ast.SourceFile
	var bodies []*ast.SourceFile
	if vibe {
		modules, bodies = moduleBodies(file)
	}
	// A module body's syntax errors are its own file's; the first in the
	// text is the one ESLint reports.
	var first *ast.Diagnostic
	for _, f := range append([]*ast.SourceFile{file}, bodies...) {
		if diagnostics := f.Diagnostics(); len(diagnostics) != 0 && (first == nil || diagnostics[0].Pos() < first.Pos()) {
			first = diagnostics[0]
		}
	}
	if first != nil {
		return "", fail(scanner.SkipTrivia(text, max(first.Pos(), 0)), first.String())
	}
	lexical := newLexicalContext()
	lexical.collect(file, text)
	for _, body := range bodies {
		lexical.collect(body, body.Text())
	}
	c := &converter{file: file, text: text, vibe: vibe, scan: scanner.NewScanner(), modules: modules}
	c.scan.SetText(text)
	var program *obj
	err := func() (failure *Error) {
		defer func() {
			switch e := recover().(type) {
			case nil:
			case unsupported:
				failure = fail(e.pos, e.Error())
			case syntaxError:
				failure = fail(e.pos, e.message)
			default:
				panic(e)
			}
		}()
		program = c.convertChild(file.AsNode(), nil)
		return nil
	}()
	if err != nil {
		return "", err
	}
	tokens, comments := lex(text, lexical)
	program.set("comments", comments).set("tokens", tokens)
	var b strings.Builder
	b.Grow(len(text) * 8)
	write(&b, program, positions)
	return b.String(), nil
}

// lineAndColumn returns the 1-based line and column of pos, counting line
// breaks as ESLint does and columns in UTF-16 code units.
func lineAndColumn(text string, pos int, p positions) (line int, column int) {
	line, lineStart := 1, 0
	for i := 0; i < pos && i < len(text); i++ {
		switch text[i] {
		case '\n':
			line, lineStart = line+1, i+1
		case '\r':
			if i+1 < len(text) && text[i+1] == '\n' {
				continue
			}
			line, lineStart = line+1, i+1
		case 0xe2:
			// U+2028 and U+2029 are E2 80 A8 and E2 80 A9.
			if i+2 < len(text) && text[i+1] == 0x80 && (text[i+2] == 0xa8 || text[i+2] == 0xa9) {
				line, lineStart = line+1, i+3
				i += 2
			}
		}
	}
	return line, p.utf16(pos) - p.utf16(lineStart) + 1
}
