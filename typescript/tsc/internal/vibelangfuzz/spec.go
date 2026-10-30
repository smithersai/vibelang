package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
)

// The specification is the oracle. These facts are read from
// docs/design/src at test time, never copied into Go, so a specification
// change reaches every target without an edit here. The VIPs replace the old
// chapters, which move to docs/design/history/src: a chapter not yet rewritten
// from the VIPs is read there until its replacement lands.

// specDirs are where a chapter is looked for, the current specification
// first.
var specDirs = []string{"docs/design/src", "docs/design/history/src"}

// SpecPath returns the path of a specification chapter, such as
// "428-part4-ch28-tooling.md": in docs/design/src, or else in
// docs/design/history/src.
func SpecPath(chapter string) string {
	for _, dir := range specDirs {
		path := filepath.Join(Root(), dir, chapter)
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return filepath.Join(Root(), specDirs[0], chapter)
}

// SpecGlob returns the chapters whose names match pattern, each from the
// first directory of specDirs that has it.
func SpecGlob(pattern string) ([]string, error) {
	var paths []string
	seen := map[string]bool{}
	for _, dir := range specDirs {
		matches, err := filepath.Glob(filepath.Join(Root(), dir, pattern))
		if err != nil {
			return nil, err
		}
		for _, path := range matches {
			if name := filepath.Base(path); !seen[name] {
				seen[name] = true
				paths = append(paths, path)
			}
		}
	}
	return paths, nil
}

// SpecText returns a chapter's text. It panics when the chapter is missing:
// a target without its oracle must not pass.
func SpecText(chapter string) string {
	data, err := os.ReadFile(SpecPath(chapter))
	if err != nil {
		panic(err)
	}
	text := string(data)
	// The historical chapter describes unchanged legacy checks using their old
	// identifiers. Translate identifiers only; keep every quoted rule intact.
	if strings.Contains(SpecPath(chapter), "/history/") {
		text = historicalDiagnosticNames.Replace(text)
	}
	return text
}

// SpecCodes returns every EK code in Chapter 28's registry table, in order.
var SpecCodes = sync.OnceValue(func() []int32 {
	return specCodes(`(?m)^\| EK(\d{4}) \|`)
})

// SpecListedCodes returns the codes Chapter 28 lists after its table, in
// order: "These codes are rules of the language as the table's are", then
// the codes accepted VIPs add before the specification is rewritten from
// them (vipCodes).
var SpecListedCodes = sync.OnceValue(func() []int32 {
	return append(specCodes(`(?m)^- \*\*EK(\d{4})\*\*`), vipCodes...)
})

// vipCodes are the codes the accepted VIPs (docs/design/vips) add, which
// override Chapter 28 until it is rewritten from them: VIP-5's EK0502,
// EK4616, and EK0103, VIP-39's EK4618, VIP-18's EK1802 for a removed await
// operation, and the migration warnings of VIP-3's EK4853, VIP-9's EK4854
// and EK4855, and VIP-9's EK3008. vipRetiredCodes are
// those they retire: EK4404, with the try hatch.
var (
	vipCodes        = []int32{3008, 502, 4616, 103, 2801, 4618, 1802, 4853, 4854, 4855}
	vipRetiredCodes = []int32{4404}
)

func specCodes(pattern string) []int32 {
	var codes []int32
	for _, m := range regexp.MustCompile(pattern).FindAllStringSubmatch(SpecText("428-part4-ch28-tooling.md"), -1) {
		code, _ := strconv.Atoi(m[1])
		if !slices.Contains(codes, int32(code)) {
			codes = append(codes, int32(code))
		}
	}
	return codes
}

// SpecHasCode reports whether the specification registers the code: in
// Chapter 28's table or the list after it, or in Appendix B, where VIP-34
// records every code the VIPs assign, such as EK1302 (decided detail 60).
func SpecHasCode(code int32) bool {
	return slices.Contains(SpecCodes(), code) || slices.Contains(SpecListedCodes(), code) || slices.Contains(AppendixBCodes(), code)
}

// AppendixBCodes returns the codes Appendix B of 900-appendices.md assigns.
var AppendixBCodes = sync.OnceValue(func() []int32 {
	rows, _ := appendixBRows(SpecText(grammarAppendix))
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

// historicalDiagnosticCodes follows the published diagnostic-code map: each
// old identifier the historical chapter uses, and the code that replaced it.
var historicalDiagnosticCodes = [][2]int32{
	{4615, 502},
	{4605, 1903},
	{4606, 1904},
	{2001, 9201},
	{2002, 9202},
	{2003, 9203},
	{2004, 9204},
	{2101, 9205},
	{2102, 9206},
	{2103, 9207},
	{3006, 9208},
	{4617, 103},
}

var historicalDiagnosticNames = func() *strings.Replacer {
	var pairs []string
	for _, p := range historicalDiagnosticCodes {
		pairs = append(pairs, fmt.Sprintf("EK%04d", p[0]), fmt.Sprintf("EK%04d", p[1]))
	}
	return strings.NewReplacer(pairs...)
}()

// historicalCode returns the number Chapter 28 gave code before the map
// renamed it, so that the code keeps the chapter's side of the lint range
// (EK4801): EK9201 was EK2001, a rule before the lint range.
func historicalCode(code int32) int32 {
	for _, p := range historicalDiagnosticCodes {
		if p[1] == code {
			return p[0]
		}
	}
	return code
}
