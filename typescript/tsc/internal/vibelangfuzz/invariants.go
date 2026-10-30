package vibelangfuzz

import (
	"fmt"
	"path"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/locale"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The invariants every compilation keeps, whatever its input. Each one names
// the chapter and decision it enforces; none encodes what the compiler
// happens to do today.

// Gaps collects a target's disagreements with the specification for one
// input, so that one pending gap does not hide the other oracles' verdicts.
// Finish fails on each gap that testdata/pending/ does not list, and skips
// when every gap is pending.
type Gaps struct {
	Target string
	// Input names the input in a report, such as the acceptance case a
	// seed came from.
	Input string
	found []gap
}

type gap struct{ key, text string }

// Add records a disagreement under key: "ek:EK4409" for one rule,
// "feature:<oracle>" for an oracle, or "corpus:<file>" for one input.
func (g *Gaps) Add(key, format string, args ...any) {
	text := fmt.Sprintf(format, args...)
	for _, f := range g.found {
		if f.key == key && f.text == text {
			return
		}
	}
	g.found = append(g.found, gap{key, text})
}

// Any reports whether a gap was recorded.
func (g *Gaps) Any() bool { return len(g.found) != 0 }

// Finish reports the gaps: it fails the test on any gap that is not pending
// and skips it when all are pending. With none it returns.
func (g *Gaps) Finish(t testing.TB) {
	t.Helper()
	var pending []string
	failed := false
	for _, f := range g.found {
		if entry, ok := Pending(g.Target, f.key); ok {
			pending = append(pending, fmt.Sprintf("%s (%s: %s)", f.key, entry.Owner, entry.Reason))
			continue
		}
		failed = true
		t.Errorf("%s %s: %s", g.Target, f.key, f.text)
	}
	if failed {
		if g.Input != "" {
			t.Errorf("input: %s", g.Input)
		}
		t.FailNow()
	}
	if len(pending) != 0 {
		t.Skipf("pending: %s", strings.Join(pending, "; "))
	}
}

// seedNames maps each seed input to the case or snippet it came from.
var seedNames sync.Map // string -> string

// SeedName returns the name of the case or snippet a seed input came from,
// or "".
func SeedName(input string) string {
	if name, ok := seedNames.Load(input); ok {
		return name.(string)
	}
	return ""
}

// FinishInput finishes an input as Finish does, and fails a pending corpus
// input that meets every oracle as XPASS. A corpus line marks its input for
// XPASS; it never excuses a disagreement by itself. Each gap the input meets
// must be pending under its own key, so a new failure in a pending input
// still fails.
func (g *Gaps) FinishInput(t testing.TB, key string) {
	t.Helper()
	if key != "" && !g.Any() {
		ExpectPending(t, g.Target, key)
	}
	g.Finish(t)
}

// IsEK reports whether d is one of VibeLang's diagnostics, whose source is
// EK (Chapter 28, D61).
func IsEK(d *ast.Diagnostic) bool { return d.Source() == "EK" }

// HasError reports whether any diagnostic is an error.
func HasError(ds []*ast.Diagnostic) bool {
	return slices.ContainsFunc(ds, func(d *ast.Diagnostic) bool { return d.Category() == diagnostics.CategoryError })
}

// DiagnosticKey is what two compilations of one project must agree on for a
// diagnostic: its code, category, file, span and text, with the project's
// directory written as $DIR.
type DiagnosticKey struct {
	Source   string
	Code     int32
	Category diagnostics.Category
	File     string
	Pos, Len int
	Text     string
}

func (k DiagnosticKey) String() string {
	return fmt.Sprintf("%s(%d+%d): %s %s%d: %s", k.File, k.Pos, k.Len, k.Category.Name(), cmp(k.Source, "TS"), k.Code, k.Text)
}

func cmp(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// Keys returns the keys of a compilation's diagnostics, in its order.
func Keys(dir string, ds []*ast.Diagnostic) []DiagnosticKey {
	keys := make([]DiagnosticKey, 0, len(ds))
	for _, d := range ds {
		keys = append(keys, keyOf(dir, d))
	}
	return keys
}

func keyOf(dir string, d *ast.Diagnostic) DiagnosticKey {
	var b strings.Builder
	flatten(&b, d, 0)
	k := DiagnosticKey{Source: d.Source(), Code: d.Code(), Category: d.Category(), Pos: d.Pos(), Len: d.Len(), Text: strings.ReplaceAll(b.String(), dir, "$DIR")}
	if d.File() != nil {
		k.File = strings.TrimPrefix(string(d.File().FileName()), dir+"/")
	}
	return k
}

func flatten(b *strings.Builder, d *ast.Diagnostic, depth int) {
	b.WriteString(strings.Repeat("  ", depth))
	b.WriteString(d.Localize(locale.Default))
	for _, chained := range d.MessageChain() {
		b.WriteString("\n")
		flatten(b, chained, depth+1)
	}
	for _, related := range d.RelatedInformation() {
		b.WriteString("\n" + strings.Repeat("  ", depth) + "related ")
		if related.File() != nil {
			fmt.Fprintf(b, "%s(%d+%d) ", path.Base(string(related.File().FileName())), related.Pos(), related.Len())
		}
		flatten(b, related, depth+1)
	}
}

// SortedKeys returns keys sorted, for a comparison as multisets.
func SortedKeys(keys []DiagnosticKey) []DiagnosticKey {
	sorted := slices.Clone(keys)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].String() < sorted[j].String() })
	return sorted
}

// DiffKeys describes how two diagnostic lists differ, or returns "".
func DiffKeys(a, b []DiagnosticKey) string {
	if slices.Equal(a, b) {
		return ""
	}
	var lines []string
	for i := 0; i < max(len(a), len(b)) && len(lines) < 6; i++ {
		var x, y string
		if i < len(a) {
			x = a[i].String()
		}
		if i < len(b) {
			y = b[i].String()
		}
		if x != y {
			lines = append(lines, fmt.Sprintf("#%d\n  first:  %s\n  second: %s", i, x, y))
		}
	}
	return strings.Join(lines, "\n")
}

// DiffOutputs describes how two compilations' outputs differ, or returns "".
func DiffOutputs(dirA string, a map[string]string, dirB string, b map[string]string) string {
	var lines []string
	for _, name := range unionKeys(a, b) {
		x, inA := a[name]
		y, inB := b[name]
		x, y = strings.ReplaceAll(x, dirA, "$DIR"), strings.ReplaceAll(y, dirB, "$DIR")
		switch {
		case !inA:
			lines = append(lines, "only the second wrote "+name)
		case !inB:
			lines = append(lines, "only the first wrote "+name)
		case x != y:
			lines = append(lines, fmt.Sprintf("%s differs:\n%s", name, firstDifference(x, y)))
		}
	}
	return strings.Join(lines, "\n")
}

func unionKeys(a, b map[string]string) []string {
	var names []string
	for name := range a {
		names = append(names, name)
	}
	for name := range b {
		if _, ok := a[name]; !ok {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	return names
}

func firstDifference(x, y string) string {
	i := 0
	for i < len(x) && i < len(y) && x[i] == y[i] {
		i++
	}
	from := max(0, i-80)
	return fmt.Sprintf("  first:  …%q\n  second: …%q", x[from:min(len(x), i+80)], y[from:min(len(y), i+80)])
}

// CheckDiagnostics applies the invariants every diagnostic of a compilation
// keeps, whatever the project's settings. A Chapter 28 registry fact is
// checked only where Facts derives one.
func CheckDiagnostics(g *Gaps, dir string, ds []*ast.Diagnostic, defaultsApply bool) {
	facts := Facts()
	for _, d := range ds {
		checkSpan(g, dir, d)
		if !IsEK(d) {
			continue
		}
		code := d.Code()
		name := fmt.Sprintf("EK%d", code)
		// VIP-30 / 007-tooling.md puts configuration diagnostics in the config
		// JSON, not in a .vibe source. Keep the ordinary-source D266 invariant
		// below; only the configuration codes have this separate scope/category.
		if want, ok := configurationDiagnosticDefault(d); ok {
			if (defaultsApply || want != DefaultWarning) && !CategoryMatches(want, d.Category()) {
				g.Add("config:category:"+name, "%s has the wrong configuration category: %s", name, keyOf(dir, d))
			}
			continue
		}
		// Chapter 28: the registry table and the rules listed below it are
		// every EK code; "The table lists the codes the compiler's registry
		// holds" (D33, D53, D374).
		if !facts.IsRegistered(code) {
			g.Add("ek:"+name, "%s is not in Chapter 28's registry: %s", name, keyOf(dir, d))
			continue
		}
		// Chapter 28: "Retired codes keep their numbers unused" (D309, D323,
		// D325).
		if slices.Contains(facts.Retired, code) {
			g.Add("ek:"+name, "%s is retired and its number unused (Chapter 28), but was reported: %s", name, keyOf(dir, d))
			continue
		}
		// D266: "every EK diagnostic is restricted to .vibe files, and
		// ordinary TypeScript sources keep TypeScript diagnostics whatever
		// these settings say" (Chapter 28).
		if d.File() == nil || !strings.HasSuffix(string(d.File().OriginalFileName()), ".vibe") {
			g.Add("feature:d266", "D266: %s attaches to a file that is not a .vibe file: %s", name, keyOf(dir, d))
			continue
		}
		// Chapter 28: EK9101 is an "editor-only suggestion; not emitted by
		// the CLI"; every other code has the default category the chapter
		// gives it when no setting or comment changes it (D34, D241, D420).
		want := facts.Default(code)
		if want == DefaultNever {
			g.Add("ek:"+name, "%s is never emitted by the CLI (Chapter 28), but was reported: %s", name, keyOf(dir, d))
			continue
		}
		if !defaultsApply && facts.IsAdjustable(code) {
			continue
		}
		if !CategoryMatches(want, d.Category()) {
			g.Add("ek:"+name, "%s is %s by default (Chapter 28), but was reported as %s: %s", name, want, d.Category().Name(), keyOf(dir, d))
		}
	}
}

// CategoryMatches reports whether a reported category is the default.
func CategoryMatches(want DefaultCategory, got diagnostics.Category) bool {
	switch want {
	case DefaultError:
		return got == diagnostics.CategoryError
	case DefaultWarning:
		return got == diagnostics.CategoryWarning
	case DefaultErrorOrWarning:
		return got == diagnostics.CategoryError || got == diagnostics.CategoryWarning
	case DefaultOff, DefaultNever:
		return false
	}
	return true
}

// checkSpan checks that a diagnostic's span, and its related spans, lie in
// its file's text: diagnostics print at .vibe spans (Chapter 28, D61), and an
// editor places each one in the document.
func checkSpan(g *Gaps, dir string, d *ast.Diagnostic) {
	spans := append([]*ast.Diagnostic{d}, d.RelatedInformation()...)
	for _, s := range spans {
		if s.File() == nil {
			continue
		}
		if size := len(s.File().Text()); s.Pos() < 0 || s.End() < s.Pos() || s.End() > size {
			g.Add("feature:diagnostic-span", "Chapter 28 (D61): a diagnostic's span [%d, %d) leaves %s's %d bytes: %s", s.Pos(), s.End(), path.Base(string(s.File().FileName())), size, keyOf(dir, d))
		}
	}
}

// DefaultsApply reports whether a project's EK diagnostics must have their
// default categories: no configuration file sets the `vibelang` setting
// `diagnostics`, and no source has an @vibelang-diagnostics comment
// (Chapter 28, D241, D275).
func DefaultsApply(project Project) bool {
	if strings.Contains(project.Config, `"diagnostics"`) || strings.Contains(project.Config, `"severities"`) {
		return false
	}
	for name, text := range project.Files {
		if strings.HasSuffix(name, ".json") && (strings.Contains(text, `"diagnostics"`) || strings.Contains(text, `"severities"`)) {
			return false
		}
		if strings.Contains(text, "@vibelang-diagnostics") {
			return false
		}
	}
	return true
}

// UTF16Lines returns the UTF-16 length of each line of text, splitting at
// ECMAScript's line terminators (LF, CR, CRLF, U+2028 and U+2029), as source
// map positions count them.
func UTF16Lines(text string) []int {
	lines := []int{0}
	runes := []rune(text)
	for i := 0; i < len(runes); i++ {
		switch r := runes[i]; r {
		case '\r':
			if i+1 < len(runes) && runes[i+1] == '\n' {
				i++
			}
			lines = append(lines, 0)
		case '\n', ' ', ' ':
			lines = append(lines, 0)
		default:
			lines[len(lines)-1] += len(utf16.Encode([]rune{r}))
		}
	}
	return lines
}

// UTF16Len returns text's length in UTF-16 code units.
func UTF16Len(text string) int {
	n := 0
	for _, r := range text {
		n += len(utf16.Encode([]rune{r}))
	}
	return n
}

// DecodedUTF16Len returns the length in UTF-16 code units of the string
// Node reads from text's bytes. Node decodes a file as the Encoding Standard's
// UTF-8 decoder does (section 8.1.1, https://encoding.spec.whatwg.org/#utf-8-decoder),
// which replaces each maximal subpart of an invalid sequence with one U+FFFD:
// "\xe4\x91" is one unit, where UTF16Len counts one per invalid byte.
func DecodedUTF16Len(text string) int {
	n := 0
	for i := 0; i < len(text); {
		if r, size := utf8.DecodeRuneInString(text[i:]); r != utf8.RuneError || size > 1 {
			n += len(utf16.Encode([]rune{r}))
			i += size
			continue
		}
		// The bytes a valid sequence with this lead byte may continue with.
		need, low, high := 0, byte(0x80), byte(0xbf)
		switch lead := text[i]; {
		case lead >= 0xc2 && lead <= 0xdf:
			need = 1
		case lead == 0xe0:
			need, low = 2, 0xa0
		case lead == 0xed:
			need, high = 2, 0x9f
		case lead >= 0xe1 && lead <= 0xef:
			need = 2
		case lead == 0xf0:
			need, low = 3, 0x90
		case lead == 0xf4:
			need, high = 3, 0x8f
		case lead >= 0xf1 && lead <= 0xf3:
			need = 3
		}
		i++
		for ; need > 0 && i < len(text) && text[i] >= low && text[i] <= high; need-- {
			i++
			low, high = 0x80, 0xbf
		}
		n++
	}
	return n
}

// LineAndColumn returns a diagnostic's 1-based line and column as tsc
// prints them.
func LineAndColumn(d *ast.Diagnostic) (int, int) {
	line, character := scanner.GetECMALineAndUTF16CharacterOfPosition(d.File(), d.Pos())
	return line + 1, int(character) + 1
}

// Chapter 7's configuration diagnostics are VibeLang additions to JSON.
// D266 still compares the fork with stock TypeScript on ordinary TypeScript;
// only Appendix B rows linking Chapter 7 receive this config-file exemption.
func configurationDiagnosticDefault(d *ast.Diagnostic) (DefaultCategory, bool) {
	if d.File() != nil && d.File().ScriptKind != core.ScriptKindJSON {
		return DefaultUnknown, false
	}
	row, ok := configurationDiagnosticRows()[fmt.Sprintf("%04d", d.Code())]
	if !ok {
		return DefaultUnknown, false
	}
	if strings.HasPrefix(row.Rule, "warning:") || strings.HasPrefix(row.Rule, "lint warning:") {
		return DefaultWarning, true
	}
	return DefaultError, true
}
