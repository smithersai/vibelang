package compiler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
)

// validateLoweredRequest enforces the LoweringMode contract documented on
// LoweredSource before a request reaches the pinned bridge. The bridge
// revalidates independently; this Go-side pass exists so malformed producer
// output fails fast with a structured error even without a fork checkout.
func validateLoweredRequest(request CompileRequest) error {
	switch request.Lowering {
	case "":
		return errors.New("lowering mode is required")
	case LoweringIdentity, LoweringInternal:
		for _, file := range request.Files {
			if file.Lowered != nil {
				return fmt.Errorf("file %q carries lowered content but the request does not use %q lowering", file.Path, LoweringExternal)
			}
		}
		return nil
	case LoweringExternal:
		if len(request.Files) == 0 {
			return fmt.Errorf("%q lowering requires in-memory files; disk roots cannot carry lowered content", LoweringExternal)
		}
		for _, file := range request.Files {
			if file.Kind != FileKindSmithers {
				if file.Lowered != nil {
					return fmt.Errorf("file %q is not a .sm file and must not carry lowered content", file.Path)
				}
				continue
			}
			if file.Lowered == nil {
				return fmt.Errorf("%q lowering requires lowered content for .sm file %q", LoweringExternal, file.Path)
			}
			if file.Lowered.Text == "" {
				return fmt.Errorf("lowered text for %q is empty", file.Path)
			}
			if err := validateLoweredSourceMap(file.Path, file.Text, file.Lowered); err != nil {
				return fmt.Errorf("lowered source map for %q: %w", file.Path, err)
			}
		}
		return nil
	default:
		return fmt.Errorf("unsupported lowering mode %q", string(request.Lowering))
	}
}

// suppliedSourceMap is the exact accepted field set for an authored→lowered
// version-3 source map. Unknown fields are rejected.
type suppliedSourceMap struct {
	Version        int       `json:"version"`
	File           string    `json:"file"`
	SourceRoot     string    `json:"sourceRoot"`
	Sources        []string  `json:"sources"`
	SourcesContent []*string `json:"sourcesContent"`
	Names          []string  `json:"names"`
	Mappings       *string   `json:"mappings"`
}

func validateLoweredSourceMap(authoredPath string, authoredText string, lowered *LoweredSource) error {
	parsed, err := parseSuppliedSourceMap(lowered.SourceMap)
	if err != nil {
		return err
	}
	if err := checkSuppliedSourceMapIdentity(parsed, authoredPath, authoredText); err != nil {
		return err
	}
	authoredLines := newLineIndex(authoredText)
	loweredLines := newLineIndex(lowered.Text)
	_, err = decodeSuppliedMappings(*parsed.Mappings, len(parsed.Names), authoredLines, loweredLines)
	return err
}

func parseSuppliedSourceMap(text string) (*suppliedSourceMap, error) {
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.DisallowUnknownFields()
	var parsed suppliedSourceMap
	if err := decoder.Decode(&parsed); err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, errors.New("parse: expected one JSON value")
	}
	return &parsed, nil
}

func checkSuppliedSourceMapIdentity(parsed *suppliedSourceMap, authoredPath string, authoredText string) error {
	if parsed.Version != 3 {
		return fmt.Errorf("version must be 3, got %d", parsed.Version)
	}
	if parsed.SourceRoot != "" {
		return fmt.Errorf("sourceRoot must be empty, got %q", parsed.SourceRoot)
	}
	if len(parsed.Sources) != 1 {
		return fmt.Errorf("sources must name exactly the authored file, got %d entries", len(parsed.Sources))
	}
	if cleaned := path.Clean(parsed.Sources[0]); cleaned != path.Clean(authoredPath) {
		return fmt.Errorf("sources must name the authored file %q, got %q", authoredPath, parsed.Sources[0])
	}
	if parsed.SourcesContent != nil {
		if len(parsed.SourcesContent) != 1 || parsed.SourcesContent[0] == nil {
			return errors.New("sourcesContent must be exactly the authored text")
		}
		if *parsed.SourcesContent[0] != authoredText {
			return errors.New("sourcesContent does not match the supplied authored text")
		}
	}
	if parsed.Mappings == nil {
		return errors.New("mappings is required")
	}
	return nil
}

// mappingPoint is one decoded segment of an authored→lowered source map:
// a lowered (generated side) position and its optional authored origin.
// Columns are UTF-16 code units.
type mappingPoint struct {
	generatedLine      int
	generatedCharacter int
	hasSource          bool
	sourceLine         int
	sourceCharacter    int
}

// decodeSuppliedMappings decodes and bounds-checks a mappings string against
// the lowered (generated side) and authored (source side) texts.
func decodeSuppliedMappings(mappings string, nameCount int, authoredLines *lineIndex, loweredLines *lineIndex) ([]mappingPoint, error) {
	points, err := decodeVLQMappings(mappings, nameCount)
	if err != nil {
		return nil, err
	}
	for _, point := range points {
		if point.generatedLine >= loweredLines.lineCount() {
			return nil, fmt.Errorf("mapping targets lowered line %d beyond the lowered text", point.generatedLine)
		}
		if point.generatedCharacter > loweredLines.utf16Length(point.generatedLine) {
			return nil, fmt.Errorf("mapping targets lowered column %d beyond lowered line %d", point.generatedCharacter, point.generatedLine)
		}
		if !point.hasSource {
			continue
		}
		if point.sourceLine >= authoredLines.lineCount() {
			return nil, fmt.Errorf("mapping targets authored line %d beyond the authored text", point.sourceLine)
		}
		if point.sourceCharacter > authoredLines.utf16Length(point.sourceLine) {
			return nil, fmt.Errorf("mapping targets authored column %d beyond authored line %d", point.sourceCharacter, point.sourceLine)
		}
	}
	return points, nil
}

// decodeVLQMappings decodes a version-3 "mappings" string. Every segment with
// source fields must use source index 0 and any name index must be in range.
func decodeVLQMappings(mappings string, nameCount int) ([]mappingPoint, error) {
	var points []mappingPoint
	generatedLine := 0
	generatedCharacter := 0
	sourceIndex := 0
	sourceLine := 0
	sourceCharacter := 0
	nameIndex := 0
	position := 0
	for position < len(mappings) {
		switch mappings[position] {
		case ';':
			generatedLine++
			generatedCharacter = 0
			position++
			continue
		case ',':
			position++
			continue
		}
		fields := make([]int, 0, 5)
		for position < len(mappings) && mappings[position] != ';' && mappings[position] != ',' {
			value, next, err := decodeVLQ(mappings, position)
			if err != nil {
				return nil, err
			}
			fields = append(fields, value)
			position = next
			if len(fields) > 5 {
				return nil, errors.New("mappings segment has more than five fields")
			}
		}
		if len(fields) != 1 && len(fields) != 4 && len(fields) != 5 {
			return nil, fmt.Errorf("mappings segment has %d fields; expected 1, 4, or 5", len(fields))
		}
		generatedCharacter += fields[0]
		if generatedCharacter < 0 {
			return nil, errors.New("mappings generated column is negative")
		}
		point := mappingPoint{generatedLine: generatedLine, generatedCharacter: generatedCharacter}
		if len(fields) >= 4 {
			sourceIndex += fields[1]
			sourceLine += fields[2]
			sourceCharacter += fields[3]
			if sourceIndex != 0 {
				return nil, fmt.Errorf("mappings source index %d does not name the authored file", sourceIndex)
			}
			if sourceLine < 0 || sourceCharacter < 0 {
				return nil, errors.New("mappings authored position is negative")
			}
			point.hasSource = true
			point.sourceLine = sourceLine
			point.sourceCharacter = sourceCharacter
			if len(fields) == 5 {
				nameIndex += fields[4]
				if nameIndex < 0 || nameIndex >= nameCount {
					return nil, fmt.Errorf("mappings name index %d is out of range", nameIndex)
				}
			}
		}
		points = append(points, point)
	}
	return points, nil
}

const vlqBase64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

func decodeVLQ(text string, position int) (value int, next int, err error) {
	shift := 0
	accumulated := 0
	for {
		if position >= len(text) {
			return 0, 0, errors.New("mappings VLQ value is truncated")
		}
		digit := strings.IndexByte(vlqBase64Alphabet, text[position])
		if digit < 0 {
			return 0, 0, fmt.Errorf("mappings contain invalid VLQ character %q", string(text[position]))
		}
		position++
		accumulated |= (digit & 31) << shift
		if digit&32 == 0 {
			break
		}
		shift += 5
		if shift > 30 {
			return 0, 0, errors.New("mappings VLQ value overflows")
		}
	}
	value = accumulated >> 1
	if accumulated&1 != 0 {
		value = -value
	}
	return value, position, nil
}

// lineIndex converts between byte offsets and (line, UTF-16 column) positions
// of one immutable text. Lines split on '\n'; a '\r' before it belongs to the
// preceding line's content.
type lineIndex struct {
	text   string
	starts []int
}

func newLineIndex(text string) *lineIndex {
	starts := []int{0}
	for offset := 0; offset < len(text); offset++ {
		if text[offset] == '\n' {
			starts = append(starts, offset+1)
		}
	}
	return &lineIndex{text: text, starts: starts}
}

func (index *lineIndex) lineCount() int { return len(index.starts) }

func (index *lineIndex) lineText(line int) string {
	if line < 0 || line >= len(index.starts) {
		return ""
	}
	start := index.starts[line]
	end := len(index.text)
	if line+1 < len(index.starts) {
		end = index.starts[line+1] - 1
	}
	return index.text[start:end]
}

func (index *lineIndex) utf16Length(line int) int {
	return utf16Extent(index.lineText(line))
}

// position converts a byte offset into (line, UTF-16 column).
func (index *lineIndex) position(byteOffset int) (line int, utf16Column int) {
	if byteOffset < 0 {
		byteOffset = 0
	}
	if byteOffset > len(index.text) {
		byteOffset = len(index.text)
	}
	low, high := 0, len(index.starts)-1
	for low < high {
		middle := (low + high + 1) / 2
		if index.starts[middle] <= byteOffset {
			low = middle
		} else {
			high = middle - 1
		}
	}
	return low, utf16Extent(index.text[index.starts[low]:byteOffset])
}

// byteOffset converts (line, UTF-16 column) into a byte offset, clamped to the
// line's content.
func (index *lineIndex) byteOffset(line int, utf16Column int) int {
	if line < 0 {
		return 0
	}
	if line >= len(index.starts) {
		return len(index.text)
	}
	lineText := index.lineText(line)
	consumed := 0
	for byteAt, character := range lineText {
		if consumed >= utf16Column {
			return index.starts[line] + byteAt
		}
		consumed += utf16RuneLen(character)
	}
	return index.starts[line] + len(lineText)
}

func utf16Extent(text string) int {
	length := 0
	for _, character := range text {
		length += utf16RuneLen(character)
	}
	return length
}

func utf16RuneLen(character rune) int {
	if character > 0xFFFF {
		return 2
	}
	return 1
}
