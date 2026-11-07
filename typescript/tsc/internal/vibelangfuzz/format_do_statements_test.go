package vibelangfuzz

import (
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const formatDoStatementsQuote = "never insert or remove a line break or parentheses that change the parse."

var formatDoStatementForms = []struct{ key, source string }{
	{"top", "(do { 1; });\n"},
	{"function", "export function read() { (do { 1; }); return 0; }\n"},
	{"if", "if (true) (do { 1; });\n"},
	{"else", "if (false) 0; else (do { 1; });\n"},
	{"while", "while (false) (do { 1; });\n"},
	{"label", "mark: (do { 1; });\n"},
	{"binary", "(do { 1; }) + 2;\n"},
	{"member", "(do { ({ value: 1 }); }).value;\n"},
	{"assertion", "(do { 1; }) as number;\n"},
	{"comma", "(do { 1; }), 2;\n"},
	{"nested", "(do { (do { 1; }); 2; });\n"},
	{"jsdoc", "/** keep */\n(do { 1; });\n"},
	{"comment", "// keep\n(do { /* inside */ 1; });\n"},
	{"initializer-control", "const value = do { 1; };\n"},
	{"do-while-control", "do { 1; } while (false);\n"},
	{"return-control", "export function read() { return do { 1; }; }\n"},
	{"whole-binary", "(do { 1; } + 2);\n"},
	{"call", "(do { () => 1; })();\n"},
	{"optional-call", "(do { () => 1; })?.();\n"},
	{"non-null", "(do { 1; })!;\n"},
	{"satisfies", "(do { 1; }) satisfies number;\n"},
	{"conditional", "(do { 1; }) ? 1 : 2;\n"},
	{"template", "(do { (parts: TemplateStringsArray) => parts[0]; })`x`;\n"},
	{"element", "(do { [1]; })[0];\n"},
	{"prefix-control", "void (do { 1; });\n"},
	{"nested-value", "(do { (do { 1; }); });\n"},
	{"nested-deep-value", "(do { (do { (do { 1; }); }); });\n"},
	{"postfix-member", "(do { ({ value: 1 }); }).value++;\n"},
}

func TestFormatDoStatementsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), formatDoStatementsQuote) {
		t.Fatalf("Chapter 7 no longer says %q", formatDoStatementsQuote)
	}
}

func FuzzFormatDoStatements(f *testing.F) {
	startShortBudget(f)
	if testing.Short() && !toolsFuzzing() {
		for _, key := range []string{"do-statement:binary:1", "do-statement:jsdoc:6", "do-statement:nested:3", "do-statement:do-while-control:0"} {
			f.Add([]byte(key))
		}
	} else {
		for _, form := range formatDoStatementForms {
			for mode := range 8 {
				f.Add([]byte("do-statement:" + form.key + ":" + strconv.Itoa(mode)))
			}
		}
	}
	formatter := toolsFormatter(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestFormatDoStatementsQuoted(t)
		form, mode := formatDoStatementForms[0], 0
		parts := strings.Split(string(data), ":")
		if len(parts) == 3 && parts[0] == "do-statement" {
			for _, known := range formatDoStatementForms {
				if parts[1] == known.key {
					form = known
				}
			}
			if value, err := strconv.ParseUint(parts[2], 10, 8); err == nil {
				mode = int(value) % 8
			}
		} else if len(data) > 0 {
			form = formatDoStatementForms[int(data[0])%len(formatDoStatementForms)]
			if len(data) > 1 {
				mode = int(data[1]) % 8
			}
		}
		source := form.source
		if mode&1 != 0 {
			source = strings.ReplaceAll(source, "1", "7")
		}
		if mode&4 != 0 {
			source = strings.ReplaceAll(source, "do {", "do /* head */ {")
		}
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		if syntax := formatSyntaxError(source); syntax != "" {
			t.Fatalf("invalid model input: %s\n%s", syntax, source)
		}
		once, err := vibelangfmt.Format("main.vibe", source, formatter)
		if err != nil {
			Gap(t, "FuzzFormatDoStatements", "shape:"+form.key, "Chapter 7: %q; valid expression statement refused: %v\n%s", formatDoStatementsQuote, err, source)
		}
		twice, err := vibelangfmt.Format("main.vibe", once, formatter)
		if err != nil || once != twice {
			Gap(t, "FuzzFormatDoStatements", "fixed-point:"+form.key, "Chapter 7 formatting is idempotent: %v\n%s\nthen:\n%s", err, once, twice)
		}
	})
}
