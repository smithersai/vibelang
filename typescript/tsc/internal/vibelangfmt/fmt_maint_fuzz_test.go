package vibelangfmt_test

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/format"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// @ stands for a source indentation level. VALUE is replaced separately so that
// continuation lines inside a literal retain their authored whitespace.
var formatForms = []struct{ name, body string }{
	{"main.vibe", "service Greeting: string {}\neffect function run() {\n@provide Greeting = VALUE {\n@@try Console.log(try Greeting)\n@}\n}"},
	{"main.vibe", "effect function run() {\n@for concurrent(VALUE.length) (const item of [1, 2]) {\n@@try Console.log(item)\n@}\n}"},
	{"main.vibe", "function run(value: string) {\n@return match (value) {\n@@when \"\": VALUE;\n@@default: value;\n@}\n}"},
	{"main.vibe", "schema Entry {\n@value: string;\n@tags: string[]\n}\nconst entry: Entry = { value: VALUE, tags: [] }"},
	{"main.vibe", "service Greeting: string {\n@static readonly defaultValue = () => VALUE\n}"},
	{"main.vibe", "task Read {\n@effect call(value: string): string!string {\n@@return value + VALUE\n@}\n}"},
	{"main.vibe", "workflow Greet {\n@effect call(value: string) {\n@@return value + VALUE\n@}\n}"},
	{"main.vibex", "const view = <><span title={VALUE}>left  right</span></>"},
}

// A regexp cannot contain a physical newline. Its escaped newline and
// delimiter-like characters must survive even when the enclosing head moves.
var formatLiterals = []string{
	"`hello\n@world`", "`outer ${`nested\n@value`}\n@tail`",
	"\"hello\\\n@world\"", "'hello\\\n@world'", "/[\\/{}`]+\\n/g",
}

func formatInput(form, literal, layout uint8) (name, source, token, prefix string) {
	example := formatForms[int(form)%len(formatForms)]
	indent := []string{"      ", "\t", "   ", "        "}[layout%4]
	newline := "\n"
	if layout&4 != 0 {
		newline = "\r\n"
	}
	prefix = []string{"", "\ufeff", "#!/usr/bin/env node\n", "\ufeff#!/usr/bin/env node\n"}[(layout>>3)%4]
	token = formatLiterals[int(literal)%len(formatLiterals)]
	token = strings.ReplaceAll(strings.ReplaceAll(token, "@", indent), "\n", newline)
	expression := token
	if strings.HasPrefix(token, "/") {
		expression += ".source"
	}
	body := strings.ReplaceAll(strings.ReplaceAll(example.body, "@", indent), "\n", newline)
	source = prefix + strings.ReplaceAll(body, "VALUE", expression) + newline
	name = example.name
	return
}

func formatHost(name string) vibelangfmt.TypeScriptFormatter {
	if !strings.HasSuffix(name, ".vibex") {
		return foldkitLSFormatter
	}
	return func(text string) (string, error) {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.tsx", PathKey: "/main.tsx"}, text, core.ScriptKindTSX)
		ctx := format.WithFormatCodeSettings(context.Background(), lsutil.GetDefaultFormatCodeSettings(), "\n")
		return core.ApplyBulkEdits(text, format.FormatDocument(ctx, file)), nil
	}
}

func checkFormatAgain(t *testing.T, name, once string, host vibelangfmt.TypeScriptFormatter) {
	t.Helper()
	twice, err := vibelangfmt.Format(name, once, host)
	if err != nil || twice != once {
		t.Fatalf("second format: %v\nfirst: %q\nsecond: %q", err, once, twice)
	}
}

func FuzzFormatHeldForms(f *testing.F) {
	for form := range formatForms {
		for literal := range formatLiterals {
			f.Add(uint8(form), uint8(literal), uint8(0))
			f.Add(uint8(form), uint8(literal), uint8(31))
		}
	}
	f.Fuzz(func(t *testing.T, form, literal, layout uint8) {
		name, source, token, prefix := formatInput(form, literal, layout)
		host := formatHost(name)
		once, err := vibelangfmt.Format(name, source, host)
		if err != nil {
			t.Fatalf("formatting valid %s: %v\n%q", name, err, source)
		}
		if !strings.HasPrefix(once, prefix) || !strings.Contains(once, token) {
			t.Fatalf("lost prefix %q or literal %q\nresult: %q", prefix, token, once)
		}
		checkFormatAgain(t, name, once, host)
	})
}

func FuzzFormatSource(f *testing.F) {
	for form := range formatForms {
		name, source, _, _ := formatInput(uint8(form), uint8(form), 24)
		f.Add(source, name == "main.vibex")
	}
	f.Add("const el = <span>{", true)
	f.Add("effect function run() { provide Service = `", false)
	f.Fuzz(func(t *testing.T, source string, jsx bool) {
		if len(source) > 8192 {
			t.Skip()
		}
		name := "main.vibe"
		if jsx {
			name = "main.vibex"
		}
		// Isolate the projection round trip on arbitrary (also incomplete)
		// input. The structured target above uses the real TS/TSX formatter.
		host := func(text string) (string, error) { return text, nil }
		once, err := vibelangfmt.Format(name, source, host)
		if err != nil {
			if once != "" {
				t.Fatalf("formatter returned partial output on error: %q", once)
			}
			return
		}
		checkFormatAgain(t, name, once, host)
	})
}
