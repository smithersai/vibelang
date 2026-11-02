package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
)

// cyclicCoverageRule is the sentence of D36 (amended 2026-10-24, coverage)
// that FuzzCyclicPlainCoverage checks a plain function that calls itself
// against.
const cyclicCoverageRule = "code the compiler makes, which no source code stands for, maps to no source position, so V8 coverage (`@vitest/coverage-v8`, `c8`, `NODE_V8_COVERAGE`) counts the code its author wrote"

// TestCyclicPlainCoverageQuoted checks that the decision log still says what
// FuzzCyclicPlainCoverage quotes.
func TestCyclicPlainCoverageQuoted(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(Root(), "docs/design/history/DECISIONS.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), cyclicCoverageRule) {
		t.Fatalf("docs/design/history/DECISIONS.md no longer says, in D36: %q", cyclicCoverageRule)
	}
}

// A plain function that calls itself. Before VIP-1 it compiled to an Effect
// entry, a plain entry, a stack body and a budgeted body (D10), and Smithers
// testing's RecordingModel `strings` counted an untaken statement and two ??
// branches at the function's head, so its package missed a 100% coverage
// threshold once the module was .vibe. The shapes keep that neighbourhood
// covered whatever a plain function lowers to.
var cyclicForms = []struct{ key, head, tail string }{
	{"const", "const strings = (%s): Array<string> => {\n", "}\n"},
	{"function", "function strings(%s): Array<string> {\n", "}\n"},
}

var cyclicParams = []struct{ key, text, initializer string }{
	{"simple", "value: unknown, out: Array<string>", ""},
	{"default", "value: unknown, out: Array<string> = []", "[]"},
}

var cyclicBodies = []struct{ key, text string }{
	{"if", "  if (typeof value === \"string\") {\n    out.push(value)\n  } else if (Array.isArray(value) && value.length > 0) {\n    strings(value[0], out)\n  }\n  return out\n"},
	{"for", "  if (typeof value === \"string\") {\n    out.push(value)\n  } else if (typeof value === \"object\" && value !== null) {\n    for (const [key, item] of Object.entries(value)) {\n      out.push(key)\n      strings(item, out)\n    }\n  }\n  return out\n"},
	{"try", "  try {\n    if (Array.isArray(value)) strings(value[0], out)\n  } finally {\n    out.push(\"x\")\n  }\n  return out\n"},
}

// FuzzCyclicPlainCoverage compiles each shape of a plain function that calls
// itself and reads main.js.map as coverage tools read it once Vite composes
// it: composing drops a segment with no source that starts a line or follows
// another (D36), and a position reads the segment at or before it on its
// line, or the one after it when that one maps to no source
// (ast-v8-to-istanbul). The source function is one function, so the
// functions the output declares read at most one position inside it; its
// head, after the start of the statement that declares it and up to its
// body's brace, holds no statement and, outside a parameter's initializer, no
// branch, so no statement or logical operand reads a position there.
//
// The input is a key, <form>-<params>-<body>; other bytes pick a shape by
// their first three bytes.
func FuzzCyclicPlainCoverage(f *testing.F) {
	startShortBudget(f)
	for _, form := range cyclicForms {
		for _, params := range cyclicParams {
			for _, body := range cyclicBodies {
				f.Add([]byte(form.key + "-" + params.key + "-" + body.key))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		fi, pi, bi := 0, 0, 0
		for i, b := range data {
			switch i {
			case 0:
				fi = int(b) % len(cyclicForms)
			case 1:
				pi = int(b) % len(cyclicParams)
			case 2:
				bi = int(b) % len(cyclicBodies)
			}
		}
		for a, form := range cyclicForms {
			for b, params := range cyclicParams {
				for c, body := range cyclicBodies {
					if string(data) == form.key+"-"+params.key+"-"+body.key {
						fi, pi, bi = a, b, c
					}
				}
			}
		}
		form, params, body := cyclicForms[fi], cyclicParams[pi], cyclicBodies[bi]
		key := form.key + "-" + params.key + "-" + body.key
		head := strings.Replace(form.head, "%s", params.text, 1)
		source := "// shape " + key + "\n" + head + body.text + form.tail + "\nexport const collect = (value: unknown): Array<string> => strings(value, [])\n"
		start := strings.Index(source, head)
		brace := start + len(head) - 2
		end := start + len(head) + len(body.text) + len(form.tail)
		var initializer [2]int
		if params.initializer != "" {
			at := start + strings.Index(head, params.initializer)
			initializer = [2]int{at, at + len(params.initializer)}
		}
		config := strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": [\"main.vibe\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		js, ok := r.Outputs["out/main.js"]
		mapText, mapped := r.Outputs["out/main.js.map"]
		if !ok || !mapped {
			t.Fatalf("%s: no out/main.js or its map: %v", key, slices.Sorted(func(yield func(string) bool) {
				for name := range r.Outputs {
					if !yield(name) {
						return
					}
				}
			}))
		}
		var m SourceMap
		if err := json.Unmarshal([]byte(mapText), &m); err != nil {
			t.Fatal(err)
		}
		read := composedReader(m)
		sourceStarts := lineStarts(source)
		offsetOf := func(line, column int) int { return sourceStarts[line] + column }
		jsStarts := lineStarts(js)
		at := func(offset int) (int, bool) {
			line := 0
			for line+1 < len(jsStarts) && jsStarts[line+1] <= offset {
				line++
			}
			sourceLine, sourceColumn, ok := read(line, offset-jsStarts[line])
			if !ok {
				return 0, false
			}
			return offsetOf(sourceLine, sourceColumn), true
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/out/main.js", PathKey: "/out/main.js"}, js, core.ScriptKindJS)
		functions := map[int]bool{}
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			nodeStart := scanner.SkipTrivia(js, n.Pos())
			switch {
			case ast.IsFunctionLike(n) && n.Body() != nil:
				declStart := nodeStart
				if name := n.Name(); name != nil {
					declStart = scanner.SkipTrivia(js, name.Pos())
				}
				if offset, ok := at(declStart); ok && offset >= start && offset < end {
					functions[offset] = true
				}
			case ast.IsBinaryExpression(n) && isLogicalOperator(n.AsBinaryExpression().OperatorToken.Kind):
				for _, operand := range []*ast.Node{n.AsBinaryExpression().Left, n.AsBinaryExpression().Right} {
					offset, ok := at(scanner.SkipTrivia(js, operand.Pos()))
					if ok && offset >= start && offset < brace && !(offset >= initializer[0] && offset < initializer[1]) {
						Gap(t, "FuzzCyclicPlainCoverage", key+"/branch", "D36: %s; an operand of %q reads %q, the head of:\n%s\noutput:\n%s", cyclicCoverageRule, js[scanner.SkipTrivia(js, n.Pos()):n.End()], source[offset:min(offset+20, len(source))], source, js)
						return true
					}
				}
			case ast.IsStatement(n) && !ast.IsBlock(n) && !ast.IsFunctionDeclaration(n):
				// The statement that declares the function starts at start.
				if offset, ok := at(nodeStart); ok && offset > start && offset < brace {
					Gap(t, "FuzzCyclicPlainCoverage", key+"/statement", "D36: %s; the statement %q reads %q, the head of:\n%s\noutput:\n%s", cyclicCoverageRule, js[nodeStart:min(n.End(), nodeStart+80)], source[offset:min(offset+20, len(source))], source, js)
					return true
				}
			}
			return n.ForEachChild(visit)
		}
		if file.AsNode().ForEachChild(visit) {
			return
		}
		if len(functions) > 1 {
			Gap(t, "FuzzCyclicPlainCoverage", key+"/functions", "D36: %s; the output declares %d functions inside the one source function:\n%s\noutput:\n%s", cyclicCoverageRule, len(functions), source, js)
			return
		}
		ExpectPending(t, "FuzzCyclicPlainCoverage", key)
	})
}

func isLogicalOperator(kind ast.Kind) bool {
	return kind == ast.KindAmpersandAmpersandToken || kind == ast.KindBarBarToken || kind == ast.KindQuestionQuestionToken
}

// lineStarts returns the offset at which each line of text starts.
func lineStarts(text string) []int {
	starts := []int{0}
	for i := 0; i < len(text); i++ {
		if text[i] == '\n' {
			starts = append(starts, i+1)
		}
	}
	return starts
}

// composedReader returns a function that reads a generated position of m as
// coverage tools read it after Vite composes the map (FuzzCyclicPlainCoverage).
func composedReader(m SourceMap) func(line, column int) (int, int, bool) {
	type segment struct {
		column, sourceLine, sourceColumn int
		sourced                          bool
	}
	lines := map[int][]segment{}
	for mapping := range sourcemap.DecodeMappings(m.Mappings).Values() {
		line := mapping.GeneratedLine
		s := segment{column: int(mapping.GeneratedCharacter), sourced: mapping.IsSourceMapping()}
		if s.sourced {
			s.sourceLine, s.sourceColumn = int(mapping.SourceLine), int(mapping.SourceCharacter)
		}
		kept := lines[line]
		if !s.sourced && (len(kept) == 0 || !kept[len(kept)-1].sourced) {
			continue
		}
		lines[line] = append(kept, s)
	}
	return func(line, column int) (int, int, bool) {
		segments := lines[line]
		below := -1
		for i, s := range segments {
			if s.column <= column {
				below = i
			}
		}
		if below >= 0 && segments[below].sourced {
			return segments[below].sourceLine, segments[below].sourceColumn, true
		}
		for _, s := range segments {
			if s.column >= column {
				return s.sourceLine, s.sourceColumn, s.sourced
			}
		}
		return 0, 0, false
	}
}
