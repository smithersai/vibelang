package vibelang

import (
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/lint"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// TS377000, "@effect-diagnostics directive has no effect", is Effect's
// warning for a next-line directive that suppressed nothing. The rename to
// .vibe causes it: a build runs on a .vibe file only the Effect rules VibeLang
// does not answer (effecttsgo/lint/vibe.go), so a directive for
// overriddenSchemaConstructor, globalDate or effectSucceedWithVoid silences
// nothing there (t3code, 13 sites in 5 projects, 2026-11-04). --fix rewrites
// each such directive. A rule whose VibeLang port reports on the directive's
// next line, as EK4814 answers overriddenSchemaConstructor, keeps its
// setting under that code when a comment can adjust that code; the other
// rules go; the directive's explanation stays; a comment left with nothing
// goes, line and all:
//
//	// @effect-diagnostics-next-line overriddenSchemaConstructor:off   // @vibelang-diagnostics-next-line EK4814:off
//	// @effect-diagnostics-next-line globalDate:off                    removed
//	// @effect-diagnostics-next-line effectSucceedWithVoid:off - why  // why
//	f() // @effect-diagnostics-next-line globalDate:off               f()
const effectDirectiveUnusedCode = 377000

const effectNextLineMarker = "@effect-diagnostics-next-line"

// The rule:severity pairs of a directive, as Effect's parser reads them
// (effecttsgo/internal/directives), then the separator before its prose.
var (
	effectDirectiveRule      = regexp.MustCompile(`^\s*(\w+|\*):(\w+(?:-\w+)?)`)
	effectDirectiveSeparator = regexp.MustCompile(`^(?:--|-|:|\x{2014}|\x{2013})(?:\s|$)`)
)

// A line that names its next line, as an eslint-disable-next-line or another
// directive does, would name a different line once the line after it goes.
var namesNextLine = regexp.MustCompile(`next-line|-ignore\b`)

// hasEffectNextLineDirective reports whether one of files holds a next-line
// directive, so a pass without one builds no program for them.
func hasEffectNextLineDirective(files []*ast.SourceFile) bool {
	return slices.ContainsFunc(files, func(file *ast.SourceFile) bool { return strings.Contains(file.Text(), effectNextLineMarker) })
}

// removeDeadEffectDirectives rewrites, in each fixable file of program, the
// @effect-diagnostics-next-line comments program reports as TS377000
// (deadEffectDirectiveEdits), when the program then adds no error to g's
// baseline, and records them in result and texts as fixes of TS377000.
func removeDeadEffectDirectives(g *fixGate, fs vfs.FS, program *compiler.Program, texts map[tspath.RootedFilePath]string, result *FixResult) {
	cleaned := map[tspath.RootedFilePath]string{}
	counts := map[tspath.RootedFilePath]int{}
	for _, file := range g.scope.fixable(program) {
		if !strings.Contains(file.Text(), effectNextLineMarker) {
			continue
		}
		var positions []int
		reported := map[int]map[string]bool{} // VibeLang codes by 0-based line
		for _, d := range program.GetSemanticDiagnostics(g.ctx, file) {
			if d.File() != file {
				continue
			}
			switch {
			case d.Code() == effectDirectiveUnusedCode:
				positions = append(positions, d.Pos())
			case d.Source() == diagnosticSource:
				line := scanner.ComputeLineOfPosition(file.ECMALineMap(), d.Pos())
				if reported[line] == nil {
					reported[line] = map[string]bool{}
				}
				reported[line][fmt.Sprintf("%s%04d", diagnosticSource, d.Code())] = true
			}
		}
		port := func(pos int, rule string) string {
			code := lint.VibeLangPort(rule)
			// A comment changes only an adjustable code (D241); EK4402 stays an error.
			if code != "" && slices.Contains(core.VibeLangAdjustableCodes, code) && reported[scanner.ComputeLineOfPosition(file.ECMALineMap(), pos)+1][code] {
				return code
			}
			return ""
		}
		edits := deadEffectDirectiveEdits(file, positions, port)
		if len(edits) == 0 {
			continue
		}
		cleaned[file.FileName()] = applyEdits(file.Text(), edits)
		counts[file.FileName()] = len(edits)
	}
	if len(cleaned) == 0 {
		return
	}
	g.progress.enter("directives", 0, fixesApplied(result), len(result.Refused), "rewriting dead @effect-diagnostics directives")
	if _, ok := g.passes(texts, cleaned); !ok {
		return
	}
	names := make([]tspath.RootedFilePath, 0, len(cleaned))
	for name := range cleaned {
		names = append(names, name)
	}
	slices.SortFunc(names, tspath.RootedFilePath.Compare)
	for _, name := range names {
		fixed := result.Files[name]
		if fixed == nil {
			original, _ := fs.ReadFile(name)
			fixed = &FixedFile{Original: original, Counts: map[int32]int{}}
			result.Files[name] = fixed
			result.Order = append(result.Order, name)
		}
		if fixed.NativeCounts == nil {
			fixed.NativeCounts = map[int32]int{}
		}
		fixed.NativeCounts[effectDirectiveUnusedCode] += counts[name]
		fixed.Text = cleaned[name]
		texts[name] = cleaned[name]
	}
	g.verified(texts)
}

// deadEffectDirectiveEdits returns the edits that rewrite each directive
// starting at one of positions in file (deadEffectDirectiveEdit). port
// returns the VibeLang code that answers a rule on the line after pos, or "".
// A position that is not an @effect-diagnostics-next-line marker in a
// comment, such as one in a string, gets no edit; so does a directive in a
// comment of several lines, or one whose line removal would move a next-line
// directive above it onto another line.
func deadEffectDirectiveEdits(file *ast.SourceFile, positions []int, port func(pos int, rule string) string) []sourceEdit {
	text := file.Text()
	slices.Sort(positions)
	positions = slices.Compact(positions)
	var edits []sourceEdit
	for _, pos := range positions {
		if pos < 0 || pos >= len(text) || !strings.HasPrefix(text[pos:], effectNextLineMarker) || !inTrivia(file, pos) {
			continue
		}
		if edit, ok := deadEffectDirectiveEdit(text, pos, func(rule string) string { return port(pos, rule) }); ok && !overlapsAny(edit, edits) {
			edits = append(edits, edit)
		}
	}
	return edits
}

// inTrivia reports whether pos is in the trivia before a token of file: in a
// comment, since a marker is not whitespace.
func inTrivia(file *ast.SourceFile, pos int) bool {
	token := astnav.GetTokenAtPosition(file, pos)
	return token != nil && token.Pos() <= pos && pos < scanner.SkipTrivia(file.Text(), token.Pos())
}

// deadEffectDirectiveEdit returns the edit for the directive whose marker
// starts at pos in text; port returns the VibeLang code that answers a rule
// on the next line, or "".
func deadEffectDirectiveEdit(text string, pos int, port func(rule string) string) (sourceEdit, bool) {
	lineStart := strings.LastIndexByte(text[:pos], '\n') + 1
	lineEnd := len(text)
	if i := strings.IndexByte(text[pos:], '\n'); i >= 0 {
		lineEnd = pos + i
	}
	if lineEnd > lineStart && text[lineEnd-1] == '\r' {
		lineEnd--
	}
	head := text[lineStart:pos]
	block := false
	opener := strings.LastIndex(head, "//")
	if opener < 0 || strings.TrimSpace(head[opener+2:]) != "" {
		opener = strings.LastIndex(head, "/*")
		if opener < 0 || strings.TrimSpace(strings.TrimLeft(head[opener+2:], "*")) != "" {
			return sourceEdit{}, false
		}
		block = true
	}
	commentStart := lineStart + opener
	rulesStart := pos + len(effectNextLineMarker)
	commentEnd := lineEnd
	if block {
		closing := strings.Index(text[rulesStart:lineEnd], "*/")
		if closing < 0 {
			return sourceEdit{}, false
		}
		commentEnd = rulesStart + closing + 2
	}
	bodyEnd := commentEnd
	if block {
		bodyEnd -= 2
	}
	rest := text[rulesStart:bodyEnd]
	var kept []string
	rules := 0
	for {
		m := effectDirectiveRule.FindStringSubmatch(rest)
		if m == nil {
			break
		}
		rest = rest[len(m[0]):]
		rules++
		// VibeLang's categories are error, warning and off (D241).
		if code := port(m[1]); code != "" && (m[2] == "off" || m[2] == "warning" || m[2] == "error") {
			kept = append(kept, code+":"+m[2])
		}
	}
	if rules == 0 {
		return sourceEdit{}, false
	}
	if len(kept) > 0 {
		// The directive stays, under VibeLang's marker and codes, with its prose.
		return sourceEdit{start: pos, end: bodyEnd - len(rest), text: directiveMarker + directiveNextLine + " " + strings.Join(kept, " ")}, true
	}
	prose := strings.TrimSpace(rest)
	if m := effectDirectiveSeparator.FindString(prose); m != "" {
		prose = strings.TrimSpace(prose[len(m):])
	}
	if prose != "" {
		if block {
			return sourceEdit{start: commentStart, end: commentEnd, text: "/* " + prose + " */"}, true
		}
		return sourceEdit{start: commentStart, end: lineEnd, text: "// " + prose}, true
	}
	before, after := text[lineStart:commentStart], text[commentEnd:lineEnd]
	switch {
	case strings.TrimSpace(after) != "":
		// Code follows a block comment: the comment and the spaces after it go.
		return sourceEdit{start: commentStart, end: commentEnd + len(after) - len(strings.TrimLeft(after, " \t")), text: ""}, true
	case strings.TrimSpace(before) != "":
		// The comment ends a line of code: it goes with the spaces before it.
		return sourceEdit{start: lineStart + len(strings.TrimRight(before, " \t")), end: lineEnd, text: ""}, true
	}
	if lineStart > 0 {
		previousStart := strings.LastIndexByte(text[:lineStart-1], '\n') + 1
		if namesNextLine.MatchString(text[previousStart : lineStart-1]) {
			return sourceEdit{}, false
		}
	}
	end := len(text)
	if i := strings.IndexByte(text[lineStart:], '\n'); i >= 0 {
		end = lineStart + i + 1
	}
	return sourceEdit{start: lineStart, end: end, text: ""}, true
}
