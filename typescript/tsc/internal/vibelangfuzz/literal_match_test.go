package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

const literalMatchQuote = "| literal `\"a\"`, `1`, `null`, `undefined`, enum member | `s === v` | none |"

// Chapter 4: literal patterns narrow as equality tests. FuzzCompile supplies
// the no-hang and query-order oracles; these seeds vary literal kind, arm
// order and union width around the former cubic-removal witness.
func literalMatchArchive(n int, numbers, reverse bool) string {
	literal := func(i int) string {
		if numbers {
			return strconv.Itoa(i)
		}
		return strconv.Quote(fmt.Sprintf("V%d", i))
	}
	var b strings.Builder
	b.WriteString("type Shape = ")
	for i := range n {
		if i != 0 {
			b.WriteString(" | ")
		}
		b.WriteString(literal(i))
	}
	b.WriteString("\nexport function score(s: Shape): number { return match (s) {\n")
	for j := range n {
		i := j
		if reverse {
			i = n - 1 - j
		}
		fmt.Fprintf(&b, "when %s: %d;\n", literal(i), i)
	}
	b.WriteString("} }\n")
	return Archive(map[string]string{"main.vibe": b.String(), "package.json": `{"type":"module"}`, "tsconfig.json": DefaultConfig})
}

func literalMatchSeeds() []string {
	var seeds []string
	for _, n := range []int{16, 128} {
		for _, numbers := range []bool{false, true} {
			for _, reverse := range []bool{false, true} {
				seeds = append(seeds, literalMatchArchive(n, numbers, reverse))
			}
		}
	}
	return seeds
}

// A fixed hang must graduate to the ordinary corpus, where every run checks
// it and mutations can explore its neighbourhood. Keeping its pending line
// makes a faster host fail XPASS; keeping it oversized silently skips it.
func TestLiteralMatchCorpusActive(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), literalMatchQuote) {
		t.Fatal("literal-match seed citation is absent from Chapter 4")
	}
	t.Setenv("VIBELANG_FUZZ_HANG_PROBE", "")
	const name = "match-flow-limit-cubic"
	if entry, ok := Pending("FuzzCompile", "corpus:"+name); ok {
		t.Errorf("fixed literal-match regression is still pending: %s", entry.Reason)
	}
	data, err := os.ReadFile(filepath.Join(repoTestdata(), "fuzz", "FuzzCompile", name))
	if err != nil {
		t.Fatal(err)
	}
	_, input, ok := strings.Cut(string(data), "\n")
	if !ok {
		t.Fatal("missing corpus header")
	}
	quoted := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(input), "string("), ")")
	archive, err := strconv.Unquote(quoted)
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range append(literalMatchSeeds(), archive) {
		if reason := Admissible(ProjectFromArchive(input)); reason != "" {
			t.Errorf("literal-match regression would skip instead of checking: %s", reason)
		}
	}
}

// Retain the original 3,000-arm stress reproduction outside the mutation size
// cap. The existing match-flow-limit.fail case expects TS2563 at this width;
// the checker must finish under the ordinary Go test deadline, on every host.
// Log its stage duration, but never make successful completion an XPASS.
func TestCompileLargeLiteralMatch(t *testing.T) {
	w := NewWorkspace(t)
	t.Log("compiling the 3,000-arm literal-match stress regression")
	start := time.Now()
	c, err := w.CompileOrdered(t.Context(), ProjectFromArchive(literalMatchArchive(3000, false, false)), OrderTsc, true)
	t.Logf("3000-arm literal match: %v", time.Since(start).Round(time.Millisecond))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	for _, d := range c.Diagnostics {
		if d.Code() != 2563 {
			t.Errorf("unexpected diagnostic: %s", d.String())
		}
	}
}
