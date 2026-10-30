package vibelangfuzz

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/format"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// FuzzFormat formats a .vibe source with vibelangfmt.Format, the formatter
// that dprint's plugin and the language server share (D276), and checks what
// Chapter 28's "Rewrites keep meaning" (D372) promises of it:
//
//   - It never panics or hangs.
//   - A file with a syntax error fails instead of changing (D276).
//   - A file it formats still parses without error, and parses to the same
//     program: vibelangfmt.SameProgram holds, which allows only "whitespace,
//     line breaks, parentheses that do not change the parse, braces around a
//     body of one statement, trailing commas, and the order of names inside
//     one import's braces".
//   - Comments survive, next to the code they describe.
//   - Formatting a second time changes nothing ("Idempotence").
//   - The formatted program is equivalent "with the same types" and reports
//     no new error: it compiles to the same diagnostic codes and categories.
//
// D276 requires syntactically valid files to format; an inability to preserve
// their program is a tooling gap, rather than a successful formatting result.
//
// The TypeScript formatter is the language server's own (internal/format,
// as format.FormatDocument calls it for a .vibe file); set VIBELANG_DPRINT to
// a dprint binary to format with dprint and the repository's TypeScript
// style instead, as vibelangfmt's own tests do.
func FuzzFormat(f *testing.F) {
	startShortBudget(f)
	seen := map[string]bool{}
	for _, seed := range toolsSample(append(CaseSeeds(), SnippetSeeds()...), 120, 0, nil) {
		for _, name := range toolsVibeFiles(seed.Files) {
			if text := seed.Files[name]; !seen[text] {
				seen[text] = true
				f.Add(text)
			}
		}
	}
	w := NewWorkspace(f)
	formatter := toolsFormatter(f)
	f.Fuzz(func(t *testing.T, source string) {
		toolsGuard(t, "FuzzFormat", func() {
			if len(source) > 24<<10 || toolsLeftOut("FuzzFormat", map[string]string{"main.vibe": source}) {
				return
			}
			var once string
			var err error
			toolsRun(t, "FuzzFormat", "format", source, nil, func() { once, err = vibelangfmt.Format("main.vibe", source, formatter) })
			if syntax := formatSyntaxError(source); syntax != "" {
				// D276: "so does a file with a syntax error": it fails.
				if err == nil && once != source {
					Gap(t, "FuzzFormat", "format:syntax-error", "a file with a syntax error (%s) was formatted:\n%s\nto:\n%s", syntax, source, once)
				}
				return
			}
			if err != nil {
				first := "none"
				if statements := toolsParse("main.vibe", source).Statements.Nodes; len(statements) > 0 {
					first = strings.TrimPrefix(statements[0].Kind.String(), "Kind")
				}
				// A refusal whose own guard saw the program change names the
				// change, wherever the file starts.
				if _, after, ok := strings.Cut(err.Error(), "formatting changed the program: "); ok {
					if _, change, ok := strings.Cut(after, ": "); ok {
						change, _, _ = strings.Cut(change, "\n")
						first = "changed:" + toolsSlug(strings.Map(func(r rune) rune {
							if r >= '0' && r <= '9' {
								return -1
							}
							return r
						}, change))
					}
				}
				// A refusal whose TypeScript projection does not parse names the
				// projection's error, so one known refusal leaves the others checked.
				if _, after, ok := strings.Cut(err.Error(), "does not parse at "); ok {
					if _, message, ok := strings.Cut(after, ": "); ok {
						message, _, _ = strings.Cut(message, "\n")
						first += ":" + toolsSlug(message)
					}
				}
				Gap(t, "FuzzFormat", "format:refusal:"+first, "D276: the formatter refused a file without syntax errors (%v):\n%s", err, source)
			}
			// Chapter 28, "Rewrites keep meaning", and D276: the result parses to
			// the program the source parses to.
			if syntax := toolsSyntaxError("main.vibe", once); syntax != "" {
				Gap(t, "FuzzFormat", "format:parse", "the formatted file has a syntax error (%s):\n%s\nformatted:\n%s", syntax, source, once)
			}
			if once != source {
				before := toolsCompile(t, w, "FuzzFormat", Single(source).Files)
				defer before.Remove()
				after := toolsRecompile(t, w, before, Single(once).Files)
				// D276 and D372: independently compile both projects with the same
				// configuration. The formatter's own SameProgram guard is secondary.
				if difference := toolsFormatDifference(before, after); difference != "" {
					Gap(t, "FuzzFormat", "format:emit:"+toolsFormatKey(before, after), "%s\nsource:\n%s\nformatted:\n%s", difference, source, once)
				}
			}
			if err := vibelangfmt.SameProgram(source, once); err != nil {
				Gap(t, "FuzzFormat", "format:same-program", "formatting changed the program (%v):\n%s\nformatted:\n%s", err, source, once)
			}
			// D372: "Comments survive every rewrite."
			if lost := toolsLostComments(source, once); len(lost) > 0 {
				Gap(t, "FuzzFormat", "format:comments", "formatting lost the comments %q:\n%s\nformatted:\n%s", lost, source, once)
			}
			if added := toolsLostComments(once, source); len(added) > 0 {
				Gap(t, "FuzzFormat", "format:comments", "formatting added the comments %q:\n%s\nformatted:\n%s", added, source, once)
			}
			if moved := toolsMovedComments(source, once); len(moved) > 0 {
				Gap(t, "FuzzFormat", "format:comment-neighbors", "D372: formatting moved comments %q:\n%s\nformatted:\n%s", moved, source, once)
			}
			// Chapter 28, "Idempotence": formatting a second time changes nothing.
			var twice string
			toolsRun(t, "FuzzFormat", "format", once, nil, func() { twice, err = vibelangfmt.Format("main.vibe", once, formatter) })
			if err != nil {
				Gap(t, "FuzzFormat", "format:idempotence", "the formatter refuses its own output (%v):\n%s\nformatted:\n%s", err, source, once)
			} else if twice != once {
				// The key says whether the TypeScript formatter's own lack of a
				// fixed point causes it, so that a campaign that knows that gap
				// still finds VibeLang's.
				Gap(t, "FuzzFormat", "format:idempotence"+toolsTypeScriptIdempotence(source, formatter), "formatting twice changes the file:\n%s\nonce:\n%s\ntwice:\n%s", source, once, twice)
			}

		})
	})
}

// toolsFormatter returns the TypeScript formatter that the language server
// gives vibelangfmt.Format (internal/format's formatVibeLangDocument), or
// dprint when VIBELANG_DPRINT names one.
func toolsFormatter(tb testing.TB) vibelangfmt.TypeScriptFormatter {
	if binary := os.Getenv("VIBELANG_DPRINT"); binary != "" {
		config := filepath.Join(Root(), "typescript/tsc/internal/vibelangfmt/testdata/dprint.json")
		return func(text string) (string, error) {
			command := exec.Command(binary, "fmt", "--config", config, "--stdin", "file.ts")
			command.Stdin = strings.NewReader(text)
			var stdout, stderr bytes.Buffer
			command.Stdout, command.Stderr = &stdout, &stderr
			if err := command.Run(); err != nil {
				return "", fmt.Errorf("%w: %s", err, stderr.String())
			}
			return stdout.String(), nil
		}
	}
	ctx := format.WithFormatCodeSettings(context.Background(), lsutil.GetDefaultFormatCodeSettings(), "\n")
	return func(text string) (string, error) {
		projection := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/vibelang-format.ts", PathKey: "/vibelang-format.ts"}, text, core.ScriptKindTS)
		return core.ApplyBulkEdits(text, format.FormatDocument(ctx, projection)), nil
	}
}

// toolsFormatDifference compares independently parsed JavaScript/declaration
// output and diagnostic identities/categories/counts under the same options.
// Harmless emitted spelling/layout changes are permitted; meaning is retained.
func toolsFormatDifference(before, after *Result) string {
	codes := func(r *Result) []string {
		var codes []string
		for _, d := range r.Diagnostics {
			codes = append(codes, fmt.Sprintf("%s%d:%s", d.Source(), d.Code(), d.Category().Name()))
		}
		slices.Sort(codes)
		return codes
	}
	if a, b := codes(before), codes(after); !slices.Equal(a, b) {
		return fmt.Sprintf("formatting changed diagnostics from %v to %v", a, b)
	}
	if before.EmitSkipped != after.EmitSkipped {
		return "formatting changed whether emit was skipped"
	}
	outputs := func(r *Result) map[string]string {
		files := map[string]string{}
		for name, text := range r.Outputs {
			if strings.HasSuffix(name, ".js") || strings.HasSuffix(name, ".mjs") || strings.HasSuffix(name, ".cjs") || strings.HasSuffix(name, ".jsx") || strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".d.mts") || strings.HasSuffix(name, ".d.cts") {
				files[name] = text
			}
		}
		return files
	}
	a, b := outputs(before), outputs(after)
	if len(a) != len(b) {
		return "formatting changed the emitted JavaScript/declaration files"
	}
	for name, text := range a {
		other, ok := b[name]
		if !ok {
			return fmt.Sprintf("formatting removed emitted %s", name)
		}
		left, err := toolsFormatTree(name, text)
		if err != nil {
			return fmt.Sprintf("cannot compare original %s: %v", name, err)
		}
		right, err := toolsFormatTree(name, other)
		if err != nil {
			return fmt.Sprintf("cannot compare formatted %s: %v", name, err)
		}
		if left != right {
			return fmt.Sprintf("formatting changed %s's parsed structure", name)
		}
	}
	return ""
}

// toolsFormatKey names a difference toolsFormatDifference reports, so that a
// known one does not hide another: the diagnostic codes formatting lost and
// added, as lost:EK4618 or added:TS2304+TS7006, diagnostics when the same
// codes changed category or count, or js when only the emitted JavaScript
// changed.
func toolsFormatKey(before, after *Result) string {
	codes := func(r *Result) map[string]bool {
		set := map[string]bool{}
		for _, d := range r.Diagnostics {
			source := d.Source()
			if source == "" {
				source = "TS"
			}
			set[fmt.Sprintf("%s%d", source, d.Code())] = true
		}
		return set
	}
	b, a := codes(before), codes(after)
	var lost, added []string
	for code := range b {
		if !a[code] {
			lost = append(lost, code)
		}
	}
	for code := range a {
		if !b[code] {
			added = append(added, code)
		}
	}
	slices.Sort(lost)
	slices.Sort(added)
	var parts []string
	if len(lost) > 0 {
		parts = append(parts, "lost:"+strings.Join(lost, "+"))
	}
	if len(added) > 0 {
		parts = append(parts, "added:"+strings.Join(added, "+"))
	}
	if len(parts) > 0 {
		return strings.Join(parts, ":")
	}
	if strings.HasPrefix(toolsFormatDifference(before, after), "formatting changed diagnostics") {
		return "diagnostics"
	}
	return "js"
}

// toolsTypeScriptIdempotence returns ":typescript" when formatting is
// idempotent once the TypeScript formatter runs to its own fixed point:
// then the second pass's change comes from the TypeScript formatter, not
// from VibeLang's encoding. It returns "" otherwise.
func toolsTypeScriptIdempotence(source string, formatter vibelangfmt.TypeScriptFormatter) string {
	fixpoint := func(text string) (string, error) {
		for range 8 {
			next, err := formatter(text)
			if err != nil || next == text {
				return next, err
			}
			text = next
		}
		return text, nil
	}
	once, err := vibelangfmt.Format("main.vibe", source, fixpoint)
	if err != nil {
		return ""
	}
	if twice, err := vibelangfmt.Format("main.vibe", once, fixpoint); err == nil && twice == once {
		return ":typescript"
	}
	return ""
}

// toolsSlug turns a message into a pending key's word: lower-case letters and
// digits, with a hyphen for each run of anything else.
func toolsSlug(message string) string {
	var b strings.Builder
	hyphen := false
	for _, r := range strings.ToLower(message) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			if hyphen && b.Len() > 0 {
				b.WriteByte('-')
			}
			b.WriteRune(r)
			hyphen = false
		} else {
			hyphen = true
		}
	}
	return b.String()
}

// formatSyntaxError returns the first syntax error of a .vibe source, or "".
// `provide` is a statement whose block is code of the enclosing function
// (Chapter 4: "`return` returns from the function"), so in expression
// position it has no grammar: EK1017, "`provide` used as an expression
// instead of a statement". The parser recovers it as an error node,
// $patternError(1017), which the checker reports, rather than as a parse
// diagnostic, and the formatter has no TypeScript form for it (D276 writes a
// provide block as a labeled block, a statement).
func formatSyntaxError(source string) string {
	if syntax := toolsSyntaxError("main.vibe", source); syntax != "" {
		return syntax
	}
	at := -1
	var visit ast.Visitor
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) && node.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0 && node.Expression().Text() == "$patternError" {
			if arguments := node.Arguments(); len(arguments) > 0 && arguments[0].Text() == "1017" {
				at = node.Pos()
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	toolsParse("main.vibe", source).AsNode().ForEachChild(visit)
	if at >= 0 {
		return fmt.Sprintf("%d: EK1017, provide used as an expression", at)
	}
	return ""
}
