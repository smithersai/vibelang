package vibelangfuzz

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

// Keep token validation at the citation gate: no compiler or runtime is
// needed to reject a vacuous template or a reference that lost its operation.
func vipTemplateProblem(template, reference string) string {
	want := vipTokens(template)
	if len(want) < 3 {
		return fmt.Sprintf("template %q needs at least three concrete tokens", template)
	}
	if !vipInOrder(want, vipTokens(reference)) {
		return fmt.Sprintf("the reference print does not hold %q:\n%s", template, reference)
	}
	return ""
}

var (
	// A chapter prefix owns all following quotations up to the next prefix.
	// Accept the older optional section heading too, so it cannot hide a
	// stale quotation. Quoted text uses Go escapes, as fmt's %q emits.
	vipReadingChapter = regexp.MustCompile(`((?:\.\./vips/)?[0-9]{3,4}-[a-z0-9-]+\.md)(?:, "[^"]*")?:\s*`)
	vipReadingQuote   = regexp.MustCompile(`"(?:\\.|[^"\\])*"`)
)

func readVIPChapter(name string) (string, error) {
	data, err := os.ReadFile(SpecPath(name))
	return string(data), err
}

func vipReadingProblems(reading string, read func(string) (string, error)) []string {
	var problems []string
	prefixes := vipReadingChapter.FindAllStringSubmatchIndex(reading, -1)
	for i, m := range prefixes {
		end := len(reading)
		if i+1 < len(prefixes) {
			end = prefixes[i+1][0]
		}
		var quotes []string
		rest := reading[m[1]:end]
		for {
			start := strings.IndexByte(rest, '"')
			if start < 0 {
				break
			}
			rest = rest[start:]
			span := vipReadingQuote.FindStringIndex(rest)
			if span == nil || span[0] != 0 {
				problems = append(problems, "reading has an unterminated quotation")
				break
			}
			quotes = append(quotes, rest[:span[1]])
			rest = rest[span[1]:]
		}
		if len(quotes) == 0 {
			continue
		}
		name := reading[m[2]:m[3]]
		text, err := read(name)
		if err != nil {
			problems = append(problems, fmt.Sprintf("reading chapter %s: %v", name, err))
			continue
		}
		for _, literal := range quotes {
			quote, err := strconv.Unquote(literal)
			if err != nil {
				problems = append(problems, fmt.Sprintf("reading %s has invalid quotation %s: %v", name, literal, err))
				continue
			}
			if quote == "" || !strings.Contains(text, quote) {
				problems = append(problems, fmt.Sprintf("reading chapter %s no longer says %q", name, quote))
			}
		}
	}
	return problems
}

// The Quoted name admits readings to the spec-quote gate as well as the
// full citation check.
func TestVIPReadingsQuoted(t *testing.T) {
	for _, c := range vipgen.Constructs() {
		for _, cite := range c.Citations {
			for _, problem := range vipReadingProblems(cite.Reading, readVIPChapter) {
				t.Errorf("%s: %s", c.Key, problem)
			}
		}
	}
}

func TestVIPCitationValidation(t *testing.T) {
	for _, tt := range []struct {
		name, template, reference string
		valid                     bool
	}{
		{"one-token", "return", "function witness(){return 0}", false},
		{"two-tokens", "const errors", "const errors = []", false},
		{"placeholder-only", "‹body›", "return 0", false},
		{"placeholders-do-not-pad", "return ‹value›", "return 0", false},
		{"unrelated-reference", "const xs=[...items(log)]", "function witness(){return 0}", false},
		{"lost-operation", "const xs=[...items(log)]", "const xs = []", false},
		{"iterable", "const xs=[...items(log)]", "function witness(){const xs = [...items(log)];return xs}", true},
		{"placeholder", "s instanceof ‹class› && ‹rest›", "s instanceof C && flag", true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := vipTemplateProblem(tt.template, tt.reference) == ""; got != tt.valid {
				t.Fatalf("valid=%v, want %v", got, tt.valid)
			}
		})
	}
	chapters := map[string]string{
		"001-functions.md": "Parameters bind at the call. The body runs again.",
		"002-running.md":   "Statements retain their completion. Transport is the implementation's choice.",
		"004-match.md":     "A key can be \"value\".\nA second line.",
	}
	read := func(name string) (string, error) {
		s, ok := chapters[name]
		if !ok {
			return "", fmt.Errorf("missing chapter")
		}
		return s, nil
	}
	for _, tt := range []struct {
		name, reading string
		problems      int
	}{
		{"current", `001-functions.md: "Parameters bind at the call."`, 0},
		{"stale", `001-functions.md: "Parameters bind inside the generator."`, 1},
		{"later-quote", `002-running.md: "Statements retain their completion."; "Records are required."`, 1},
		{"two-chapters", `001-functions.md: "Parameters bind at the call."; 002-running.md: "Records are required."`, 1},
		{"section-heading", `002-running.md, "Leaving a block": "Records are required."`, 1},
		{"escapes", `004-match.md: "A key can be \"value\".\nA second line."`, 0},
		{"missing", `999-missing.md: "A rule."`, 1},
		{"empty", `001-functions.md: ""`, 1},
		{"unterminated", `001-functions.md: "Parameters bind at the call.`, 1},
		{"prose", "001-functions.md: call-time bindings use native TypeScript.", 0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := vipReadingProblems(tt.reading, read); len(got) != tt.problems {
				t.Fatalf("problems=%v, want %d", got, tt.problems)
			}
		})
	}
}

func TestVIPWitnessCitationKnockouts(t *testing.T) {
	for _, w := range vipgen.ChapterWitnesses() {
		c := vipgen.Lookup(w.Key)
		if c == nil {
			t.Fatalf("missing construct %s", w.Key)
		}
		for _, cite := range c.Citations {
			if cite.Reading == "" {
				t.Errorf("%s hides its chapter reading", w.Key)
			}
			if vipInOrder(vipTokens(cite.Template), vipTokens("function witness(){return 0}")) {
				t.Errorf("%s accepts an unrelated reference", w.Key)
			}
		}
	}
	for _, key := range []string{
		"vip07.iterable-cache-arm-prefixes-plain",
		"vip07.optional-array-cell-let-0-plain",
		"vip07.optional-object-cell-const-0-plain",
		"vip07.optional-extractor-cell-let-0-plain",
	} {
		c := vipgen.Lookup(key)
		if c == nil {
			t.Fatalf("missing construct %s", key)
		}
		for _, cite := range c.Citations {
			if cite.Reading == "" {
				t.Errorf("%s hides its chapter reading", key)
			}
			if problem := vipTemplateProblem(cite.Template, vipgen.PrintEffect(vipgen.Probe(key))); problem != "" {
				t.Errorf("%s: %s", key, problem)
			}
			if vipInOrder(vipTokens(cite.Template), vipTokens("function witness(){return 0}")) {
				t.Errorf("%s accepts an unrelated reference", key)
			}
		}
	}
}

// Citation mutations exercise the gate itself, independently of the compiler.
// The reference must retain the distinctive expression; chapter edits must
// invalidate its quoted justification, even when another quote still exists.
func FuzzVIPCitationValidation(f *testing.F) {
	startShortBudget(f)
	f.Add("iterable-cache")
	f.Add("optional-binding")
	f.Add("completion-transport")
	f.Fuzz(func(t *testing.T, suffix string) {
		if len(suffix) > 64 {
			suffix = suffix[:64]
		}
		identifier := fmt.Sprintf("value%x", suffix)
		template := "const " + identifier + " = [...items(log)]"
		reference := "function witness(){" + template + ";return " + identifier + "}"
		if problem := vipTemplateProblem(template, reference); problem != "" {
			t.Fatal(problem)
		}
		for _, mutant := range []string{"return", "return ‹value›", "const ‹name›", template} {
			if vipTemplateProblem(mutant, "function witness(){return 0}") == "" {
				t.Fatalf("accepted mutant %q", mutant)
			}
		}
		quote := "The binding is " + identifier + "."
		reading := fmt.Sprintf("004-match.md: %q; %q", "Shared rule.", quote)
		read := func(string) (string, error) { return "Shared rule.\n" + quote, nil }
		if problems := vipReadingProblems(reading, read); len(problems) != 0 {
			t.Fatal(problems)
		}
		read = func(string) (string, error) { return "Shared rule.", nil }
		if problems := vipReadingProblems(reading, read); len(problems) != 1 {
			t.Fatalf("edited chapter: %v", problems)
		}
	})
}
