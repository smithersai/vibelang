package vibelangfuzz

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
)

// SpecPath returns the path of a chapter in the current specification.
func SpecPath(chapter string) string {
	return filepath.Join(Root(), specDir, chapter)
}

const specDir = "docs/design/src"

// ReadSpecText returns a chapter's text or an error if the chapter is missing.
func ReadSpecText(chapter string) (string, error) {
	data, err := os.ReadFile(SpecPath(chapter))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SpecText returns a chapter's text, failing the harness if the chapter is missing:
// a target without its oracle must not pass.
func SpecText(chapter string) string {
	text, err := ReadSpecText(chapter)
	if err != nil {
		failFuzz(err)
	}
	return text
}

// SpecCodes returns the codes registered by Appendix B and current tooling.
// It never reads the historical registry.
var SpecCodes = sync.OnceValue(func() []int32 {
	var codes []int32
	for code := range Facts().Rows {
		codes = append(codes, code)
	}
	slices.Sort(codes)
	return codes
})

// SpecListedCodes keeps the VIP-ahead escape for accepted assignments not yet
// represented by a current registry row.
var SpecListedCodes = sync.OnceValue(func() []int32 {
	var codes []int32
	for code := range vipCodes {
		if !slices.Contains(SpecCodes(), code) {
			codes = append(codes, code)
		}
	}
	slices.Sort(codes)
	return codes
})

// vipCodes are the codes an accepted VIP (docs/design/vips) assigns before
// Appendix B has their rows, each with the default category its VIP states:
// a code that is registered without a category would be accepted at any
// category. Delete an entry once its row lands (TestSpecFacts). Every code
// listed here so far has its row or its interim entry now, and the retired
// EK4618 has neither, so the compiler may not report it.
var vipCodes = map[int32]DefaultCategory{}

// SpecHasCode reports whether the current registry, its transitional
// inventory, its imported table or an accepted VIP names code.
func SpecHasCode(code int32) bool {
	_, imported := Facts().Imported[code]
	return imported || slices.Contains(SpecCodes(), code) || slices.Contains(SpecListedCodes(), code) || slices.Contains(Facts().Interim, code)
}

// AppendixBCodes returns the codes Appendix B of 900-appendices.md assigns.
var AppendixBCodes = sync.OnceValue(func() []int32 {
	rows, _ := appendixBRows(currentSpecText(grammarAppendix))
	var codes []int32
	for code := range rows {
		n, _ := strconv.Atoi(code)
		codes = append(codes, int32(n))
	}
	slices.Sort(codes)
	return codes
})

// ekCell is the code cell of an Appendix B row, EK0101 or `EK0101`.
var ekCell = regexp.MustCompile("^`?EK(38[0-9]{2,}|[0-9]{4})`?$")

// interimCell is the first cell of a row in Appendix B's inventory of
// transitional compatibility codes.
var interimCell = regexp.MustCompile("(?m)^\\| interim `EK(38[0-9]{2,}|[0-9]{4})` \\|")

// appendixBInterimCodes returns the codes section lists as interim.
func appendixBInterimCodes(section string) map[string]bool {
	codes := map[string]bool{}
	for _, m := range interimCell.FindAllStringSubmatch(section, -1) {
		codes[m[1]] = true
	}
	return codes
}

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

// appendixBChapterRows reads the Chapter and Rule cells by their headers.
// It is separate from appendixBRows, whose VIP-cell API other targets use.
func appendixBChapterRows(appendix string) map[string]appendixBChapterRow {
	_, section := appendixBRows(appendix)
	rows := map[string]appendixBChapterRow{}
	var header []string
	chapter, rule := -1, -1
	for _, line := range strings.Split(section, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "| ") || !strings.HasSuffix(line, " |") {
			continue
		}
		cells := strings.Split(strings.TrimSuffix(strings.TrimPrefix(line, "| "), " |"), " | ")
		if cells[0] == "Code" {
			header = cells
			chapter, rule = slices.Index(header, "Chapter"), slices.Index(header, "Rule")
			continue
		}
		m := ekCell.FindStringSubmatch(cells[0])
		if m == nil || chapter < 0 || rule < 0 || len(cells) < len(header) {
			continue
		}
		// A pipe in Rule adds cells. All columns after Rule are counted from
		// the end so that it cannot change the chapter link we read.
		chapterCell := chapter
		if chapter > rule {
			chapterCell += len(cells) - len(header)
		}
		ruleEnd := len(cells) - (len(header) - 1 - rule)
		rows[m[1]] = appendixBChapterRow{Chapter: strings.TrimSpace(cells[chapterCell]), Rule: strings.TrimSpace(strings.Join(cells[rule:ruleEnd], " | "))}
	}
	return rows
}

type appendixBChapterRow struct{ Chapter, Rule string }

var configurationDiagnosticRows = sync.OnceValue(func() map[string]appendixBChapterRow {
	rows := appendixBChapterRows(SpecText(grammarAppendix))
	for code, row := range rows {
		if !strings.Contains(row.Chapter, "(007-tooling.md") {
			delete(rows, code)
		}
	}
	return rows
})
