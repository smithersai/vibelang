package vibelangfuzz

import (
	"flag"
	"fmt"
	"os"
	"path"
	"regexp"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// The tools area's targets (FuzzFormat, FuzzFix, FuzzEditor and
// FuzzIncremental) check the tooling of Chapter 28: the formatter, --fix and
// quick fixes, and the language server. This file holds the text helpers they
// share: seeds, parsing, comments, and LSP positions and edits. Every name in
// it starts with "tools" so that it cannot collide with another area's
// helpers in this package.

// toolsFuzzing reports whether this process runs a fuzz campaign rather than
// the seed run. A campaign adds every seed; the seed run samples them, so
// that `go test ./internal/vibelangfuzz/` stays short.
// VIBELANG_FUZZ_SEEDS=all adds every seed to the seed run too.
func toolsFuzzing() bool {
	if os.Getenv("VIBELANG_FUZZ_SEEDS") == "all" {
		return true
	}
	f := flag.Lookup("test.fuzz")
	return f != nil && f.Value.String() != ""
}

// toolsSample returns the seeds that must run plus an evenly spaced sample
// of the rest: at most n in all for the seed run, and at most campaign during
// a campaign, where 0 means every seed. A slow target bounds its campaign's
// seeds so that gathering their baseline coverage leaves time to fuzz.
// VIBELANG_FUZZ_SEEDS=all bypasses both limits.
func toolsSample(seeds []Seed, n, campaign int, must func(Seed) bool) []Seed {
	if os.Getenv("VIBELANG_FUZZ_SEEDS") == "all" {
		return seeds
	}
	if toolsFuzzing() {
		if campaign == 0 {
			return seeds
		}
		n = campaign
	}
	var kept, rest []Seed
	for _, seed := range seeds {
		if must != nil && must(seed) {
			kept = append(kept, seed)
		} else {
			rest = append(rest, seed)
		}
	}
	if room := n - len(kept); room > 0 && len(rest) > 0 {
		stride := max(1, len(rest)/room)
		for i := 0; i < len(rest) && room > 0; i += stride {
			kept = append(kept, rest[i])
			room--
		}
	}
	return kept
}

// toolsSourceFiles returns a project's .vibe files in name order.
func toolsVibeFiles(files map[string]string) []string {
	var names []string
	for name := range files {
		if strings.HasSuffix(name, ".vibe") {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	return names
}

// toolsMainFile returns the .vibe file a target edits: main.vibe, or else the
// first .vibe file by name. It returns "" for a project without one.
func toolsMainFile(files map[string]string) string {
	if _, ok := files["main.vibe"]; ok {
		return "main.vibe"
	}
	if names := toolsVibeFiles(files); len(names) > 0 {
		return names[0]
	}
	return ""
}

// toolsTooLarge bounds a fuzz input, so that a campaign spends its time on
// many small programs rather than a few huge ones.
func toolsTooLarge(files map[string]string) bool {
	total := 0
	for _, text := range files {
		total += len(text)
	}
	return total > 24<<10 || len(files) > 12
}

// toolsFeatures recognize the inputs that use a generator feature, for
// the features testdata/pending lists as "feature:<name>". A campaign leaves
// such inputs out (pending.go), since a known hang ends the process and would
// stop every campaign at the same bug.
var toolsFeatures = map[string]*regexp.Regexp{
	// The superseded `layer` declaration (D276 leaves it as written).
	"layer-declaration": regexp.MustCompile(`(^|[^\w$.])layer\s+[\w$]`),
}

// toolsFeature returns a feature's pattern. compiler-gap-vipNN recognizes a
// specification example marked `// compiler-gap: pending VIP-NN` (with any
// other VIPs), the gap the snippet checker reports as known rather than as a
// failure (000-intro.md), so a tools oracle skips it as the checker does.
func toolsFeature(name string) (*regexp.Regexp, bool) {
	if vip, ok := strings.CutPrefix(name, "compiler-gap-vip"); ok {
		if _, err := strconv.Atoi(vip); err == nil {
			return regexp.MustCompile(`//\s*compiler-gap:\s*pending\b[^\n]*\bVIP-` + vip + `\b`), true
		}
	}
	pattern, ok := toolsFeatures[name]
	return pattern, ok
}

// toolsLeftOut reports whether a project uses a feature that testdata/pending
// lists for the target, unless VIBELANG_FUZZ_PENDING=1 or a hang probe is running.
func toolsLeftOut(target string, files map[string]string) bool {
	if os.Getenv("VIBELANG_FUZZ_HANG_PROBE") == "1" {
		return false
	}
	for name := range PendingFeatures(target) {
		pattern, ok := toolsFeature(name)
		if !ok {
			panic("testdata/pending names an unknown feature " + name + " for " + target)
		}
		for _, text := range files {
			if pattern.MatchString(text) {
				return true
			}
		}
	}
	return false
}

// toolsUnarchive decodes a fuzz input's project. A tsconfig.json that names
// a parent or an absolute path is dropped for the default configuration: a
// mutated "include" or "extends" must not reach the host's other files.
func toolsUnarchive(archive string) map[string]string {
	files := Unarchive(archive)
	for name, text := range files {
		if strings.HasSuffix(name, "tsconfig.json") && (strings.Contains(text, "..") || strings.Contains(text, "\"/") || strings.Contains(text, "\\")) {
			delete(files, name)
		}
	}
	return files
}

// toolsParse parses text as the file name's language: a name ending in .vibe
// parses as VibeLang, any other as TypeScript.
func toolsParse(name, text string) *ast.SourceFile {
	fileName := tspath.RootedFilePath("/vibelang-fuzz/" + name)
	return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: fileName, PathKey: tspath.PathKey(fileName)}, text, core.GetScriptKindFromFileName(fileName))
}

// toolsSyntaxError returns the first syntax error of text as the file name's
// language, or "".
func toolsSyntaxError(name, text string) string {
	if diagnostics := toolsParse(name, text).Diagnostics(); len(diagnostics) > 0 {
		return fmt.Sprintf("%d: %s", diagnostics[0].Pos(), diagnostics[0].String())
	}
	return ""
}

// A toolsToken is one scanner token, with trivia omitted except for comments.
// D372 permits layout changes, so positions are kept only for editor probes.
type toolsToken struct {
	kind       ast.Kind
	text       string
	start, end int
}

func toolsScan(text string) []toolsToken {
	s := scanner.NewScanner()
	s.SetSkipTrivia(false)
	s.SetText(text)
	var tokens []toolsToken
	var templates []int
	depth := 0
	previous := ast.KindUnknown
	for steps := 0; steps < len(text)+2; steps++ {
		token := s.Scan()
		switch token {
		case ast.KindEndOfFile:
			return tokens
		case ast.KindWhitespaceTrivia, ast.KindNewLineTrivia, ast.KindConflictMarkerTrivia:
			continue
		case ast.KindSingleLineCommentTrivia, ast.KindMultiLineCommentTrivia:
			tokens = append(tokens, toolsToken{token, toolsCommentText(s.TokenText()), s.TokenStart(), s.TokenEnd()})
			continue
		case ast.KindTemplateHead:
			templates = append(templates, depth)
		case ast.KindOpenBraceToken:
			depth++
		case ast.KindCloseBraceToken:
			if len(templates) > 0 && templates[len(templates)-1] == depth {
				if s.ReScanTemplateToken(false) == ast.KindTemplateTail {
					templates = templates[:len(templates)-1]
				}
				token = s.Token()
			} else {
				depth--
			}
		case ast.KindSlashToken, ast.KindSlashEqualsToken:
			if !toolsEndsExpression(previous) {
				token = s.ReScanSlashToken()
			}
		}
		tokens = append(tokens, toolsToken{token, s.TokenText(), s.TokenStart(), s.TokenEnd()})
		previous = token
	}
	panic("tools scanner did not reach EOF")
}

func toolsIsComment(token toolsToken) bool {
	return token.kind == ast.KindSingleLineCommentTrivia || token.kind == ast.KindMultiLineCommentTrivia
}

func toolsCommentText(text string) string {
	lines := strings.Split(text, "\n")
	for i := range lines {
		lines[i] = strings.TrimSpace(lines[i])
	}
	return strings.Join(lines, "\n")
}

// toolsComments ignores indentation inside comments, which D372 permits.
func toolsComments(text string) []string {
	var comments []string
	for _, token := range toolsScan(text) {
		if toolsIsComment(token) {
			comments = append(comments, token.text)
		}
	}
	return comments
}

// toolsJSTokens uses the TypeScript scanner independently of SameProgram.
// Chapter 28, Formatting (D276, D372), changes layout, not emitted JS tokens.
func toolsJSTokens(text string) []string {
	var tokens []string
	for _, token := range toolsScan(text) {
		if !toolsIsComment(token) {
			tokens = append(tokens, fmt.Sprintf("%d:%s", token.kind, token.text))
		}
	}
	return tokens
}

// toolsCommentNeighbors keeps both non-trivia neighbors of every comment.
// Chapter 28, Rewrites keep meaning (D372), keeps comments next to their code;
// a multiset of comment texts alone cannot detect relocation.
func toolsCommentNeighbors(text string) []string {
	tokens := toolsScan(text)
	// Distinguish repeated occurrences, so moving a comment between two
	// identical statements does not retain a misleading text-only anchor.
	identities := make([]string, len(tokens))
	counts := map[string]int{}
	for i, token := range tokens {
		if !toolsIsComment(token) {
			key := fmt.Sprintf("%d:%s", token.kind, token.text)
			counts[key]++
			identities[i] = fmt.Sprintf("%s#%d", key, counts[key])
		}
	}
	var comments []string
	before := "<start>"
	for i, token := range tokens {
		if !toolsIsComment(token) {
			before = identities[i]
			continue
		}
		after := "<end>"
		for j := i + 1; j < len(tokens); j++ {
			if !toolsIsComment(tokens[j]) {
				after = identities[j]
				break
			}
		}
		comments = append(comments, fmt.Sprintf("%q between %q and %q", token.text, before, after))
	}
	return comments
}

func toolsMovedComments(before, after string) []string {
	have := map[string]int{}
	for _, comment := range toolsCommentNeighbors(after) {
		have[comment]++
	}
	var moved []string
	for _, comment := range toolsCommentNeighbors(before) {
		if have[comment] > 0 {
			have[comment]--
		} else {
			moved = append(moved, comment)
		}
	}
	return moved
}

// toolsEndsExpression reports whether a token can end an expression, so that
// a slash after it divides rather than starts a regular expression.
func toolsEndsExpression(kind ast.Kind) bool {
	switch kind {
	case ast.KindIdentifier, ast.KindPrivateIdentifier, ast.KindNumericLiteral, ast.KindBigIntLiteral, ast.KindStringLiteral,
		ast.KindNoSubstitutionTemplateLiteral, ast.KindTemplateTail, ast.KindRegularExpressionLiteral,
		ast.KindCloseParenToken, ast.KindCloseBracketToken, ast.KindCloseBraceToken,
		ast.KindThisKeyword, ast.KindSuperKeyword, ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword,
		ast.KindPlusPlusToken, ast.KindMinusMinusToken, ast.KindExclamationToken:
		return true
	}
	return false
}

// toolsLostComments returns the comments of before that after lacks, as a
// multiset.
func toolsLostComments(before, after string) []string {
	have := map[string]int{}
	for _, c := range toolsComments(after) {
		have[c]++
	}
	var lost []string
	for _, c := range toolsComments(before) {
		if have[c] > 0 {
			have[c]--
		} else {
			lost = append(lost, c)
		}
	}
	return lost
}

// toolsLines is a document's line starts as LSP 3.17 counts them: "\n",
// "\r\n" and "\r" end a line, and a character is a UTF-16 code unit.
type toolsLines struct {
	text   string
	starts []int
}

func newToolsLines(text string) *toolsLines {
	lines := &toolsLines{text: text, starts: []int{0}}
	for i := 0; i < len(text); i++ {
		switch text[i] {
		case '\r':
			if i+1 < len(text) && text[i+1] == '\n' {
				i++
			}
			lines.starts = append(lines.starts, i+1)
		case '\n':
			lines.starts = append(lines.starts, i+1)
		}
	}
	return lines
}

// lineEnd returns the byte offset of the end of line's content, before its
// line break.
func (l *toolsLines) lineEnd(line int) int {
	if line+1 < len(l.starts) {
		end := l.starts[line+1] - 1
		if end > l.starts[line] && l.text[end] == '\n' && l.text[end-1] == '\r' {
			end--
		}
		return end
	}
	return len(l.text)
}

// offset returns the byte offset of an LSP position, or -1 when the position
// is not inside the document: past its last line, past the end of its line,
// or between the two code units of a surrogate pair.
func (l *toolsLines) offset(p lsproto.Position) int {
	line := int(p.Line)
	if line >= len(l.starts) {
		return -1
	}
	pos, end := l.starts[line], l.lineEnd(line)
	for units := int(p.Character); units > 0; {
		if pos >= end {
			return -1
		}
		r, size := utf8.DecodeRuneInString(l.text[pos:])
		n := 1
		if r >= 0x10000 {
			n = 2
		}
		if n > units {
			return -1
		}
		units -= n
		pos += size
	}
	return pos
}

// position returns the LSP position of a byte offset, which must be at the
// start of a character.
func (l *toolsLines) position(offset int) lsproto.Position {
	line, _ := slices.BinarySearch(l.starts, offset+1)
	line--
	units := 0
	for pos := l.starts[line]; pos < offset; {
		r, size := utf8.DecodeRuneInString(l.text[pos:])
		if r >= 0x10000 {
			units += 2
		} else {
			units++
		}
		pos += size
	}
	return lsproto.Position{Line: uint32(line), Character: uint32(units)}
}

// span returns the byte offsets of an LSP range, and false when it is not
// inside the document or ends before it starts.
func (l *toolsLines) span(r lsproto.Range) (int, int, bool) {
	start, end := l.offset(r.Start), l.offset(r.End)
	return start, end, start >= 0 && end >= start
}

// toolsRuneStart moves an offset back to the start of the character it is in.
func toolsRuneStart(text string, offset int) int {
	offset = min(max(offset, 0), len(text))
	for offset > 0 && offset < len(text) && !utf8.RuneStart(text[offset]) {
		offset--
	}
	return offset
}

// A toolsEdit is a replacement of the bytes [start, end) of a text.
type toolsEdit struct {
	start, end int
	text       string
}

// toolsApply applies LSP text edits to text. LSP 3.17 requires that the
// edits of one document do not overlap and lie inside it; toolsApply returns
// an error when they do not.
func toolsApply(text string, edits []*lsproto.TextEdit) (string, []toolsEdit, error) {
	lines := newToolsLines(text)
	var spans []toolsEdit
	for _, edit := range edits {
		start, end, ok := lines.span(edit.Range)
		if !ok {
			return "", nil, fmt.Errorf("edit %v is not inside the document", edit.Range)
		}
		spans = append(spans, toolsEdit{start, end, edit.NewText})
	}
	slices.SortStableFunc(spans, func(a, b toolsEdit) int { return a.start - b.start })
	for i := 1; i < len(spans); i++ {
		if spans[i].start < spans[i-1].end {
			return "", nil, fmt.Errorf("edits overlap at bytes %d-%d and %d-%d", spans[i-1].start, spans[i-1].end, spans[i].start, spans[i].end)
		}
	}
	var b strings.Builder
	last := 0
	for _, s := range spans {
		b.WriteString(text[last:s.start])
		b.WriteString(s.text)
		last = s.end
	}
	b.WriteString(text[last:])
	return b.String(), spans, nil
}

// toolsMap maps a byte offset of a text through edits applied to it. An
// offset inside a replaced range maps to the start of its replacement when
// left is true, and to its end otherwise.
func toolsMap(offset int, edits []toolsEdit, left bool) int {
	shift := 0
	for _, e := range edits {
		switch {
		case e.end < offset || e.end == offset && e.start < offset:
			shift += len(e.text) - (e.end - e.start)
		case e.start <= offset && offset <= e.end:
			if left {
				return e.start + shift
			}
			return e.start + shift + len(e.text)
		}
	}
	return offset + shift
}

// toolsGuard runs one fuzz input. A corpus file that testdata/pending lists
// with a reason that names a hang does not run, since Within ends the
// process, unless VIBELANG_FUZZ_HANG_PROBE=1; any other listed corpus file that now passes every oracle fails
// as XPASS.
func toolsGuard(t *testing.T, target string, body func()) {
	t.Helper()
	key := "corpus:" + path.Base(t.Name())
	if entry, pending := Pending(target, key); pending && strings.HasPrefix(entry.Reason, "hang") && os.Getenv("VIBELANG_FUZZ_HANG_PROBE") != "1" {
		t.Skipf("pending hang (%s): %s", entry.Owner, entry.Reason)
	}
	body()
	ExpectPending(t, target, key)
}

// toolsRun runs one stage of a fuzz input within the hang limit. A panic in
// the compiler is always a bug (the fuzz brief's rule 3). It becomes a Gap
// keyed "crash:<the compiler function that panicked>", so that
// testdata/pending can list a known crash, the seed run stays green, and a
// campaign goes on to find new ones. input describes the fuzz input for
// the report; onPanic, when not nil, runs first.
func toolsRun(t *testing.T, target, stage, input string, onPanic func(), fn func()) {
	t.Helper()
	var recovered any
	var stack []byte
	func() {
		defer func() {
			if r := recover(); r != nil {
				recovered, stack = r, debug.Stack()
			}
		}()
		Within(stage, fn)
	}()
	if recovered == nil {
		return
	}
	if onPanic != nil {
		onPanic()
	}
	key := "crash:" + toolsPanicFrame(stack) // one root cause, whichever request reaches it
	Gap(t, target, key, "%s panics: %v\ninput:\n%s\n%s", stage, recovered, input, stack)
}

// toolsPanicFrame returns the compiler function a panic started in, such as
// "ls.getContainingArgumentInfo": the first frame below the panic outside
// the runtime and internal/debug's assertions.
func toolsPanicFrame(stack []byte) string {
	lines := strings.Split(string(stack), "\n")
	start := 0
	for i, line := range lines {
		if strings.HasPrefix(line, "panic(") {
			start = i + 1
		}
	}
	for _, line := range lines[start:] {
		if line == "" || strings.HasPrefix(line, "\t") || strings.HasPrefix(line, "runtime.") || strings.Contains(line, "/internal/debug.") {
			continue
		}
		name := line
		if i := strings.LastIndex(name, "("); i > 0 {
			name = name[:i]
		}
		name = strings.TrimPrefix(name, "github.com/microsoft/TypeScript/tsc/internal/")
		name = strings.NewReplacer("(*", "", ")", "", " ", "").Replace(name)
		return name
	}
	return "unknown"
}
