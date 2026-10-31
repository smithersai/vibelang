package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// Chapter 7 and VIP-34: "Comments and their code associations survive,
// including JSDoc, compiler/linter/tool directives and directive-prologue meaning."
// D372 permits whitespace changes and keeps comments next to their code.
const formatContractCommentQuote = "Comments and their code associations survive, including JSDoc, compiler/linter/tool directives and directive-prologue meaning."

//gate:spec-tests
func TestFormatContractCommentQuote(t *testing.T) {
	checkFormatContractCommentQuote(t)
}

func checkFormatContractCommentQuote(tb testing.TB) {
	tb.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), formatContractCommentQuote) {
		tb.Fatal("chapter 7 changed its comment-association contract")
	}
}

func TestFormatContractCommentNeighbors(t *testing.T) {
	source := "// compiler-gap: pending VIP-3\n" +
		"const e: User!!= load()     // const e: User!! = load()\n" +
		"if (x as number !== 0) { }  // (x as number) !== 0\n" +
		"interface Clock {\n" +
		"  now(): number!!           // two members, not R = later\n" +
		"  later(): number!!\n}\n" +
		"const a: User!(\n" +
		"  NotFound | Timeout) = load()   // one type: the slot starts on the line of its !\n"
	formatted, err := vibelangfmt.Format("main.vibe", source, toolsFormatter(t))
	if err != nil {
		t.Fatal(err)
	}
	if source == formatted {
		t.Fatal("witness did not exercise formatting")
	}
	if moved := toolsMovedComments(source, formatted); len(moved) > 0 {
		t.Fatalf("layout changed comment anchors: %v\n%s", moved, formatted)
	}
}

// The keyed generator varies contract spacing, occurrence counts, comments,
// newline style and indentation. Moving the comment to another identical
// member must still fail, even with an earlier compact contract initializer.
func checkFormatContractComments(t *testing.T, key string, choice uint8) {
	t.Helper()
	kinds := []string{"line", "block", "jsdoc"}
	if !slices.Contains(kinds, key) {
		key = kinds[len(key)%len(kinds)]
	}
	comment := map[string]string{"line": "// clock", "block": "/* clock */", "jsdoc": "/** clock */"}[key]
	newline := "\n"
	if choice&1 != 0 {
		newline = "\r\n"
	}
	indent := strings.Repeat(" ", 1+int(choice>>1&7))
	count := 1 + int(choice>>4&3)
	binding := "const"
	if choice&64 != 0 {
		binding = "let"
	}
	if choice&128 != 0 {
		indent = strings.Repeat("\t", 1+int(choice>>1&7))
	}
	prefix := strings.Repeat(binding+" e: number!!= load();\n", count)
	if choice&128 != 0 {
		prefix = "module labels { export const value = 1 }\n" + prefix
	}
	member := "now(): number!!"
	before := prefix + "interface Clock {\n" + indent + member + " " + comment + "\n" + indent + member + "\n}\n"
	after := strings.ReplaceAll(before, "!!=", "!! =")
	after = strings.ReplaceAll(after, "\n"+indent, "\n"+indent+indent)
	before = strings.ReplaceAll(before, "\n", newline)
	after = strings.ReplaceAll(after, "\n", newline)
	if moved := toolsMovedComments(before, after); len(moved) != 0 {
		Gap(t, "FuzzFormatContractComments", "format:comment-neighbors:contract-spacing:"+key, "%s: whitespace moved comments: %v\nbefore:\n%s\nafter:\n%s", formatContractCommentQuote, moved, before, after)
	}
	relocated := strings.Replace(after, member+" "+comment, member, 1)
	at := strings.LastIndex(relocated, member) + len(member)
	relocated = relocated[:at] + " " + comment + relocated[at:]
	if moved := toolsMovedComments(before, relocated); len(moved) != 1 {
		Gap(t, "FuzzFormatContractComments", "format:comment-neighbors:member-relocation:"+key, "%s: expected the moved comment, got %v\n%s", formatContractCommentQuote, moved, relocated)
	}
	// Ordinary equality and non-null-expression tokens keep their identities.
	expression := "const changed = a !== b; const also = a != b; value! == other;"
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, expression)
	for _, form := range forms {
		if form.Kind == parser.VibeSyntaxEffectType {
			t.Fatal("equality control was parsed as a contract")
		}
	}
	if got := toolsCommentNeighbors(expression + " /* marker */"); len(got) != 1 || !strings.Contains(got[0], "<end>") {
		t.Fatalf("lost equality control comment: %v", got)
	}
}

func TestFormatContractCommentNeighborhood(t *testing.T) {
	for _, key := range []string{"line", "block", "jsdoc"} {
		for choice := 0; choice < 128; choice++ {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkFormatContractComments(t, key, uint8(choice)) })
		}
	}
}

func FuzzFormatContractComments(f *testing.F) {
	startShortBudget(f)
	checkFormatContractCommentQuote(f)
	for _, key := range []string{"line", "block", "jsdoc"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(127))
		f.Add(key, uint8(255))
	}
	f.Fuzz(checkFormatContractComments)
}

// Expression equality is not a contract boundary. Splitting its operator
// would erase a real change in a comment's neighboring code.
func TestFormatContractCommentEqualityTokens(t *testing.T) {
	for _, pair := range [][2]string{
		{"const v = x != /* note */ y;", "const v = x! = /* note */ y;"},
		{"const v = x !== /* note */ y;", "const v = x! == /* note */ y;"},
	} {
		if moved := toolsMovedComments(pair[0], pair[1]); len(moved) != 1 {
			t.Fatalf("expression operator identities were erased: %v", moved)
		}
	}
}

// Module declarations create virtual source files, so the syntax collector's
// synthetic filename must be rooted even when only comment anchors are needed.
func TestFormatContractCommentModules(t *testing.T) {
	for _, before := range []string{
		"module labels { export const value = 1 } // module\n",
		"module labels { export const value = 1 }\nconst e: number!!= load()\ninterface Clock {\n  now(): number!! // clock\n  later(): number!!\n}\n",
	} {
		after := strings.ReplaceAll(before, "!!=", "!! =")
		if moved := toolsMovedComments(before, after); len(moved) != 0 {
			t.Fatalf("module layout moved comments: %v", moved)
		}
	}
}
