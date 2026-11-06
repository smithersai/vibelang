package vibelangmapper

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
)

// FuzzEmitSourceMap holds Emit's map to the rules of
// docs/maintainers/source-maps.md that bind it: Shape, Content, Units, Range
// and Order. Its positions are counted here, not with the compiler's tables.
// It lives in this package because Emit's transpile must run without the
// VibeLang checker hooks, which a binary that links internal/vibelang
// registers for every program.
func FuzzEmitSourceMap(f *testing.F) {
	for _, seed := range emitSourceMapSeeds(f) {
		f.Add(seed)
		f.Add(strings.ReplaceAll(seed, "\n", "\r\n"))
		f.Add("/*\U0001F600\U0001D49C*/ " + seed)
		f.Add("/*\u2028*/\n" + seed)
	}
	f.Fuzz(func(t *testing.T, text string) {
		if !utf8.ValidString(text) {
			t.Skip("Emit reads text the compiler has decoded")
		}
		js, sourceMap, diagnostics := Emit(text, testContext)
		if sourceMap == "" || len(diagnostics) != 0 {
			t.Skip("no map to read")
		}
		var m struct {
			Version        int       `json:"version"`
			File           string    `json:"file"`
			Sources        []string  `json:"sources"`
			SourcesContent []*string `json:"sourcesContent"`
			Mappings       string    `json:"mappings"`
		}
		if err := json.Unmarshal([]byte(sourceMap), &m); err != nil || m.Version != 3 {
			t.Fatalf("Shape: not a version 3 map (%v): %.200s", err, sourceMap)
		}
		if len(m.Sources) != 1 || !strings.HasSuffix(m.File, ".js") {
			t.Fatalf("Shape: sources %q, file %q", m.Sources, m.File)
		}
		if len(m.SourcesContent) != 1 || m.SourcesContent[0] == nil || *m.SourcesContent[0] != text {
			t.Fatal("Content: the map does not hold the text")
		}
		generated, source := utf16LineLengths(js), utf16LineLengths(text)
		lastLine, lastColumn := -1, -1
		decoder := sourcemap.DecodeMappings(m.Mappings)
		for mapping := range decoder.Values() {
			line, column := mapping.GeneratedLine, int(mapping.GeneratedCharacter)
			if line < lastLine || line == lastLine && column < lastColumn {
				t.Fatalf("Order: segment %d:%d follows %d:%d", line, column, lastLine, lastColumn)
			}
			lastLine, lastColumn = line, column
			if line >= len(generated) || column > generated[line] {
				t.Fatalf("Range: segment at generated %d:%d is outside the file", line, column)
			}
			if mapping.IsSourceMapping() && (mapping.SourceLine >= len(source) || int(mapping.SourceCharacter) > source[mapping.SourceLine]) {
				t.Fatalf("Range: segment at generated %d:%d names source %d:%d, outside the text", line, column, mapping.SourceLine, mapping.SourceCharacter)
			}
		}
		if err := decoder.Error(); err != nil {
			t.Fatalf("Shape: the mappings do not decode: %v", err)
		}
	})
}

// emitSourceMapSeeds takes a spread of the acceptance cases. A map's rules do
// not depend on which case holds a form, so a sample covers them.
func emitSourceMapSeeds(tb testing.TB) []string {
	names, err := filepath.Glob(filepath.Join("..", "..", "..", "vibelang", "cases", "*", "main.vibe"))
	if err != nil {
		tb.Fatal(err)
	}
	slices.Sort(names)
	step := 16
	if testing.Short() {
		step = 64
	}
	var seeds []string
	for i := 0; i < len(names); i += step {
		data, err := os.ReadFile(names[i])
		if err != nil {
			tb.Fatal(err)
		}
		seeds = append(seeds, string(data))
	}
	if len(seeds) == 0 {
		tb.Fatal("no acceptance cases")
	}
	return seeds
}

// utf16LineLengths returns each line's length in UTF-16 code units, ending a
// line at ECMA-262's LineTerminatorSequence.
func utf16LineLengths(text string) []int {
	lengths := []int{0}
	for i := 0; i < len(text); {
		r, size := utf8.DecodeRuneInString(text[i:])
		i += size
		switch r {
		case '\r':
			if i < len(text) && text[i] == '\n' {
				i++
			}
			lengths = append(lengths, 0)
		case '\n', '\u2028', '\u2029':
			lengths = append(lengths, 0)
		default:
			lengths[len(lengths)-1]++
			if r >= 0x10000 {
				lengths[len(lengths)-1]++
			}
		}
	}
	return lengths
}
