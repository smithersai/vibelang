package compiler

import (
	"strings"
	"testing"
)

// encodeVLQ writes one base64 VLQ value; tests use it to build version-3
// mappings without hand-computed strings.
func encodeVLQ(builder *strings.Builder, value int) {
	encoded := value << 1
	if value < 0 {
		encoded = (-value << 1) | 1
	}
	for {
		digit := encoded & 31
		encoded >>= 5
		if encoded > 0 {
			digit |= 32
		}
		builder.WriteByte(vlqBase64Alphabet[digit])
		if encoded == 0 {
			return
		}
	}
}

// testSegment is one segment of a test-built mappings string. Columns are
// UTF-16 code units; generatedOnly segments carry no source fields.
type testSegment struct {
	genCol        int
	srcLine       int
	srcCol        int
	generatedOnly bool
}

// encodeTestMappings encodes per-line segments into a version-3 mappings
// string with a single source (index 0) and no names.
func encodeTestMappings(lines [][]testSegment) string {
	var builder strings.Builder
	previousSrcLine := 0
	previousSrcCol := 0
	for lineNumber, segments := range lines {
		if lineNumber > 0 {
			builder.WriteByte(';')
		}
		previousGenCol := 0
		for index, segment := range segments {
			if index > 0 {
				builder.WriteByte(',')
			}
			encodeVLQ(&builder, segment.genCol-previousGenCol)
			previousGenCol = segment.genCol
			if segment.generatedOnly {
				continue
			}
			encodeVLQ(&builder, 0)
			encodeVLQ(&builder, segment.srcLine-previousSrcLine)
			previousSrcLine = segment.srcLine
			encodeVLQ(&builder, segment.srcCol-previousSrcCol)
			previousSrcCol = segment.srcCol
		}
	}
	return builder.String()
}

func TestEncodeTestMappingsRoundTripsThroughDecoder(t *testing.T) {
	mappings := encodeTestMappings([][]testSegment{
		{{genCol: 0, srcLine: 0, srcCol: 0}, {genCol: 8, srcLine: 0, srcCol: 6}},
		{{genCol: 0, srcLine: 1, srcCol: 0}},
		{{genCol: 4, generatedOnly: true}},
	})
	points, err := decodeVLQMappings(mappings, 0)
	if err != nil {
		t.Fatal(err)
	}
	expected := []mappingPoint{
		{generatedLine: 0, generatedCharacter: 0, hasSource: true, sourceLine: 0, sourceCharacter: 0},
		{generatedLine: 0, generatedCharacter: 8, hasSource: true, sourceLine: 0, sourceCharacter: 6},
		{generatedLine: 1, generatedCharacter: 0, hasSource: true, sourceLine: 1, sourceCharacter: 0},
		{generatedLine: 2, generatedCharacter: 4},
	}
	if len(points) != len(expected) {
		t.Fatalf("decoded %d points, want %d: %#v", len(points), len(expected), points)
	}
	for index, point := range points {
		if point != expected[index] {
			t.Fatalf("point %d = %#v, want %#v", index, point, expected[index])
		}
	}
}

func TestLineIndexPositionsRoundTrip(t *testing.T) {
	text := "first line\nsécond 😀 line\nlast"
	index := newLineIndex(text)
	if index.lineCount() != 3 {
		t.Fatalf("lineCount = %d", index.lineCount())
	}
	for _, offset := range []int{0, 5, 10, 11, len(text)} {
		line, column := index.position(offset)
		if back := index.byteOffset(line, column); back != offset {
			t.Fatalf("offset %d → (%d,%d) → %d", offset, line, column, back)
		}
	}
	emoji := strings.Index(text, "😀")
	line, column := index.position(emoji + len("😀"))
	if line != 1 {
		t.Fatalf("emoji end line = %d", line)
	}
	if before := utf16Extent("sécond "); column != before+2 {
		t.Fatalf("emoji occupies %d UTF-16 units, want 2 after %d", column-before, before)
	}
	if index.utf16Length(2) != len("last") {
		t.Fatalf("last line UTF-16 length = %d", index.utf16Length(2))
	}
}

func validExternalRequest() CompileRequest {
	authored := "action answer(): number { return 42 }\n"
	lowered := "function answer(): number { return 42 }\n"
	mappings := encodeTestMappings([][]testSegment{
		{{genCol: 0, srcLine: 0, srcCol: 0}, {genCol: 8, srcLine: 0, srcCol: 6}},
	})
	return CompileRequest{
		RootNames: []string{"main.sm"},
		Files: []SourceFile{{
			Path: "main.sm",
			Kind: FileKindSmithers,
			Text: authored,
			Lowered: &LoweredSource{
				Text:      lowered,
				SourceMap: `{"version":3,"sources":["main.sm"],"names":[],"mappings":"` + mappings + `"}`,
			},
		}},
		Lowering: LoweringExternal,
	}
}

func TestValidateLoweredRequestAcceptsWellFormedInput(t *testing.T) {
	if err := validateLoweredRequest(validExternalRequest()); err != nil {
		t.Fatal(err)
	}
	identity := CompileRequest{
		RootNames: []string{"main.sm"},
		Files:     []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: "export {};\n"}},
		Lowering:  LoweringIdentity,
	}
	if err := validateLoweredRequest(identity); err != nil {
		t.Fatal(err)
	}
	// Disk-hydrated identity requests carry no in-memory files.
	if err := validateLoweredRequest(CompileRequest{RootNames: []string{"main.sm"}, Lowering: LoweringIdentity}); err != nil {
		t.Fatal(err)
	}
}

func TestValidateLoweredRequestRejectsOmittedMode(t *testing.T) {
	err := validateLoweredRequest(CompileRequest{RootNames: []string{"main.sm"}})
	if err == nil || !strings.Contains(err.Error(), "lowering mode is required") {
		t.Fatalf("omitted lowering mode must fail closed, got %v", err)
	}
	if LoweringIdentity == "" {
		t.Fatal("identity lowering must be an explicit non-empty choice")
	}
}

func TestValidateLoweredRequestAcceptsContentAndGeneratedOnlySegments(t *testing.T) {
	request := validExternalRequest()
	authored := request.Files[0].Text
	request.Files[0].Lowered.Text = "function answer(): number { return 42 }\nconst helper = 1;\n"
	mappings := encodeTestMappings([][]testSegment{
		{{genCol: 0, srcLine: 0, srcCol: 0}, {genCol: 8, srcLine: 0, srcCol: 6}},
		{{genCol: 0, generatedOnly: true}},
	})
	request.Files[0].Lowered.SourceMap = `{"version":3,"file":"main.sm.ts","sources":["./main.sm"],"names":[],"mappings":"` + mappings +
		`","sourcesContent":[` + jsonString(authored) + `]}`
	if err := validateLoweredRequest(request); err != nil {
		t.Fatal(err)
	}
}

func TestValidateLoweredRequestRejectsMalformedInput(t *testing.T) {
	base := validExternalRequest()
	tests := []struct {
		name   string
		mutate func(*CompileRequest)
		detail string
	}{
		{
			name:   "unknown mode",
			mutate: func(r *CompileRequest) { r.Lowering = "partial" },
			detail: "unsupported lowering mode",
		},
		{
			name: "lowered content in identity mode",
			mutate: func(r *CompileRequest) {
				r.Lowering = LoweringIdentity
			},
			detail: "does not use \"external\" lowering",
		},
		{
			name: "external mode with disk roots",
			mutate: func(r *CompileRequest) {
				r.Files = nil
			},
			detail: "requires in-memory files",
		},
		{
			name: "smithers file without lowered content",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered = nil
			},
			detail: "requires lowered content",
		},
		{
			name: "typescript file with lowered content",
			mutate: func(r *CompileRequest) {
				r.Files = append(r.Files, SourceFile{
					Path:    "util.ts",
					Kind:    FileKindTypeScript,
					Text:    "export {};\n",
					Lowered: &LoweredSource{Text: "export {};\n", SourceMap: "{}"},
				})
			},
			detail: "must not carry lowered content",
		},
		{
			name:   "empty lowered text",
			mutate: func(r *CompileRequest) { r.Files[0].Lowered.Text = "" },
			detail: "is empty",
		},
		{
			name:   "unparseable map",
			mutate: func(r *CompileRequest) { r.Files[0].Lowered.SourceMap = "not json" },
			detail: "parse",
		},
		{
			name: "unknown map field",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm"],"mappings":"","ignoreList":[]}`
			},
			detail: "parse",
		},
		{
			name: "trailing JSON value",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm"],"mappings":""}{}`
			},
			detail: "one JSON value",
		},
		{
			name: "wrong version",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":2,"sources":["main.sm"],"mappings":""}`
			},
			detail: "version must be 3",
		},
		{
			name: "source root set",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":3,"sourceRoot":"/src","sources":["main.sm"],"mappings":""}`
			},
			detail: "sourceRoot must be empty",
		},
		{
			name: "sources name a different file",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["other.sm"],"mappings":""}`
			},
			detail: "must name the authored file",
		},
		{
			name: "sources with two entries",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm","main.sm"],"mappings":""}`
			},
			detail: "exactly the authored file",
		},
		{
			name: "sourcesContent mismatch",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm"],"sourcesContent":["different"],"mappings":""}`
			},
			detail: "does not match the supplied authored text",
		},
		{
			name: "missing mappings",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm"]}`
			},
			detail: "mappings is required",
		},
		{
			name: "invalid VLQ character",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm"],"mappings":"AA?A"}`
			},
			detail: "invalid VLQ character",
		},
		{
			name: "nonzero source index",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm"],"mappings":"ACAA"}`
			},
			detail: "does not name the authored file",
		},
		{
			name: "mapping beyond lowered text",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm"],"mappings":";;;AAAA"}`
			},
			detail: "beyond the lowered text",
		},
		{
			name: "mapping beyond lowered line",
			mutate: func(r *CompileRequest) {
				mappings := encodeTestMappings([][]testSegment{{{genCol: 400, srcLine: 0, srcCol: 0}}})
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm"],"mappings":"` + mappings + `"}`
			},
			detail: "beyond lowered line",
		},
		{
			name: "mapping beyond authored text",
			mutate: func(r *CompileRequest) {
				mappings := encodeTestMappings([][]testSegment{{{genCol: 0, srcLine: 9, srcCol: 0}}})
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm"],"mappings":"` + mappings + `"}`
			},
			detail: "beyond the authored text",
		},
		{
			name: "mapping beyond authored line",
			mutate: func(r *CompileRequest) {
				mappings := encodeTestMappings([][]testSegment{{{genCol: 0, srcLine: 0, srcCol: 300}}})
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm"],"mappings":"` + mappings + `"}`
			},
			detail: "beyond authored line",
		},
		{
			name: "name index out of range",
			mutate: func(r *CompileRequest) {
				r.Files[0].Lowered.SourceMap = `{"version":3,"sources":["main.sm"],"names":[],"mappings":"AAAAA"}`
			},
			detail: "name index",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := base
			request.Files = make([]SourceFile, len(base.Files))
			copy(request.Files, base.Files)
			for index := range request.Files {
				if base.Files[index].Lowered != nil {
					lowered := *base.Files[index].Lowered
					request.Files[index].Lowered = &lowered
				}
			}
			test.mutate(&request)
			err := validateLoweredRequest(request)
			if err == nil {
				t.Fatalf("expected rejection")
			}
			if !strings.Contains(err.Error(), test.detail) {
				t.Fatalf("error %q does not mention %q", err.Error(), test.detail)
			}
		})
	}
}

func jsonString(value string) string {
	var builder strings.Builder
	builder.WriteByte('"')
	for _, character := range value {
		switch character {
		case '"':
			builder.WriteString("\\\"")
		case '\\':
			builder.WriteString("\\\\")
		case '\n':
			builder.WriteString("\\n")
		default:
			builder.WriteRune(character)
		}
	}
	builder.WriteByte('"')
	return builder.String()
}
