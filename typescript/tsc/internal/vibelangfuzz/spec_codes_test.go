package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// Appendix B of docs/design/src/900-appendices.md lists every diagnostic code
// the VIPs assign (VIP-34). A chapter or a VIP that assigned or cited a code
// without a row there came back in review after review, so this test makes
// the check mechanical: every code a chapter cites, and every code an
// accepted VIP's Decision section cites (its amendments included), has a
// row. A citation that names a code the VIP deletes or replaces says so with
// "old" earlier in its sentence ("the old EK1019 is deleted") and needs none.
// TestRegistryMatchesSpec, in internal/vibelang, checks that every row is
// registered.

var (
	ekCode        = regexp.MustCompile(`EK(\d{4})`)
	ekCell        = regexp.MustCompile("^`?EK(\\d{4})`?$")
	oldInSentence = regexp.MustCompile(`(?i)\bold\b`)
)

// appendixBRows returns Appendix B's codes, each with its row's cell in the
// column the table's header names "VIP". It counts that column from the end
// of the row, so a pipe in a rule's text cannot move it.
func appendixBRows(appendix string) (map[string]string, string) {
	start := strings.Index(appendix, "## Appendix B")
	if start < 0 {
		return nil, ""
	}
	section := appendix[start:]
	if next := strings.Index(section[1:], "\n## "); next >= 0 {
		section = section[:next+1]
	}
	rows := map[string]string{}
	vip := -1
	for _, line := range strings.Split(section, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "| ") || !strings.HasSuffix(line, " |") {
			continue
		}
		cells := strings.Split(strings.TrimSuffix(strings.TrimPrefix(line, "| "), " |"), " | ")
		if i := slices.Index(cells, "VIP"); cells[0] == "Code" && i >= 0 {
			vip = len(cells) - 1 - i
			continue
		}
		if m := ekCell.FindStringSubmatch(cells[0]); m != nil && vip >= 0 && vip < len(cells) {
			rows[m[1]] = strings.TrimSpace(cells[len(cells)-1-vip])
		}
	}
	return rows, section
}

// citedCodes returns the codes text cites, each with the sentence it stands
// in, leaving out a code its sentence calls old.
func citedCodes(text string) map[string]string {
	codes := map[string]string{}
	for _, loc := range ekCode.FindAllStringSubmatchIndex(text, -1) {
		begin := strings.LastIndexAny(text[:loc[0]], ".\n") + 1
		if oldInSentence.MatchString(text[begin:loc[0]]) {
			continue
		}
		end := strings.IndexAny(text[loc[1]:], ".\n")
		if end < 0 {
			end = len(text) - loc[1]
		}
		code := text[loc[2]:loc[3]]
		if _, ok := codes[code]; !ok {
			codes[code] = strings.TrimSpace(text[begin : loc[1]+end])
		}
	}
	return codes
}

// pendingCodes are codes the specification cites before their rows exist,
// each with the lane that registers the code and adds its row. A code here
// that gains a row fails, so the entry is deleted in that change.
var pendingCodes = map[string]string{}

// TestSpecCodesInAppendixB checks that every code the chapters and the
// accepted VIPs' decisions cite has a row in Appendix B, and that a code a
// VIP's decision cites has a row naming that VIP.
func TestSpecCodesInAppendixB(t *testing.T) {
	src := filepath.Join(Root(), "docs/design/src")
	data, err := os.ReadFile(filepath.Join(src, grammarAppendix))
	if err != nil {
		t.Fatal(err)
	}
	rows, table := appendixBRows(string(data))
	if len(rows) == 0 {
		t.Fatal("Appendix B lists no code")
	}
	for code, reason := range pendingCodes {
		if _, ok := rows[code]; ok {
			t.Errorf("EK%s now has an Appendix B row; delete it from pendingCodes (%s)", code, reason)
		}
	}
	listed := func(code string) bool {
		_, row := rows[code]
		_, pending := pendingCodes[code]
		return row || pending
	}
	chapters, err := filepath.Glob(filepath.Join(src, "*.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range chapters {
		text, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		body := strings.Replace(string(text), table, "", 1)
		for code, sentence := range citedCodes(body) {
			if !listed(code) {
				t.Errorf("%s cites EK%s, which Appendix B does not list: %q", filepath.Base(path), code, sentence)
			}
		}
	}
	vips := filepath.Join(Root(), "docs/design/vips")
	readme, err := os.ReadFile(filepath.Join(vips, "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range vipAcceptedRow.FindAllStringSubmatch(string(readme), -1) {
		n, _ := strconv.Atoi(m[1])
		text, err := vipText(n)
		if err != nil {
			t.Fatal(err)
		}
		start := strings.Index(text, "## Decision")
		if start < 0 {
			continue
		}
		decision := text[start:]
		if next := strings.Index(decision[1:], "\n## "); next >= 0 {
			decision = decision[:next+1]
		}
		for code, sentence := range citedCodes(decision) {
			column, ok := rows[code]
			switch {
			case !ok && pendingCodes[code] != "":
			case !ok:
				t.Errorf("VIP-%d's decision cites EK%s, which Appendix B does not list: %q", n, code, sentence)
			case !slices.Contains(regexp.MustCompile(`\d+`).FindAllString(column, -1), fmt.Sprint(n)):
				t.Errorf("VIP-%d's decision cites EK%s, whose Appendix B row names VIP %s", n, code, column)
			}
		}
	}
}
