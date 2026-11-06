package vibelangfuzz

import (
	"encoding/json"
	"maps"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

// sourceMapVariant rewrites a program's text without changing what it means
// to a map: the contract's positions are the same statements on other lines
// and columns, so each exercises one way to count them wrongly.
type sourceMapVariant struct {
	key   string
	apply func(string) string
}

func prefixLines(prefix string) func(string) string {
	return func(text string) string {
		lines := strings.SplitAfter(text, "\n")
		for i, line := range lines {
			if strings.TrimSpace(line) == "" || strings.HasPrefix(line, "#!") {
				continue
			}
			indent := len(line) - len(strings.TrimLeft(line, " \t"))
			lines[i] = line[:indent] + prefix + line[indent:]
		}
		return strings.Join(lines, "")
	}
}

var sourceMapVariants = []sourceMapVariant{
	{"plain", func(text string) string { return text }},
	{"crlf", func(text string) string {
		return strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\n", "\r\n")
	}},
	{"bom", func(text string) string { return "\uFEFF" + text }},
	// Each comment reaches the emitted line, so a byte or code point count
	// misplaces every later token on both sides of the map.
	{"astral", prefixLines("/*\U0001F600\U0001D49C*/ ")},
	{"line-separator", prefixLines("/*\u2028*/ ")},
	{"paragraph-separator", prefixLines("/*\u2029*/ ")},
}

// sourceMapRules are the sentences of docs/maintainers/source-maps.md that the
// oracle below applies, quoted as rule 1 of the fuzz suite asks.
var sourceMapRules = []string{
	"A line ends at ECMA-262's LineTerminatorSequence: LF, CR, CRLF, U+2028 or U+2029. A column counts UTF-16 code units.",
	"Every segment stands inside its generated file and names a position inside its source.",
	"Segments are sorted by generated position.",
	"With `inlineSources`, `sourcesContent` holds the text the compiler read, without a BOM.",
	"An identifier or literal emit keeps reads back as itself: the last segment at or before its first column, on its line, names the same token in the source.",
	"An import the compiler adds has no segments.",
}

func TestSourceMapRulesCited(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(Root(), "docs/maintainers/source-maps.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, rule := range sourceMapRules {
		if !strings.Contains(string(data), rule) {
			t.Errorf("docs/maintainers/source-maps.md no longer says: %s", rule)
		}
	}
}

func sourceMapVariantOf(key string) (sourceMapVariant, bool) {
	i := slices.IndexFunc(sourceMapVariants, func(v sourceMapVariant) bool { return v.key == key })
	if i < 0 {
		return sourceMapVariant{}, false
	}
	return sourceMapVariants[i], true
}

// withSourceMaps asks a project for every map the contract covers. An option
// the configuration sets itself comes later and wins.
func withSourceMaps(project Project) Project {
	config := project.Config
	if config == "" {
		var names []string
		for name := range project.Files {
			if isSource(name) {
				names = append(names, name)
			}
		}
		slices.Sort(names)
		listed, _ := json.Marshal(names)
		config = strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": " + string(listed) + "\n}"
	}
	if loc := compilerOptionsOpen.FindStringIndex(config); loc != nil {
		config = config[:loc[1]] + `"sourceMap": true, "inlineSources": true, ` + config[loc[1]:]
	}
	project.Config = config
	return project
}

// FuzzSourceMapTokens reads both ends of the source maps of real programs:
// the acceptance cases, the documentation's snippets and the generator's
// programs, in each text variant. Rules: docs/maintainers/source-maps.md.
func FuzzSourceMapTokens(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	if err := installVIPEvents(w); err != nil {
		f.Fatal(err)
	}
	for _, seed := range sourceMapSeeds() {
		f.Add(seed.archive, seed.variant)
	}
	f.Cleanup(func() {
		f.Logf("read %d maps, %d source tokens, %d checked at both ends", sourceMapTotals.maps.Load(), sourceMapTotals.sourceTokens.Load(), sourceMapTotals.checked.Load())
	})
	f.Fuzz(func(t *testing.T, archive, variant string) {
		t.Parallel() // the seed corpus only; fuzzing ignores it
		checkSourceMapTokens(t, w, archive, variant)
	})
}

type sourceMapSeed struct{ archive, variant string }

func sourceMapSeeds() []sourceMapSeed {
	var programs []string
	for _, c := range vipgen.Constructs() {
		if p := vipgen.Probe(c.Key); p != nil {
			files := maps.Clone(p.Files)
			if files == nil {
				files = map[string]string{}
			}
			files["main.vibe"] = vipgen.PrintVibe(p)
			archive := Archive(files)
			seedNames.Store(archive, "construct "+c.Key)
			programs = append(programs, archive)
		}
	}
	for _, seed := range shortWitnessSeeds(CaseSeeds(), sourceMapShortSeeds) {
		archive := Archive(seed.Files)
		seedNames.Store(archive, "case "+seed.Name)
		programs = append(programs, archive)
	}
	for _, seed := range shortWitnessSeeds(SnippetSeeds(), sourceMapShortSeeds) {
		archive := Archive(seed.Files)
		seedNames.Store(archive, "snippet "+seed.Name)
		programs = append(programs, archive)
	}
	if testing.Short() {
		programs = sampleStrings(programs, sourceMapShortPrograms)
	}
	var seeds []sourceMapSeed
	for i, archive := range programs {
		if testing.Short() {
			seeds = append(seeds, sourceMapSeed{archive, sourceMapVariants[i%len(sourceMapVariants)].key})
			continue
		}
		for _, variant := range sourceMapVariants {
			seeds = append(seeds, sourceMapSeed{archive, variant.key})
		}
	}
	return seeds
}

const (
	sourceMapShortSeeds    = 12
	sourceMapShortPrograms = 36
)

// sampleStrings takes n evenly spaced elements, so a run stays reproducible
// when entries are added elsewhere in the list.
func sampleStrings(from []string, n int) []string {
	if len(from) <= n {
		return from
	}
	sampled := make([]string, 0, n)
	for i := range n {
		sampled = append(sampled, from[i*len(from)/n])
	}
	return sampled
}

func checkSourceMapTokens(t *testing.T, w *Workspace, archive, variantKey string) {
	variant, ok := sourceMapVariantOf(variantKey)
	if !ok {
		t.Skip("no such variant")
	}
	project := ProjectFromArchive(archive)
	if reason := Admissible(project); reason != "" {
		t.Skip(reason)
	}
	files := maps.Clone(project.Files)
	for name, text := range files {
		if strings.HasSuffix(name, ".vibe") || strings.HasSuffix(name, ".vibex") {
			files[name] = variant.apply(text)
		}
	}
	project.Files = files
	project = withSourceMaps(project)
	g := &Gaps{Target: "FuzzSourceMapTokens", Input: SeedName(archive) + " (" + variantKey + ")"}
	key := ""
	if name := corpusFile(t, "FuzzSourceMapTokens"); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/FuzzSourceMapTokens/" + name
	}
	defer recoverCompilerPanic(t, "FuzzSourceMapTokens")
	var c *Compilation
	var err error
	within(t, "compile", func() { c, err = w.CompileOrdered(t.Context(), project, OrderTsc, true) })
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	if c.Program == nil || HasError(withoutEffectLint(c.Diagnostics)) {
		g.FinishInput(t, key)
		return
	}
	for _, name := range mapKeys(c.Outputs) {
		generatedName, isMap := strings.CutSuffix(name, ".map")
		from := c.From[name]
		if from == nil {
			from = c.From[generatedName]
		}
		if !isMap || !isJS(generatedName) || !fromVibe(from) || from.EmbeddedModule() != nil {
			continue
		}
		vibe := relName(c.Dir, from)
		source, ok := c.Sources[vibe]
		if !ok {
			continue
		}
		text := strings.TrimPrefix(source, "\uFEFF")
		stats := checkMappedTokens(g, generatedName, c.Outputs[generatedName], c.Outputs[name], vibe, text)
		sourceMapTotals.maps.Add(1)
		sourceMapTotals.sourceTokens.Add(int64(stats.sourceTokens))
		sourceMapTotals.checked.Add(int64(stats.checked))
	}
	g.FinishInput(t, key)
}

// sourceMapTotals says how much of the seeds the oracle read, so a change that
// leaves it reading nothing shows in the log.
var sourceMapTotals struct{ maps, sourceTokens, checked atomic.Int64 }

// mapText is one end of a source map. Its arithmetic is its own, independent
// of the compiler's, so a wrong line table or column count cannot agree with
// itself: a line ends at ECMA-262's LineTerminatorSequence and a column
// counts UTF-16 code units.
type mapText struct {
	text   string
	starts []int
}

func newMapText(text string) *mapText {
	m := &mapText{text: text, starts: []int{0}}
	for i := 0; i < len(text); {
		r, size := utf8.DecodeRuneInString(text[i:])
		next := i + size
		switch r {
		case '\r':
			if next < len(text) && text[next] == '\n' {
				next++
			}
			m.starts = append(m.starts, next)
		case '\n', '\u2028', '\u2029':
			m.starts = append(m.starts, next)
		}
		i = next
	}
	return m
}

// offset returns the byte offset of a line and UTF-16 column, or false when
// the position is outside the line.
func (m *mapText) offset(line, column int) (int, bool) {
	if line < 0 || line >= len(m.starts) || column < 0 {
		return 0, false
	}
	at := m.starts[line]
	end := len(m.text)
	if line+1 < len(m.starts) {
		end = m.starts[line+1]
	}
	for units := 0; ; {
		if units == column {
			return at, true
		}
		if units > column || at >= end {
			return 0, false // past the line, or inside a surrogate pair
		}
		r, size := utf8.DecodeRuneInString(m.text[at:])
		if r == '\r' || r == '\n' || r == '\u2028' || r == '\u2029' {
			return 0, false
		}
		at += size
		units++
		if r >= 0x10000 {
			units++
		}
	}
}

// mapToken is an identifier or a literal, one of the tokens that keep their
// meaning through emit: its text is its decoded value, so 'a' and "a" agree.
type mapToken struct {
	start int
	text  string
}

func tokenText(n *ast.Node) (string, bool) {
	switch {
	case ast.IsIdentifier(n), n.Kind == ast.KindPrivateIdentifier:
		return "name " + n.Text(), true
	case n.Kind == ast.KindStringLiteral, n.Kind == ast.KindNoSubstitutionTemplateLiteral:
		return "string " + n.Text(), true
	case n.Kind == ast.KindNumericLiteral, n.Kind == ast.KindBigIntLiteral:
		return "number " + n.Text(), true
	}
	return "", false
}

// writtenTokens lists the tokens file's text spells. A parser companion node
// has a span too, so a node counts only when one token fills it.
func writtenTokens(file *ast.SourceFile, text string, skip func(*ast.Node) bool) []mapToken {
	var tokens []mapToken
	seen := map[int]bool{}
	var visit ast.Visitor
	visit = func(n *ast.Node) bool {
		if skip(n) {
			return false
		}
		if value, ok := tokenText(n); ok && n.Pos() >= 0 && n.End() <= len(text) {
			start := scanner.GetTokenPosOfNode(n, file, false)
			if start < n.End() && !seen[start] {
				s := scanner.NewScanner()
				s.SetText(text[start:n.End()])
				kind := s.Scan()
				// A parser companion can span a written token of another kind
				// or value: $catchExpression on catch, the string "<" on a
				// relational pattern's operator.
				sameKind := kind == n.Kind || ast.IsIdentifier(n) && kind >= ast.KindIdentifier && kind <= ast.KindLastKeyword
				if sameKind && s.TokenValue() == n.Text() && s.TokenEnd() == n.End()-start {
					seen[start] = true
					tokens = append(tokens, mapToken{start, value})
				}
			}
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	for _, supplemental := range file.SupplementalSourceFiles() {
		supplemental.AsNode().ForEachChild(visit)
	}
	return tokens
}

// erasedByEmit reports what the Tokens rule cannot read: nodes emit drops, an
// overload signature among them, and an enum, whose members TypeScript's own
// lowering writes as tsc does.
func erasedByEmit(n *ast.Node) bool {
	return ast.IsTypeNode(n) || n.Kind == ast.KindTypeParameter || ast.IsInterfaceDeclaration(n) || ast.IsTypeAliasDeclaration(n) ||
		ast.IsFunctionLikeDeclaration(n) && n.Body() == nil || ast.IsEnumDeclaration(n)
}

func sourceTokens(name, text string) []mapToken {
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/source/" + path.Base(name)), PathKey: tspath.PathKey("/source/" + path.Base(name)), VibeLangDoAsFunction: true}, text)
	return writtenTokens(file, text, erasedByEmit)
}

// generatedTokens leaves out the imports the compiler adds, which map to no
// source position. A name in one, sync in `import { sync } from "effect/Effect"`,
// is not the name a program wrote, which the lowering may spell another way.
func generatedTokens(name, text string, mapped func(int) bool) []mapToken {
	kind := core.ScriptKindJS
	if strings.HasSuffix(name, ".jsx") {
		kind = core.ScriptKindJSX
	}
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/emitted/" + name), PathKey: tspath.PathKey("/emitted/" + name)}, text, kind)
	return writtenTokens(file, text, func(n *ast.Node) bool {
		return ast.IsImportDeclaration(n) && !mapped(scanner.GetTokenPosOfNode(n, file, false))
	})
}

// loweredSpelling ends the text before a token the lowering wrote, however
// the program spells it, under the Sugar and Generated code rules: a member of
// a library or of a binding the lowering made (Schema.Array for a written
// ReadonlyArray, Duration.between for a data method, receiver_1.not,
// $match1.length, the .value of a captured loop binding's cell), the name
// of a function a lowering split off, a jump a block's completion dispatches,
// the record a provide block completes with, and an entry's import.meta.url.
var loweredSpelling = regexp.MustCompile(`(?:\b[A-Z]\w*\.|\bruntime\.|[\w$]_\d+\.|\$\w+\.|\$tdz\)\.|function\* |\b(?:break|continue) |kind: "\w+", |import\.meta\.)$`)

// sourceMapFile is the part of a version 3 map the contract reads.
type sourceMapFile struct {
	Version        int       `json:"version"`
	File           string    `json:"file"`
	Sources        []string  `json:"sources"`
	SourcesContent []*string `json:"sourcesContent"`
	Names          []string  `json:"names"`
	Mappings       string    `json:"mappings"`
}

type sourceMapStats struct{ sourceTokens, generatedTokens, checked int }

// checkMappedTokens applies the contract's rules to one map. The Tokens rule
// reads a token at both ends when each text spells it once, so a match is the
// same token and never a coincidence of counts, and it applies to ES module
// output: TypeScript's own CommonJS transform rewrites imports and exports
// after the lowering, which `exports.x` and `require` spell anew.
func checkMappedTokens(g *Gaps, name, generated, mapJSON, vibe, source string) sourceMapStats {
	var stats sourceMapStats
	var m sourceMapFile
	if err := json.Unmarshal([]byte(mapJSON), &m); err != nil || m.Version != 3 {
		g.Add("feature:source-map", "%s is not a version 3 source map (%v)", name, err)
		return stats
	}
	if m.File != path.Base(name) {
		g.Add("feature:source-map-file", "%s names its generated file %q", name, m.File)
	}
	if len(m.Sources) != 1 {
		g.Add("feature:source-map-sources", "%s names %d sources: %q", name, len(m.Sources), m.Sources)
		return stats
	}
	if len(m.SourcesContent) != 1 || m.SourcesContent[0] == nil || *m.SourcesContent[0] != source {
		g.Add("feature:source-map-content", "%s does not hold the text of %s", name, vibe)
	}
	end := newMapText(generated)
	start := newMapText(source)
	segments := map[int]sourcemap.Mapping{}
	var offsets []int // of segments, ascending
	last := [2]int{-1, -1}
	decoder := sourcemap.DecodeMappings(m.Mappings)
	for mapping := range decoder.Values() {
		line, column := mapping.GeneratedLine, int(mapping.GeneratedCharacter)
		if line < last[0] || line == last[0] && column < last[1] {
			g.Add("feature:source-map-order", "%s: segment %d:%d follows %d:%d", name, line, column, last[0], last[1])
			return stats
		}
		last = [2]int{line, column}
		at, ok := end.offset(line, column)
		if !ok {
			g.Add("feature:source-map-range:generated", "%s: segment at generated %d:%d is outside the file", name, line, column)
			return stats
		}
		if mapping.IsSourceMapping() {
			if _, ok := start.offset(mapping.SourceLine, int(mapping.SourceCharacter)); !ok {
				g.Add("feature:source-map-range:source", "%s: segment at generated %d:%d names source %d:%d, outside the text", name, line, column, mapping.SourceLine, mapping.SourceCharacter)
				return stats
			}
		}
		if _, ok := segments[at]; !ok {
			offsets = append(offsets, at)
		}
		segments[at] = *mapping
	}
	if err := decoder.Error(); err != nil {
		g.Add("feature:source-map", "%s's mappings do not decode: %v", name, err)
		return stats
	}
	if strings.Contains(generated, `Object.defineProperty(exports, "__esModule"`) {
		return stats
	}
	sources := sourceTokens(vibe, source)
	generatedList := generatedTokens(name, generated, func(at int) bool {
		segment, ok := segments[at]
		return ok && segment.IsSourceMapping()
	})
	stats.sourceTokens, stats.generatedTokens = len(sources), len(generatedList)
	count, countGenerated := map[string]int{}, map[string]int{}
	for _, token := range sources {
		count[token.text]++
	}
	for _, token := range generatedList {
		countGenerated[token.text]++
	}
	// A token each text spells once is the same token, unless the lowering
	// wrote the spelling. Text reads back as its value, so 'a' and "a" agree.
	lines := map[int]bool{}
	for _, segment := range segments {
		lines[segment.GeneratedLine] = true
	}
	for _, token := range generatedList {
		if count[token.text] != 1 || countGenerated[token.text] != 1 {
			continue
		}
		if loweredSpelling.MatchString(generated[max(0, token.start-24):token.start]) {
			continue
		}
		line, column := lineColumn(end, token.start)
		// A line with no segment is code no source stands for: Imports and
		// Generated code. FuzzCompile holds a preserved statement to a position.
		if !lines[line] {
			continue
		}
		stats.checked++
		// As a consumer reads a map: the last segment at or before the token
		// on its line. Effect_1.sync reads back as a written sync this way.
		index, found := slices.BinarySearch(offsets, token.start)
		if !found {
			index--
		}
		var segment sourcemap.Mapping
		ok := index >= 0
		if ok {
			segment = segments[offsets[index]]
			ok = segment.GeneratedLine == line && segment.IsSourceMapping()
		}
		if !ok {
			g.Add("feature:source-map-token:unmapped", "%s: %s at %d:%d has no source position", name, strconv.Quote(token.text), line, column)
			continue
		}
		at, _ := start.offset(segment.SourceLine, int(segment.SourceCharacter))
		if !readsAs(source, at, token.text) {
			g.Add("feature:source-map-token:moved", "%s: %s at %d:%d maps to source %d:%d, which reads %s", name, strconv.Quote(token.text), line, column, segment.SourceLine, segment.SourceCharacter, strconv.Quote(excerpt(source, at)))
		}
	}
	return stats
}

// readsAs reports whether text at offset is the token value, a mapToken's text.
func readsAs(text string, offset int, value string) bool {
	s := scanner.NewScanner()
	s.SetText(text[offset:])
	s.Scan()
	_, decoded, _ := strings.Cut(value, " ")
	return s.TokenStart() == 0 && s.TokenValue() == decoded
}

func lineColumn(m *mapText, offset int) (line, column int) {
	line, _ = slices.BinarySearch(m.starts, offset)
	if line == len(m.starts) || m.starts[line] != offset {
		line--
	}
	return line, UTF16Len(m.text[m.starts[line]:offset])
}

// TestSourceMapOracleFindsMovedTokens keeps the oracle honest: a program
// passes it, and moving one segment, or counting a column in bytes, fails it.
func TestSourceMapOracleFindsMovedTokens(t *testing.T) {
	source := "export const alpha = 1\nexport const beta = \"\U0001F600\"; export const gamma = 2\n"
	generated := source
	build := func(gammaColumn core.UTF16Offset) string {
		g := sourcemap.NewGenerator("main.js", "", "/", tspath.CaseSensitive)
		index := g.AddSource("/main.vibe")
		if err := g.SetSourceContent(index, source); err != nil {
			t.Fatal(err)
		}
		add := func(line int, column, sourceColumn core.UTF16Offset) {
			if err := g.AddSourceMapping(line, column, index, line, sourceColumn); err != nil {
				t.Fatal(err)
			}
		}
		add(0, 13, 13)
		add(0, 21, 21)
		add(1, 13, 13)
		add(1, 20, 20)
		add(1, 39, gammaColumn)
		add(1, 47, 47)
		return g.String()
	}
	check := func(gammaColumn core.UTF16Offset) *Gaps {
		g := &Gaps{Target: "FuzzSourceMapTokens"}
		stats := checkMappedTokens(g, "main.js", generated, build(gammaColumn), "main.vibe", source)
		if stats.checked == 0 {
			t.Fatal("the oracle checked no token")
		}
		return g
	}
	if g := check(39); g.Any() {
		t.Fatalf("a correct map failed: %+v", g.found)
	}
	// 41 is the byte column gamma would have with a two-unit emoji counted in
	// UTF-8 bytes, 38 the code point column; both read other text.
	for _, wrong := range []core.UTF16Offset{41, 38, 13} {
		if g := check(wrong); !g.Any() {
			t.Errorf("a segment at source column %d passed", wrong)
		}
	}
}
