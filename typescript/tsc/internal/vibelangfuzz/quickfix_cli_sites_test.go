package vibelangfuzz

import (
	"fmt"
	"github.com/pmezard/go-difflib/difflib"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// Chapter 7 / VIP-34: consume the CLI's original-byte refusal ranges.
// Inferred byte edits also protect a repeated token at its actual site.
func quickfixCLIRefusals(t *testing.T, dir, output string, before, after map[string]string) {
	t.Helper()
	pattern := regexp.MustCompile("(?m)^vibelang --fix: refused site: (.+):([0-9]+):([0-9]+)-([0-9]+):([0-9]+) \\[([0-9]+),([0-9]+)\\) ([^:]+): ")
	for _, m := range pattern.FindAllStringSubmatch(output, -1) {
		name := m[1]
		if filepath.IsAbs(name) {
			var err error
			name, err = filepath.Rel(dir, name)
			if err != nil {
				t.Fatal(err)
			}
		}
		name = filepath.ToSlash(name)
		source, ok := before[name]
		if !ok {
			t.Fatalf("refused site names an unknown source: %s", name)
		}
		start, _ := strconv.Atoi(m[6])
		end, _ := strconv.Atoi(m[7])
		if start < 0 || end < start || end > len(source) {
			t.Fatalf("invalid refused range %s [%d,%d)", name, start, end)
		}
		lines := newToolsLines(source)
		a, b := lines.position(start), lines.position(end)
		want := fmt.Sprintf("%d:%d-%d:%d", a.Line+1, a.Character+1, b.Line+1, b.Character+1)
		if got := m[2] + ":" + m[3] + "-" + m[4] + ":" + m[5]; got != want {
			t.Fatalf("refusal coordinates %s disagree with byte range: want %s", got, want)
		}
		if strings.HasSuffix(m[8], " new") {
			t.Logf("refused-site CLI %s:%s [%d,%d) %s: no original bytes; checked on the second run", name, want, start, end, m[8])
			continue
		}
		var edits []toolsEdit
		bytes := func(s string) []string {
			v := make([]string, len(s))
			for i := range v {
				v[i] = s[i : i+1]
			}
			return v
		}
		matcher := difflib.NewMatcherWithJunk(bytes(source), bytes(after[name]), false, nil)
		for _, op := range matcher.GetOpCodes() {
			if op.Tag != 'e' {
				edits = append(edits, toolsEdit{start: op.I1, end: op.I2, text: after[name][op.J1:op.J2]})
			}
		}
		if problem := quickfixRefusedEdit(source, after[name], toolsEdit{start: start, end: end}, edits); problem != "" {
			t.Fatalf("%s %s: %s", name, m[8], problem)
		}
		t.Logf("refused-site CLI %s:%s [%d,%d) %s", name, want, start, end, m[8])
	}
}
func TestQuickFixCLIRefusalRanges(t *testing.T) {
	source := "// 🧪\r\nconst refused=7; const other=7;\r\n"
	start := strings.Index(source, "refused")
	end := start + len("refused")
	a, b := newToolsLines(source).position(start), newToolsLines(source).position(end)
	output := fmt.Sprintf("vibelang --fix: refused site: main.vibe:%d:%d-%d:%d [%d,%d) EK4810: kept\r\n", a.Line+1, a.Character+1, b.Line+1, b.Character+1, start, end)
	quickfixCLIRefusals(t, "/project", output, map[string]string{"main.vibe": source}, map[string]string{"main.vibe": "// added\r\n" + source})
}

// A newly generated site has only an anchor in the original source. Its
// replacement bytes are protected as an ordinary site on the second run.
func TestQuickFixCLINewRefusalRange(t *testing.T) {
	before := "old expression"
	after := "new expression"
	output := "vibelang --fix: refused site: main.vibe:1:1-1:4 [0,3) EK4836 new: kept\n"
	quickfixCLIRefusals(t, "/project", output, map[string]string{"main.vibe": before}, map[string]string{"main.vibe": after})
	second := "vibelang --fix: refused site: main.vibe:1:1-1:4 [0,3) EK4836: kept\n"
	quickfixCLIRefusals(t, "/project", second, map[string]string{"main.vibe": after}, map[string]string{"main.vibe": after})
}
