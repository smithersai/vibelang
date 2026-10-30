package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
)

// Chapter 28's facts about EK diagnostics, read from its text: each code's
// default category, the codes a project may adjust, the codes the registry
// retired, and the rules listed below the registry table. As with SpecCodes,
// nothing here copies a code list into Go; TestSpecFacts checks that each
// derivation finds what the chapter says it holds.

const chapter28 = "428-part4-ch28-tooling.md"

// A DefaultCategory is the category Chapter 28 gives a code when no setting
// or comment changes it.
type DefaultCategory int

const (
	// DefaultUnknown: the chapter gives the code no default, as for the
	// reserved historical D242 rules EK4819 and EK4820.
	DefaultUnknown DefaultCategory = iota
	DefaultError
	DefaultWarning
	// DefaultErrorOrWarning: one code with forms of both categories, as
	// EK4408 warns for a module name that collides with a value binding and
	// is an error otherwise (D303).
	DefaultErrorOrWarning
	// DefaultOff: the code reports nothing until a project or a comment turns
	// it on (D241).
	DefaultOff
	// DefaultNever: the CLI never reports the code, as EK9101 is an
	// editor-only suggestion.
	DefaultNever
)

func (c DefaultCategory) String() string {
	return [...]string{"unknown", "error", "warning", "error or warning", "off", "never reported"}[c]
}

// SpecFacts are Chapter 28's facts about EK codes.
type SpecFacts struct {
	// Boundary is the first code of the lint range, EK4801, before which the
	// "#### Diagnostics" paragraph lists the warnings.
	Boundary int32
	// WarningCount is the number of warnings before Boundary that the
	// paragraph states in words ("nine").
	WarningCount int
	// Defaults is every registry code's default category.
	Defaults map[int32]DefaultCategory
	// Adjustable are the codes the options table lets the `vibelang`
	// setting `diagnostics` change (D34, D241, D275).
	Adjustable []int32
	// Retired are the codes the registry keeps unused.
	Retired []int32
	// Rules are the codes listed below the table, "rules of the language as
	// the table's are" (D374).
	Rules []int32
	// Severities are the values a diagnostics setting takes.
	Severities []string
	// Tracing are the values of the `tracing` setting.
	Tracing []string
}

// Imported lint ordinals can extend the printed number beyond four digits.
var codePattern = regexp.MustCompile(`EK(\d{4,})\b`)

func codesIn(text string) []int32 {
	var codes []int32
	for _, m := range codePattern.FindAllStringSubmatch(text, -1) {
		n, err := strconv.ParseInt(m[1], 10, 32)
		if err != nil {
			continue // A printed diagnostic number must fit the native int32 code.
		}
		if !slices.Contains(codes, int32(n)) {
			codes = append(codes, int32(n))
		}
	}
	return codes
}

var numberWords = map[string]int{"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12}

// section returns the text of the chapter's section that starts with heading,
// up to the next heading of the same level.
func section(text, heading string) string {
	start := strings.Index(text, "\n"+heading+"\n")
	if start < 0 {
		return ""
	}
	rest := text[start+len(heading)+2:]
	level := heading[:strings.IndexByte(heading, ' ')+1]
	if end := strings.Index(rest, "\n"+level); end >= 0 {
		rest = rest[:end]
	}
	return rest
}

// registryRows returns the cells of each row of the registry table, by code.
func registryRows(text string) map[int32][]string {
	rows := map[int32][]string{}
	for line := range strings.SplitSeq(text, "\n") {
		if !strings.HasPrefix(line, "| EK") {
			continue
		}
		cells := strings.Split(strings.Trim(line, "|"), " | ")
		for i := range cells {
			cells[i] = strings.TrimSpace(cells[i])
		}
		if codes := codesIn(cells[0]); len(codes) == 1 {
			rows[codes[0]] = cells
		}
	}
	return rows
}

// Facts returns Chapter 28's facts, read from the specification.
var Facts = sync.OnceValue(func() *SpecFacts {
	text := SpecText(chapter28)
	facts := &SpecFacts{Defaults: map[int32]DefaultCategory{}}
	diagnostics := section(text, "#### Diagnostics")

	// "Before EK4801, nine EK codes are warnings by default. Five mark
	// retired spellings …: EK2112, …. Three are policy diagnostics: …. EK4406
	// marks deprecated trust tags (D249). EK4408 also warns for a module name
	// that collides with a value binding, while its other forms are errors
	// (D303). Every other code before EK4801 is an error by default."
	lead := regexp.MustCompile(`Before EK(\d{4}), (\w+) EK codes are warnings by default\.`).FindStringSubmatchIndex(diagnostics)
	if lead == nil {
		panic("Chapter 28's Diagnostics section no longer opens with the warnings before the lint range")
	}
	boundary, _ := strconv.Atoi(diagnostics[lead[2]:lead[3]])
	facts.Boundary = int32(boundary)
	facts.WarningCount = numberWords[diagnostics[lead[4]:lead[5]]]
	paragraph := diagnostics[lead[1]:]
	paragraph = paragraph[:strings.Index(paragraph, "\n\n")]
	mixedAt := strings.Index(paragraph, "also warns")
	sentenceStart := strings.LastIndex(paragraph[:mixedAt], ". ") + 2
	warnings := codesIn(paragraph[:sentenceStart])
	mixedSentence := paragraph[sentenceStart:]
	mixedSentence = mixedSentence[:strings.Index(mixedSentence, ". ")+1]
	mixed := codesIn(mixedSentence)

	// The second paragraph: the adjustable policy codes, the codes no setting
	// lowers, and the retired codes.
	rest := diagnostics[lead[1]+len(paragraph):]
	if i := strings.Index(rest, "Retired codes keep their numbers unused"); i >= 0 {
		retired := rest[i:]
		retired = retired[:strings.Index(retired, "\n")]
		facts.Retired = codesIn(retired)
	}

	rows := registryRows(text)
	for code, cells := range rows {
		reports := cells[1]
		switch {
		case strings.HasPrefix(reports, "Retired"):
			if !slices.Contains(facts.Retired, code) {
				facts.Retired = append(facts.Retired, code)
			}
			facts.Defaults[code] = DefaultNever
		case historicalCode(code) < facts.Boundary:
			switch {
			case slices.Contains(mixed, code):
				facts.Defaults[code] = DefaultErrorOrWarning
			case slices.Contains(warnings, code):
				facts.Defaults[code] = DefaultWarning
			default:
				facts.Defaults[code] = DefaultError
			}
		default:
			facts.Defaults[code] = lintDefault(reports)
		}
	}
	for _, code := range facts.Retired {
		facts.Defaults[code] = DefaultNever
	}

	// The rules below the table: "- **EK1018**: …". Each is before the lint
	// range, where every code the paragraph does not name is an error.
	tail := text[strings.Index(text, "These codes are rules of the language as the table's are"):]
	tail = tail[:strings.Index(tail, "\n####")]
	for _, m := range regexp.MustCompile(`(?m)^- \*\*EK(\d{4})\*\*`).FindAllStringSubmatch(tail, -1) {
		n, _ := strconv.Atoi(m[1])
		facts.Rules = append(facts.Rules, int32(n))
		switch {
		case int32(n) < facts.Boundary && slices.Contains(warnings, int32(n)):
			facts.Defaults[int32(n)] = DefaultWarning // EK2129 (D504)
		case int32(n) < facts.Boundary && !slices.Contains(mixed, int32(n)):
			facts.Defaults[int32(n)] = DefaultError
		default:
			facts.Defaults[int32(n)] = DefaultUnknown
		}
	}

	// The options table's diagnostics row: `"EK1012"`, …, EK4801-EK4825
	// except `"EK4813"`, and EK4830-EK4837, each `"error"`, `"warning"`, or
	// `"off"`.
	options := map[string][]string{}
	for line := range strings.SplitSeq(diagnostics, "\n") {
		if strings.HasPrefix(line, "| `") {
			cells := strings.Split(strings.Trim(line, "|"), " | ")
			options[strings.Trim(strings.TrimSpace(cells[0]), "`")] = cells[1:]
		}
	}
	values := options["diagnostics"][0]
	each := strings.Index(values, ", each ")
	codes, severities := values[:each], values[each:]
	var except []int32
	for _, m := range regexp.MustCompile(`EK(\d{4})-EK(\d{4})(?: except ((?:`+"`"+`"EK\d{4}"`+"`"+`(?:, | and | or )?)+))?`).FindAllStringSubmatch(codes, -1) {
		from, _ := strconv.Atoi(m[1])
		to, _ := strconv.Atoi(m[2])
		excluded := codesIn(m[3])
		except = append(except, excluded...)
		for code := int32(from); code <= int32(to); code++ {
			if _, registered := rows[code]; registered && !slices.Contains(excluded, code) {
				facts.Adjustable = append(facts.Adjustable, code)
			}
		}
	}
	for _, m := range regexp.MustCompile("`\"EK(\\d{4})\"`").FindAllStringSubmatch(codes, -1) {
		n, _ := strconv.Atoi(m[1])
		if !slices.Contains(except, int32(n)) && !slices.Contains(facts.Adjustable, int32(n)) {
			facts.Adjustable = append(facts.Adjustable, int32(n))
		}
	}
	slices.Sort(facts.Adjustable)
	facts.Severities = quoted(severities)
	facts.Tracing = quoted(options["tracing"][0])
	return facts
})

// lintDefault reads a lint-range row's default category from the start of
// its "What it reports" cell, where the chapter states it (D241).
func lintDefault(reports string) DefaultCategory {
	lower := strings.ToLower(reports)
	switch {
	case strings.Contains(lower, "not emitted by the cli"):
		return DefaultNever
	case strings.HasPrefix(lower, "off by default"):
		return DefaultOff
	case strings.HasPrefix(lower, "warning"), strings.HasPrefix(lower, "a warning"):
		return DefaultWarning
	case strings.HasPrefix(lower, "error by default"), strings.HasPrefix(lower, "an error"),
		strings.Contains(lower, "; an error by default"), strings.Contains(lower, "an error in every renderer"),
		strings.Contains(lower, "an error that no setting lowers"):
		return DefaultError
	case regexp.MustCompile(`replaces typescript's ts\d+`).MatchString(lower):
		// EK4813 stands in for TypeScript's TS2339, an error, and no setting
		// changes it.
		return DefaultError
	}
	return DefaultUnknown
}

func quoted(text string) []string {
	var values []string
	for _, m := range regexp.MustCompile("`\"([a-z]+)\"`").FindAllStringSubmatch(text, -1) {
		values = append(values, m[1])
	}
	return values
}

// IsAdjustable reports whether a project's `diagnostics` setting or an
// @vibelang-diagnostics comment may change code's category.
func (f *SpecFacts) IsAdjustable(code int32) bool {
	return slices.Contains(f.Adjustable, code)
}

// IsRegistered reports whether Chapter 28 names code: a row of its table, a
// rule listed below it, or an imported lint rule's code (Appendix B).
func (f *SpecFacts) IsRegistered(code int32) bool {
	_, imported := ImportedLintCodes()[code]
	return SpecHasCode(code) || slices.Contains(f.Rules, code) || imported
}

// ImportedLintCodes are Appendix B's imported lint codes by rule name, read
// from the normative docs/design/inventory/lint-codes.json ("The normative
// lint-codes.json and this table are generated by
// `node docs/tools/lint-codes.mjs --write`"). TestImportedLintCodes holds the
// compiler's codes to it.
var ImportedLintCodes = sync.OnceValue(func() map[int32]string {
	data, err := os.ReadFile(filepath.Join(Root(), "docs/design/inventory/lint-codes.json"))
	if err != nil {
		panic(err)
	}
	var inventory struct {
		Rules []struct{ Code, Rule string }
	}
	if err := json.Unmarshal(data, &inventory); err != nil {
		panic(fmt.Errorf("lint-codes.json: %w", err))
	}
	codes := map[int32]string{}
	for _, r := range inventory.Rules {
		n, err := strconv.Atoi(strings.TrimPrefix(r.Code, "EK"))
		if err != nil {
			panic(fmt.Errorf("lint-codes.json: %s: %w", r.Code, err))
		}
		codes[int32(n)] = r.Rule
	}
	return codes
})

// Default returns code's default category.
func (f *SpecFacts) Default(code int32) DefaultCategory {
	return f.Defaults[code]
}
