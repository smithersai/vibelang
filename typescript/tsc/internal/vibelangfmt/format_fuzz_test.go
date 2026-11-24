package vibelangfmt_test

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/format"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// FuzzFormatInvariants fuzzes vibelangfmt.Format directly inside internal/vibelangfmt
// using the built-in TypeScript formatter. It enforces:
//
//   - Format never panics on any UTF-8 input.
//   - A file with a syntax error MUST be refused with a non-nil error (#648).
//   - A formatted file parses cleanly, satisfies SameProgram(source, once),
//     and is idempotent under a second Format pass (twice == once).
func FuzzFormatInvariants(f *testing.F) {
	seeds := []string{
		"export effect function load(id: string): string!Boom { return try fetch(id) }\n",
		"export effect function* ticks() { yield 1; try sleep(\"1 second\"); yield 2 }\n",
		"export error NotFound { id: string }\nexport error Timeout\n",
		"export schema User { id: string; nick?: string; readonly role: \"a\" | \"b\"; items: Held[] }\n",
		"export schema Alias = Held[]\nexport schema error FileErr { source: Held }\n",
		"export service Users { static readonly key = \"app/Users\"; find(id: string): User!NotFound }\n",
		"export data Delivery { Waiting; Sent { tracking: string } }\n",
		// Issue #447: one-line braced `for concurrent` body
		"export effect function run(xs: string[]) {\n  for concurrent (const x of xs) { try work(x) }\n}\n",
		"export effect function run(xs: string[]) {\n  for concurrent(4) (const x of xs) { try work(x) }\n}\n",
		"export effect function run(xs: string[]) {\n  for try (const x of xs) { try work(x) }\n}\n",
		"export effect function run() {\n  provide Store = impl { return try work() }\n}\n",
		"export effect function run() {\n  uninterruptible { restore { return try work() } }\n}\n",
		"export function f(x: number) {\n  return match (x) { when 1: \"one\"; default: \"other\"; }\n}\n",
		"export function isCheck(x: unknown) { const a = x is 1; const b = x is 0 or 1; return a || b }\n",
		"export function piped(n: number) { return n |> % + 1 |> String(%) }\n",
		"export function pat(o: any) { const { 1n: x } = o; return x }\n",
		"export module text {\n  export const a = 1\n}\nimport { a } from text\n",
		"export const el = <Box value={1} />;\n",
		// Invalid syntax controls (#648): MUST be refused with an error
		"const x = (\n",
		"export function broken(\n",
		"match (x) { when : }\n",
	}
	for _, s := range seeds {
		f.Add(uint8(0), s)
		f.Add(uint8(1), s)
	}

	f.Fuzz(func(t *testing.T, ext uint8, source string) {
		if !utf8.ValidString(source) || len(source) > 16<<10 {
			return
		}
		fileName := "/fuzz.vibe"
		kind := core.ScriptKindTS
		if ext%2 == 1 {
			fileName = "/fuzz.vibex"
			kind = core.ScriptKindTSX
		}
		formatter := func(text string) (string, error) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{
				FileName: tspath.RootedFilePath(fileName),
				PathKey:  tspath.PathKey(fileName),
			}, text, kind)
			ctx := format.WithFormatCodeSettings(
				t.Context(),
				lsutil.GetDefaultFormatCodeSettings(),
				"\n",
			)
			edits := format.FormatDocument(ctx, file)
			if len(edits) == 0 {
				return text, nil
			}
			var out strings.Builder
			cursor := 0
			for _, edit := range edits {
				start := edit.TextRange.Pos()
				end := edit.TextRange.End()
				if start < cursor || end < start || end > len(text) {
					continue
				}
				out.WriteString(text[cursor:start])
				out.WriteString(edit.NewText)
				cursor = end
			}
			out.WriteString(text[cursor:])
			return out.String(), nil
		}

		sf := parser.ParseSourceFile(ast.SourceFileParseOptions{
			FileName: tspath.RootedFilePath(fileName),
			PathKey:  tspath.PathKey(fileName),
		}, source, kind)
		hasSyntaxErr := false
		for _, d := range sf.Diagnostics() {
			if d.Category() == diagnostics.CategoryError {
				hasSyntaxErr = true
				break
			}
		}

		once, err := vibelangfmt.Format(fileName, source, formatter)
		if hasSyntaxErr {
			// Issue #648: an unparsable file MUST return an error, never succeed silently.
			if err == nil {
				t.Fatalf("%s: Format succeeded on a file with a syntax error:\n%s\noutput:\n%s", fileName, source, once)
			}
			return
		}
		if err != nil {
			return
		}

		// Formatted output must parse cleanly and preserve program meaning.
		sfOnce := parser.ParseSourceFile(ast.SourceFileParseOptions{
			FileName: tspath.RootedFilePath(fileName),
			PathKey:  tspath.PathKey(fileName),
		}, once, kind)
		for _, d := range sfOnce.Diagnostics() {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("%s: Format produced a syntax error (%s):\n--- before ---\n%s\n--- after ---\n%s", fileName, d.String(), source, once)
			}
		}
		if err := vibelangfmt.SameProgram(source, once); err != nil {
			t.Fatalf("%s: SameProgram failed after Format: %v\n--- before ---\n%s\n--- after ---\n%s", fileName, err, source, once)
		}

		// Idempotence: formatting a second time must succeed and change nothing.
		twice, err := vibelangfmt.Format(fileName, once, formatter)
		if err != nil {
			t.Fatalf("%s: second Format pass failed (%v):\n%s", fileName, err, once)
		}
		if twice != once {
			t.Fatalf("%s: Format is not idempotent:\n--- once ---\n%s\n--- twice ---\n%s", fileName, once, twice)
		}
	})
}
