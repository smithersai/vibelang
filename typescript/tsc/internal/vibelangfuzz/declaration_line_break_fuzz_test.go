package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Appendix A supplies both oracles: bodyless errors terminate before a
// next-line generic arrow; other declaration productions may span lines.
// Parsing is sufficient: service parameters reach their independent static
// check. Schema declarations have no parameters; their native field type
// supplies the generic angle while the declaration body crosses the break.
const declarationLineBreakQuote = "when the next token after the name is `{`, however many line breaks precede it, or `<`, `extends` or `implements` on the name's line, the declaration continues; otherwise it ends as a TypeScript statement does"
const declarationContextQuote = "After the name, the declaration's production decides the rest, and line breaks may separate its tokens as in a TypeScript `class` or `type` declaration"
const declarationDataQuote = "DataDeclaration = DataStart TypeParameters?"
const declarationSchemaQuote = "SchemaDeclaration = SchemaStart \"{\" Field* \"}\""

func TestDeclarationLineBreakQuoted(t *testing.T) { declarationLineBreakChapter(t) }

func declarationLineBreakChapter(t testing.TB) {
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{declarationLineBreakQuote, declarationContextQuote, declarationDataQuote, declarationSchemaQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("Appendix A no longer says %q", quote)
		}
	}
}

func FuzzDeclarationTypeParameterLineBreak(f *testing.F) {
	startShortBudget(f)
	declarationLineBreakChapter(f)
	for _, key := range []string{"error", "schema-error", "service", "schema", "data"} {
		f.Add([]byte(key))
	}
	f.Fuzz(func(t *testing.T, input []byte) {
		keys := []string{"error", "schema-error", "service", "schema", "data"}
		key, suffix, _ := strings.Cut(string(input), ":")
		choice := 0
		if len(input) != 0 {
			choice = int(input[0]) % len(keys)
		}
		for i, k := range keys {
			if key == k {
				choice = i
				break
			}
		}
		key = keys[choice]
		gapChoice := 0
		for _, b := range []byte(suffix) {
			gapChoice = (gapChoice + int(b)) % 6
		}
		gap := []string{"\n", "\r\n", " /* newline\n */ ", " // newline\n", "\u2028", "\u2029"}[gapChoice]
		keyword := strings.ReplaceAll(key, "-", " ")
		// Every declaration keyword is contextual. Breaking between its words
		// and name restores precisely TypeScript's parse, including diagnostics.
		ordinary := strings.ReplaceAll(keyword, " ", gap) + gap + "Name" + gap + "<T,>(value: T) => value"
		vibe := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, ordinary, core.ScriptKindTS)
		ts := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, ordinary, core.ScriptKindTS)
		codes := func(sf *ast.SourceFile) string {
			result := ""
			for _, d := range sf.Diagnostics() {
				result += fmt.Sprintf("%d:%d;", d.Code(), d.Pos())
			}
			return result
		}
		if codes(vibe) != codes(ts) {
			Gap(t, "FuzzDeclarationTypeParameterLineBreak", "keyword:"+key, "Appendix A contextual declaration keywords must retain TypeScript diagnostics after a line break: %q; vibe=%s ts=%s", ordinary, codes(vibe), codes(ts))
		}
		source := keyword + " Name" + gap + "<T,>(value: T) => value"
		bodyless := key == "error" || key == "schema-error"
		if !bodyless {
			source = keyword + " Name" + gap + "<T> {}"
			if key == "schema" {
				source = keyword + " Name" + gap + "{ values: ReadonlyArray<string> }"
			}
			if key == "data" {
				source = keyword + " Name" + gap + "<T> { Ok { value: T } }"
			}
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		ruleQuote := declarationContextQuote
		if bodyless {
			ruleQuote = declarationLineBreakQuote
		}
		if ds := file.Diagnostics(); len(ds) != 0 {
			Gap(t, "FuzzDeclarationTypeParameterLineBreak", key, "Appendix A: %s; source %q has diagnostics %v", ruleQuote, source, ds)
			return
		}
		if bodyless {
			ss := file.Statements.Nodes
			if len(ss) != 2 || ss[0].Kind != ast.KindClassDeclaration || ss[0].TypeParameters() != nil || ss[1].Kind != ast.KindExpressionStatement || ss[1].Expression().Kind != ast.KindArrowFunction {
				Gap(t, "FuzzDeclarationTypeParameterLineBreak", key, "Appendix A requires a declaration then a generic arrow: %q", source)
				return
			}
		} else {
			// Valid non-bodyless declarations must stay declarations.
			for _, s := range file.Statements.Nodes {
				if s.Kind == ast.KindExpressionStatement {
					Gap(t, "FuzzDeclarationTypeParameterLineBreak", key, "Appendix A: %s; declaration became an expression in %q", declarationContextQuote, source)
					return
				}
			}
		}

		ExpectPending(t, "FuzzDeclarationTypeParameterLineBreak", key)
	})
}
