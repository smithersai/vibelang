package compiler

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func newPinnedTestBackend(t *testing.T) (Compiler, context.Context) {
	t.Helper()
	checkout := os.Getenv("SMITHERS_TYPESCRIPT_FORK")
	if checkout == "" {
		t.Skip("set SMITHERS_TYPESCRIPT_FORK to the exact pinned checkout to run the executable fork test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	t.Cleanup(cancel)
	backend, err := NewPinnedFork(ctx, ForkConfig{CheckoutDirectory: checkout, CacheDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	return backend, ctx
}

func artifactTextsByPath(t *testing.T, artifacts []Artifact) map[string]string {
	t.Helper()
	texts := make(map[string]string, len(artifacts))
	for _, item := range artifacts {
		if _, exists := texts[item.Path]; exists {
			t.Fatalf("duplicate artifact path %q", item.Path)
		}
		texts[item.Path] = string(item.Content)
	}
	return texts
}

type decodedSourceMap struct {
	Sources        []string  `json:"sources"`
	SourcesContent []*string `json:"sourcesContent"`
	Names          []string  `json:"names"`
	Mappings       string    `json:"mappings"`
	Version        int       `json:"version"`
	File           string    `json:"file"`
	SourceRoot     string    `json:"sourceRoot"`
}

func decodeEmittedMap(t *testing.T, text string) (decodedSourceMap, []mappingPoint) {
	t.Helper()
	var parsed decodedSourceMap
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		t.Fatalf("invalid emitted source map: %v (%q)", err, text)
	}
	points, err := decodeVLQMappings(parsed.Mappings, len(parsed.Names))
	if err != nil {
		t.Fatalf("invalid emitted mappings: %v (%q)", err, parsed.Mappings)
	}
	return parsed, points
}

// positionOf returns the (line, UTF-16 column) of a needle's first occurrence.
func positionOf(t *testing.T, text string, needle string) (int, int) {
	t.Helper()
	offset := strings.Index(text, needle)
	if offset < 0 {
		t.Fatalf("%q not found in %q", needle, text)
	}
	line, column := newLineIndex(text).position(offset)
	return line, column
}

func TestPinnedForkIdentityMultiFileProjects(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	mainText := "import { seven } from \"./lib/util.sm\"\nimport { base } from \"./shared\"\nexport const answer: number = seven + base;\n"
	utilText := "export const seven: number = 7;\n"
	sharedText := "export const base: number = 1;\n"
	good, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"app/main.sm", "app/lib/util.sm", "app/shared.ts"},
		Files: []SourceFile{
			{Path: "app/main.sm", Kind: FileKindSmithers, Text: mainText},
			{Path: "app/lib/util.sm", Kind: FileKindSmithers, Text: utilText},
			{Path: "app/shared.ts", Kind: FileKindTypeScript, Text: sharedText},
		},
		Options:  Options{"declaration": true},
		Lowering: LoweringIdentity,
	})
	if err != nil {
		t.Fatal(err)
	}
	if good.EmitSkipped || len(good.Diagnostics) != 0 {
		t.Fatalf("unexpected result: %#v", good)
	}
	texts := artifactTextsByPath(t, good.Artifacts)
	for _, expected := range []string{
		"app/main.js", "app/main.js.map", "app/main.d.sm.ts",
		"app/lib/util.js", "app/lib/util.js.map", "app/lib/util.d.sm.ts",
		"app/shared.js", "app/shared.js.map", "app/shared.d.ts",
	} {
		if _, ok := texts[expected]; !ok {
			t.Fatalf("missing artifact %q in %v", expected, artifactPaths(good.Artifacts))
		}
	}
	if len(good.Artifacts) != 9 {
		t.Fatalf("unexpected artifact count: %v", artifactPaths(good.Artifacts))
	}
	mainJS := texts["app/main.js"]
	if !strings.Contains(mainJS, "from \"./lib/util.js\"") {
		t.Fatalf("runtime .sm import was not rewritten: %q", mainJS)
	}
	if !strings.Contains(mainJS, "from \"./shared\"") {
		t.Fatalf("plain import must stay untouched: %q", mainJS)
	}
	if !strings.Contains(mainJS, "//# sourceMappingURL=main.js.map") {
		t.Fatalf("missing source map URL: %q", mainJS)
	}
	if !strings.Contains(texts["app/main.d.sm.ts"], "answer") {
		t.Fatalf("missing declaration output: %q", texts["app/main.d.sm.ts"])
	}

	mainMap, mainPoints := decodeEmittedMap(t, texts["app/main.js.map"])
	if len(mainMap.Sources) != 1 || mainMap.Sources[0] != "../../src/app/main.sm" {
		t.Fatalf("main map sources = %#v", mainMap.Sources)
	}
	if len(mainMap.SourcesContent) != 1 || mainMap.SourcesContent[0] == nil || *mainMap.SourcesContent[0] != mainText {
		t.Fatalf("main map content = %#v", mainMap.SourcesContent)
	}
	if mainMap.File != "main.js" {
		t.Fatalf("main map file = %q", mainMap.File)
	}
	// The rewritten import line is two columns shorter; every mapping after the
	// specifier must still land inside the emitted line.
	jsLines := newLineIndex(mainJS)
	for _, point := range mainPoints {
		if point.generatedLine >= jsLines.lineCount() || point.generatedCharacter > jsLines.utf16Length(point.generatedLine) {
			t.Fatalf("composed mapping outside emitted text: %#v", point)
		}
	}
	// Identity lowering must keep exact authored positions: `seven + base` on
	// the emitted line maps to its authored line and column.
	jsLine, jsColumn := positionOf(t, mainJS, "seven + base")
	authoredLine, authoredColumn := positionOf(t, mainText, "seven + base")
	if !hasMapping(mainPoints, jsLine, jsColumn, authoredLine, authoredColumn) {
		t.Fatalf("missing identity mapping (%d,%d)→(%d,%d) in %#v", jsLine, jsColumn, authoredLine, authoredColumn, mainPoints)
	}

	sharedMap, _ := decodeEmittedMap(t, texts["app/shared.js.map"])
	if len(sharedMap.Sources) != 1 || sharedMap.Sources[0] != "../../src/app/shared.ts" {
		t.Fatalf("shared map sources = %#v", sharedMap.Sources)
	}

	broken, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm", "util.sm"},
		Files: []SourceFile{
			{Path: "main.sm", Kind: FileKindSmithers, Text: "import { seven } from \"./util.sm\"\nexport const answer: number = seven;\n"},
			{Path: "util.sm", Kind: FileKindSmithers, Text: "export const seven: number = \"7\";\n"},
		},
		Lowering: LoweringIdentity,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !broken.EmitSkipped || len(broken.Artifacts) != 0 {
		t.Fatalf("type errors must suppress emit: %#v", broken)
	}
	found := false
	for _, item := range broken.Diagnostics {
		if item.Code == "TS2322" && item.File == "util.sm" && item.Span != nil && item.Span.Start == strings.Index("export const seven: number = \"7\";\n", "seven") && item.Span.Length == len("seven") {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing attributed TS2322 in util.sm: %#v", broken.Diagnostics)
	}
}

func TestPinnedForkExternalLoweringComposesAuthoredMaps(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	mainAuthored := "import { seven } from \"./util.sm\"\n" +
		"export action main(): number { return seven() * 2 }\n" +
		"export { seven } from \"./util.sm\"\n"
	mainLowered := "import { seven } from \"./util.sm\"\n" +
		"export function main(): number { return seven() * 2 }\n" +
		"const __smithers_runtime = 1;\n" +
		"export { seven } from \"./util.sm\"\n"
	mainMappings := encodeTestMappings([][]testSegment{
		{{genCol: 0, srcLine: 0, srcCol: 0}},
		{{genCol: 0, srcLine: 1, srcCol: 0}, {genCol: 16, srcLine: 1, srcCol: 14}},
		{{genCol: 0, generatedOnly: true}},
		{{genCol: 0, srcLine: 2, srcCol: 0}},
	})
	utilAuthored := "export action seven(): number { return 7 }\n"
	utilLowered := "export function seven(): number { return 7 }\n"
	utilMappings := encodeTestMappings([][]testSegment{
		{{genCol: 0, srcLine: 0, srcCol: 0}, {genCol: 16, srcLine: 0, srcCol: 14}},
	})

	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm", "util.sm"},
		Files: []SourceFile{
			{
				Path: "main.sm",
				Kind: FileKindSmithers,
				Text: mainAuthored,
				Lowered: &LoweredSource{
					Text:      mainLowered,
					SourceMap: `{"version":3,"sources":["main.sm"],"names":[],"mappings":"` + mainMappings + `"}`,
				},
			},
			{
				Path: "util.sm",
				Kind: FileKindSmithers,
				Text: utilAuthored,
				Lowered: &LoweredSource{
					Text:      utilLowered,
					SourceMap: `{"version":3,"sources":["util.sm"],"names":[],"mappings":"` + utilMappings + `"}`,
				},
			},
		},
		Options:  Options{"declaration": true},
		Lowering: LoweringExternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("unexpected result: %#v", result)
	}
	texts := artifactTextsByPath(t, result.Artifacts)
	for _, expected := range []string{
		"main.js", "main.js.map", "main.d.sm.ts",
		"util.js", "util.js.map", "util.d.sm.ts",
	} {
		if _, ok := texts[expected]; !ok {
			t.Fatalf("missing artifact %q in %v", expected, artifactPaths(result.Artifacts))
		}
	}

	mainJS := texts["main.js"]
	if !strings.Contains(mainJS, "function main()") || !strings.Contains(mainJS, "const __smithers_runtime = 1;") {
		t.Fatalf("lowered TypeScript was not emitted: %q", mainJS)
	}
	if strings.Contains(mainJS, ".sm\"") || !strings.Contains(mainJS, "from \"./util.js\"") {
		t.Fatalf("runtime .sm import was not rewritten: %q", mainJS)
	}
	if !strings.Contains(mainJS, "//# sourceMappingURL=main.js.map") {
		t.Fatalf("missing source map URL: %q", mainJS)
	}
	// Declarations keep the authored `.sm` specifier and the mapped name so a
	// TypeScript consumer resolves them with allowArbitraryExtensions.
	mainDTS := texts["main.d.sm.ts"]
	if !strings.Contains(mainDTS, "declare function main(): number") || !strings.Contains(mainDTS, "from \"./util.sm\"") {
		t.Fatalf("unexpected declaration output: %q", mainDTS)
	}

	mainMap, mainPoints := decodeEmittedMap(t, texts["main.js.map"])
	if len(mainMap.Sources) != 1 || mainMap.Sources[0] != "../src/main.sm" {
		t.Fatalf("composed sources = %#v", mainMap.Sources)
	}
	if len(mainMap.SourcesContent) != 1 || mainMap.SourcesContent[0] == nil || *mainMap.SourcesContent[0] != mainAuthored {
		t.Fatalf("composed sourcesContent must be the authored text: %#v", mainMap.SourcesContent)
	}

	jsLines := newLineIndex(mainJS)
	for _, point := range mainPoints {
		if point.generatedLine >= jsLines.lineCount() || point.generatedCharacter > jsLines.utf16Length(point.generatedLine) {
			t.Fatalf("composed mapping outside emitted text: %#v", point)
		}
	}

	// True non-identity composition: `main` sits at different columns in the
	// emitted JavaScript (behind `function`) and the authored text (behind
	// `action`); the composed map must connect exactly those positions.
	jsLine, jsColumn := positionOf(t, mainJS, "main() {")
	authoredLine, authoredColumn := positionOf(t, mainAuthored, "main(): number")
	if jsColumn == authoredColumn {
		t.Fatalf("test sample must shift columns, got %d for both", jsColumn)
	}
	if !hasMapping(mainPoints, jsLine, jsColumn, authoredLine, authoredColumn) {
		t.Fatalf("missing composed mapping (%d,%d)→(%d,%d) in %#v", jsLine, jsColumn, authoredLine, authoredColumn, mainPoints)
	}

	// The helper statement exists only in the lowered text: every mapping on
	// its emitted line must stay unmapped.
	helperLine, _ := positionOf(t, mainJS, "__smithers_runtime")
	sawHelperMapping := false
	for _, point := range mainPoints {
		if point.generatedLine != helperLine {
			continue
		}
		sawHelperMapping = true
		if point.hasSource {
			t.Fatalf("unmapped lowered span gained a source mapping: %#v", point)
		}
	}
	if !sawHelperMapping {
		t.Fatalf("expected generated-only mappings on the helper line in %#v", mainPoints)
	}

	utilMap, utilPoints := decodeEmittedMap(t, texts["util.js.map"])
	if len(utilMap.Sources) != 1 || utilMap.Sources[0] != "../src/util.sm" {
		t.Fatalf("composed util sources = %#v", utilMap.Sources)
	}
	utilJS := texts["util.js"]
	jsLine, jsColumn = positionOf(t, utilJS, "seven()")
	authoredLine, authoredColumn = positionOf(t, utilAuthored, "seven()")
	if !hasMapping(utilPoints, jsLine, jsColumn, authoredLine, authoredColumn) {
		t.Fatalf("missing composed mapping (%d,%d)→(%d,%d) in %#v", jsLine, jsColumn, authoredLine, authoredColumn, utilPoints)
	}
}

func TestPinnedForkExternalLoweringMapsDiagnosticsToAuthoredPositions(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	authored := "action f(): number { return 42 } export const wrong: number = \"oops\"\n"
	lowered := "function f(): number { return 42 } export const wrong: number = \"oops\"\n"
	mappings := encodeTestMappings([][]testSegment{
		{{genCol: 0, srcLine: 0, srcCol: 0}, {genCol: 8, srcLine: 0, srcCol: 6}},
	})
	if strings.Index(lowered, "wrong") == strings.Index(authored, "wrong") {
		t.Fatal("test sample must place the diagnostic behind a non-identity shift")
	}
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"broken.sm"},
		Files: []SourceFile{{
			Path: "broken.sm",
			Kind: FileKindSmithers,
			Text: authored,
			Lowered: &LoweredSource{
				Text:      lowered,
				SourceMap: `{"version":3,"sources":["broken.sm"],"names":[],"mappings":"` + mappings + `"}`,
			},
		}},
		Lowering: LoweringExternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("type errors must suppress emit: %#v", result)
	}
	found := false
	for _, item := range result.Diagnostics {
		if item.Code == "TS2322" && item.File == "broken.sm" && item.Phase == PhaseCheck &&
			item.Span != nil && item.Span.Start == strings.Index(authored, "wrong") && item.Span.Length == len("wrong") {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing authored-position TS2322: %#v (want start %d)", result.Diagnostics, strings.Index(authored, "wrong"))
	}
}

func hasMapping(points []mappingPoint, generatedLine int, generatedColumn int, sourceLine int, sourceColumn int) bool {
	for _, point := range points {
		if point.hasSource && point.generatedLine == generatedLine && point.generatedCharacter == generatedColumn &&
			point.sourceLine == sourceLine && point.sourceCharacter == sourceColumn {
			return true
		}
	}
	return false
}

func artifactPaths(artifacts []Artifact) []string {
	paths := make([]string, 0, len(artifacts))
	for _, item := range artifacts {
		paths = append(paths, item.Path)
	}
	return paths
}
