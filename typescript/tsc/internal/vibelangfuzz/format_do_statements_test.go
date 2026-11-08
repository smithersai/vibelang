package vibelangfuzz

import (
	"os"
	"path/filepath"
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
	// The same statement inside do, effect and arrow bodies: at a body's start
	// and end, and after a declaration or another statement, whose semicolon
	// a formatter with an asi style drops. --fix writes Option.match this way,
	// as `do { const $optionInput = ...; (do { ... }); }`.
	{"smithers-code-storage-minimal", "export const g = (x: number) => do { (do { x * 2 }); }\n"},
	{"smithers-option-match-temporary", "export const g = (x: number) => do { const $optionInput = x + 1; (do { $optionInput * 2; }); };\n"},
	{"do-arrow-start", "export const g = (x: number) => do { (do { x * 2; }); x + 1; };\n"},
	{"do-initializer-start", "export const g = (x: number) => { const r = do { (do { x * 2; }); x; }; return r; };\n"},
	{"do-initializer-end", "export const g = (x: number) => { const r = do { x; (do { x * 2; }); }; return r; };\n"},
	{"do-initializer-after-declaration", "export const g = (x: number) => { const r = do { const y = x + 1; (do { y * 2; }); y; }; return r; };\n"},
	{"effect-start", "export effect function g(x: number) {\n  (do { x * 2; });\n  return x;\n}\n"},
	{"effect-end", "export effect function g(x: number) {\n  const y = x + 1;\n  (do { y * 2; });\n}\n"},
	{"effect-after-declaration", "export effect function g(x: number) {\n  const y = x + 1;\n  (do { y * 2; });\n  return y;\n}\n"},
	{"effect-arrow", "export const g = effect (x: number) => { (do { x * 2; }); return x; };\n"},
	{"function-after-declaration", "export function g(x: number) {\n  const y = x + 1;\n  (do { y * 2; });\n  return y;\n}\n"},
	{"jsdoc-after-declaration", "export function g(x: number) {\n  const y = x + 1;\n  /** keep */\n  (do { y * 2; });\n  return y;\n}\n"},
	{"after-unbraced-if", "export function g(x: number) {\n  if (x) x = x + 1;\n  (do { x * 2; });\n}\n"},
	{"after-braced-if", "export function g(x: number) {\n  if (x) { x = x + 1; }\n  (do { x * 2; });\n}\n"},
	{"after-function-declaration", "function f() {}\n(do { 1; });\n"},
}

// formatDoStatementSmithers names the Smithers witnesses: the minimized
// CodeStorage program and the --fix Option.match temporary it came from.
var formatDoStatementSmithers = map[string]string{
	"smithers-code-storage-minimal":   "export const g = (x: number) => do { (do { x * 2 }); }\n",
	"smithers-option-match-temporary": "const $optionInput = x + 1; (do { $optionInput * 2; });",
}

func TestFormatDoStatementsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), formatDoStatementsQuote) {
		t.Fatalf("Chapter 7 no longer says %q", formatDoStatementsQuote)
	}
}

// TestFormatDoStatementsCorpus checks that every saved input names a form
// by key, so reordering the list never changes what a file tests, and that
// the Smithers files still hold their minimized programs.
func TestFormatDoStatementsCorpus(t *testing.T) {
	forms := map[string]string{}
	for _, form := range formatDoStatementForms {
		if _, seen := forms[form.key]; seen {
			t.Fatalf("form key %q appears twice", form.key)
		}
		forms[form.key] = form.source
	}
	dir := filepath.Join(repoTestdata(), "fuzz", "FuzzFormatDoStatements")
	names, err := filepath.Glob(filepath.Join(dir, "*"))
	if err != nil || len(names) == 0 {
		t.Fatalf("no saved inputs in %s: %v", dir, err)
	}
	saved := map[string]bool{}
	for _, name := range names {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(string(data)), "\n")
		quoted, ok := strings.CutPrefix(lines[len(lines)-1], "[]byte(")
		input, err := strconv.Unquote(strings.TrimSuffix(quoted, ")"))
		parts := strings.Split(input, ":")
		if !ok || err != nil || len(lines) != 2 || len(parts) != 3 || parts[0] != "do-statement" {
			t.Fatalf("%s is not a keyed do-statement input", filepath.Base(name))
		}
		if _, known := forms[parts[1]]; !known {
			t.Fatalf("%s names unknown form %q", filepath.Base(name), parts[1])
		}
		saved[parts[1]] = true
	}
	for key, pattern := range formatDoStatementSmithers {
		if !saved[key] || !strings.Contains(forms[key], pattern) {
			t.Fatalf("Smithers witness %q lost its saved input or its minimized program %q", key, pattern)
		}
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
