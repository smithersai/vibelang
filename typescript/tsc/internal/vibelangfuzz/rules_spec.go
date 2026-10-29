package vibelangfuzz

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
)

// The facts the rule targets check come from Chapter 28's text at test time:
// each code's registry row, its default category, which codes a project may
// adjust, and which codes the specification retires. Nothing here copies a
// fact into Go; TestSpecRuleFacts checks that the parse finds what the
// chapter's own prose says it holds.

const toolingChapter = "428-part4-ch28-tooling.md"

// A SpecRow is one row of Chapter 28's diagnostic registry.
type SpecRow struct {
	Code     int32
	Reports  string // what the code reports
	Repair   string // the suggested repair
	Chapters string
}

// SpecRows returns Chapter 28's registry rows by code, and the codes the
// chapter lists after the table ("These codes are rules of the language as
// the table's are"), each with its item's text as Reports.
var SpecRows = sync.OnceValue(func() map[int32]SpecRow {
	rows := map[int32]SpecRow{}
	bullet := regexp.MustCompile(`^- \*\*EK(\d{4})\*\*: (.*)$`)
	for line := range strings.SplitSeq(SpecText(toolingChapter), "\n") {
		if m := bullet.FindStringSubmatch(line); m != nil {
			code, _ := strconv.Atoi(m[1])
			rows[int32(code)] = SpecRow{Code: int32(code), Reports: m[2]}
			continue
		}
		if !strings.HasPrefix(line, "| EK") {
			continue
		}
		cells := splitTableRow(line)
		if len(cells) < 4 {
			continue
		}
		code, err := strconv.Atoi(strings.TrimPrefix(cells[0], "EK"))
		if err != nil {
			continue
		}
		rows[int32(code)] = SpecRow{Code: int32(code), Reports: cells[1], Repair: cells[2], Chapters: cells[3]}
	}
	return rows
})

// splitTableRow splits a Markdown table row at the pipes that are not escaped
// as \|, which the rows use for the pipe operator.
func splitTableRow(line string) []string {
	line = strings.TrimSpace(line)
	line = strings.TrimPrefix(line, "|")
	line = strings.TrimSuffix(line, "|")
	var cells []string
	var cell strings.Builder
	for i := 0; i < len(line); i++ {
		switch {
		case line[i] == '\\' && i+1 < len(line) && line[i+1] == '|':
			cell.WriteString(`\|`)
			i++
		case line[i] == '|':
			cells = append(cells, strings.TrimSpace(cell.String()))
			cell.Reset()
		default:
			cell.WriteByte(line[i])
		}
	}
	return append(cells, strings.TrimSpace(cell.String()))
}

// Categories the specification gives a code: the default, or what a setting
// makes it.
const (
	CategoryError   = "error"
	CategoryWarning = "warning"
	CategoryOff     = "off"
)

// specParagraph returns the paragraph of the chapter that starts with prefix.
func specParagraph(chapter, prefix string) string {
	text := SpecText(chapter)
	start := strings.Index(text, prefix)
	if start < 0 {
		return ""
	}
	end := strings.Index(text[start:], "\n\n")
	if end < 0 {
		return text[start:]
	}
	return text[start : start+end]
}

// warningsBeforeEK4801 returns the codes before EK4801 that Chapter 28's
// opening paragraph calls warnings by default: those named in its sentences
// that do not also call something an error.
var warningsBeforeEK4801 = sync.OnceValue(func() []int32 {
	var codes []int32
	for sentence := range strings.SplitSeq(specParagraph(toolingChapter, "Before EK4801,"), ". ") {
		if strings.Contains(sentence, "error") {
			continue
		}
		codes = append(codes, codesIn(sentence)...)
	}
	return codes
})

// SpecDefaultCategory returns the category Chapter 28 gives a code by
// default: the registry row's own word ("Warning:", "Off by default:",
// "Error by default"), else, before EK4801, the opening paragraph's list of
// warnings, else an error ("Every other code before EK4801 is an error by
// default"; an EK48xx row without a word is an error, as EK4813 is).
func SpecDefaultCategory(code int32) string {
	reports := strings.ToLower(SpecRows()[code].Reports)
	switch {
	case strings.HasPrefix(reports, "warning"), strings.HasPrefix(reports, "a warning"):
		return CategoryWarning
	case strings.HasPrefix(reports, "off by default"):
		return CategoryOff
	case strings.HasPrefix(reports, "error by default"), strings.HasPrefix(reports, "an error"):
		return CategoryError
	}
	if code < 4801 && slices.Contains(warningsBeforeEK4801(), code) {
		return CategoryWarning
	}
	return CategoryError
}

// SpecAdjustableCodes returns the codes the `diagnostics` setting accepts,
// from the row of Chapter 28's settings table: the quoted codes, and each
// range of registry codes, less the codes after "except".
var SpecAdjustableCodes = sync.OnceValue(func() []int32 {
	var row string
	for line := range strings.SplitSeq(SpecText(toolingChapter), "\n") {
		if strings.HasPrefix(line, "| `diagnostics` |") {
			row = splitTableRow(line)[1]
		}
	}
	var codes, except []int32
	for _, part := range strings.Split(row, ",") {
		before, after, found := strings.Cut(part, "except")
		ranges := regexp.MustCompile(`EK(\d{4})-EK(\d{4})`)
		for _, m := range ranges.FindAllStringSubmatch(before, -1) {
			low, _ := strconv.Atoi(m[1])
			high, _ := strconv.Atoi(m[2])
			for _, code := range SpecCodes() {
				if code >= int32(low) && code <= int32(high) && !slices.Contains(codes, code) {
					codes = append(codes, code)
				}
			}
		}
		for _, code := range codesIn(ranges.ReplaceAllString(before, "")) {
			if !slices.Contains(codes, code) {
				codes = append(codes, code)
			}
		}
		if found {
			except = append(except, codesIn(after)...)
		}
	}
	return slices.DeleteFunc(codes, func(code int32) bool { return slices.Contains(except, code) })
})

// SpecAdjustable reports whether a project may set the code's category.
func SpecAdjustable(code int32) bool {
	return slices.Contains(SpecAdjustableCodes(), code)
}

// SpecCommentAdjustable reports whether an @vibelang-diagnostics comment may
// set the code's category. Chapter 28 says so of EK4801-EK4825 (D241) and of
// EK4830-EK4837 ("adjustable the same way"); of the earlier adjustable codes
// it names only the setting, so the targets set those in tsconfig.json only.
func SpecCommentAdjustable(code int32) bool {
	return SpecAdjustable(code) && code >= 4801
}

// SpecRetiredCodes returns the codes the specification keeps unused: those
// Chapter 28's sentence "Retired codes keep their numbers unused" names, the
// registry rows that start "Retired", and the rows that start "Reserved
// historical", rules for TypeScript files that D266 suppresses, which no
// .vibe file can draw.
var SpecRetiredCodes = sync.OnceValue(func() []int32 {
	codes := append(codesIn(specParagraph(toolingChapter, "Retired codes keep their numbers unused")), vipRetiredCodes...)
	for code, row := range SpecRows() {
		if strings.HasPrefix(row.Reports, "Retired") || strings.HasPrefix(row.Reports, "Reserved historical") {
			if !slices.Contains(codes, code) {
				codes = append(codes, code)
			}
		}
	}
	slices.Sort(codes)
	return codes
})

// SpecRetired reports whether the specification keeps a code unused.
func SpecRetired(code int32) bool {
	return slices.Contains(SpecRetiredCodes(), code)
}

// specCodeName writes a code as the specification does.
func specCodeName(code int32) string {
	return "EK" + strconv.Itoa(int(code))
}
