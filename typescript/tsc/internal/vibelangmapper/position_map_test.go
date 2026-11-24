package vibelangmapper

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"gotest.tools/v3/assert"
)

// spot names one occurrence of token: the first one inside the first
// occurrence of context. A context that repeats a token elsewhere in the
// text is how these tests tell the right copy from a wrong one.
type spot struct{ context, token string }

// find returns spot's offset in text at or after from, or fails.
func (s spot) find(t *testing.T, text string, from int, what string) int {
	t.Helper()
	at := strings.Index(text[from:], s.context)
	assert.Assert(t, at >= 0, "%s context %q not in %q", what, s.context, text[from:])
	inner := strings.Index(s.context, s.token)
	assert.Assert(t, inner >= 0, "%s token %q not in its context %q", what, s.token, s.context)
	return from + at + inner
}

// positionAnchor says where a virtual token reports in the source: the
// original token, at the given fidelity. Validate only checks that a
// verbatim segment's text equals its original text, so a lowering that
// maps an operand onto another copy of the same word still passes it; an
// anchor fails.
type positionAnchor struct {
	virtual, original spot
	fidelity          spanmap.Fidelity
}

// positionMapCases are the lowered forms (#596): each anchor maps a token
// the lowering moved, or the synthesized text around it, back to source.
var positionMapCases = []struct {
	name    string
	source  string
	anchors []positionAnchor
}{
	{
		name:   "try operand",
		source: "declare const e: Effect.Effect<number>\neffect function f() {\n  const v = try e\n  return v\n}\n",
		anchors: []positionAnchor{
			{spot{"$try(e)", "e"}, spot{"try e", "e"}, spanmap.FidelityExact},
			{spot{"return v", "v"}, spot{"return v", "v"}, spanmap.FidelityExact},
			// The synthesized wrapper reports on the whole written try.
			{spot{"(yield* $run($try(e)))", "(yield* $run($try(e)))"}, spot{"try e", "try e"}, spanmap.FidelityApproximate},
		},
	},
	{
		name:   "catch operand and handler",
		source: "effect function f() { return a() catch (err) => recover(err) }",
		anchors: []positionAnchor{
			{spot{"$catch(a()", "a()"}, spot{"a() catch", "a()"}, spanmap.FidelityExact},
			{spot{"((err) => recover(err))", "recover(err)"}, spot{"=> recover(err)", "recover(err)"}, spanmap.FidelityExact},
			{spot{"(err) =>", "err"}, spot{"(err) =>", "err"}, spanmap.FidelityExact},
			{spot{"$catch(a(), ($catchError => Effect.succeed(((err) => recover(err))($catchError))))", "$catch(a(), ($catchError => Effect.succeed(((err) => recover(err))($catchError))))"},
				spot{"a() catch (err) => recover(err)", "a() catch (err) => recover(err)"}, spanmap.FidelityApproximate},
		},
	},
	{
		name:   "match subject, bindings, and arms",
		source: "effect function g(o: Option.Option<number>) {\n  return match (o) {\n    when Option.Some(let v): v;\n    when Option.None: 0;\n  }\n}\n",
		anchors: []positionAnchor{
			{spot{" o;", "o"}, spot{"match (o)", "o"}, spanmap.FidelityExact},
			{spot{"let v =", "v"}, spot{"let v)", "v"}, spanmap.FidelityExact},
			{spot{"return v;", "v"}, spot{": v;", "v"}, spanmap.FidelityExact},
			{spot{"return 0", "0"}, spot{"None: 0", "0"}, spanmap.FidelityExact},
		},
	},
	{
		name:   "for concurrent limit, iterable, binding, and body",
		source: "effect function f(xs: number[]) { for concurrent(2) (const x of xs) try log(x) }",
		anchors: []positionAnchor{
			{spot{"$concurrency = 2", "2"}, spot{"concurrent(2)", "2"}, spanmap.FidelityExact},
			{spot{"forEach(xs", "xs"}, spot{"of xs", "xs"}, spanmap.FidelityExact},
			{spot{"const x = $concurrentItem", "x"}, spot{"const x", "x"}, spanmap.FidelityExact},
			{spot{"$try(log(x))", "log(x)"}, spot{"try log(x)", "log(x)"}, spanmap.FidelityExact},
		},
	},
	{
		name:   "fork keyword and operand",
		source: "effect function f() { const fiber = fork work(); return fiber }",
		anchors: []positionAnchor{
			{spot{"$scoped(fork)", "fork"}, spot{"fork work", "fork"}, spanmap.FidelityExact},
			{spot{"(work())", "work()"}, spot{"fork work()", "work()"}, spanmap.FidelityExact},
			{spot{"return fiber", "fiber"}, spot{"return fiber", "fiber"}, spanmap.FidelityExact},
		},
	},
	{
		name:   "error name and fields",
		source: "export error Timeout {\n  ms: number\n}\n",
		anchors: []positionAnchor{
			{spot{"class Timeout", "Timeout"}, spot{"error Timeout", "Timeout"}, spanmap.FidelityExact},
			{spot{"readonly ms: number", "ms: number"}, spot{"ms: number", "ms: number"}, spanmap.FidelityExact},
		},
	},
	{
		name:   "service member channel",
		source: "export service Counter {\n  read(): number!!\n}\n",
		anchors: []positionAnchor{
			{spot{"interface Counter", "Counter"}, spot{"service Counter", "Counter"}, spanmap.FidelityExact},
			{spot{"read(): Effect.Effect<number", "number"}, spot{"number!!", "number"}, spanmap.FidelityExact},
		},
	},
}

// TestPositionMapAnchors maps each anchor's virtual token to source and
// checks the exact original range, not only that the map is valid (#596).
func TestPositionMapAnchors(t *testing.T) {
	t.Parallel()
	for _, c := range positionMapCases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			projection := Project(c.source, testContext)
			assert.Equal(t, len(projection.Diagnostics), 0, "diagnostics: %v", projection.Diagnostics)
			assertValidMap(t, projection, c.source)
			m := spanmap.New(projection.Segments)
			body := strings.Index(projection.Text, "\n") + 1
			for _, a := range c.anchors {
				virtual := a.virtual.find(t, projection.Text, body, "virtual")
				original := a.original.find(t, c.source, 0, "original")
				got, fidelity := m.VirtualToOriginalSpan(core.NewTextRange(virtual, virtual+len(a.virtual.token)))
				want := core.NewTextRange(original, original+len(a.original.token))
				assert.Equal(t, got, want, "%q maps to %q at [%d,%d), want %q at [%d,%d)",
					a.virtual.token, c.source[got.Pos():got.End()], got.Pos(), got.End(), a.original.token, want.Pos(), want.End())
				assert.Equal(t, fidelity, a.fidelity, "fidelity of %q", a.virtual.token)
			}
		})
	}
}

// TestAnchorsCatchWhatValidateMisses moves the try operand's segment onto
// the other e of the file. Validate accepts the map, since the text still
// matches; the anchor rejects it. This is the hole #596 names.
func TestAnchorsCatchWhatValidateMisses(t *testing.T) {
	t.Parallel()
	c := positionMapCases[0]
	projection := Project(c.source, testContext)
	virtual := spot{"$try(e)", "e"}.find(t, projection.Text, 0, "virtual")
	wrong := spot{"const e:", "e"}.find(t, c.source, 0, "original")
	moved := false
	for i, s := range projection.Segments {
		if int(s.VirtualStart) <= virtual && virtual < int(s.VirtualEnd) {
			assert.Equal(t, s.VirtualEnd-s.VirtualStart, core.TextPos(1), "the operand is its own segment")
			projection.Segments[i].OriginalStart, projection.Segments[i].OriginalEnd = core.TextPos(wrong), core.TextPos(wrong+1)
			moved = true
		}
	}
	assert.Assert(t, moved)
	problem := spanmap.New(projection.Segments).Validate(projection.Text, c.source)
	assert.Assert(t, problem == nil, "Validate rejected the moved map: %v", problem)
	got, _ := spanmap.New(projection.Segments).VirtualToOriginalSpan(core.NewTextRange(virtual, virtual+1))
	want := spot{"try e", "e"}.find(t, c.source, 0, "original")
	assert.Assert(t, got.Pos() != want, "the anchor must tell the two copies of e apart")
}

// TestEmitSourceMapAnchors decodes Emit's source map and checks that the
// JavaScript of a lowered try, catch, and match points at the source token
// it came from (#596).
func TestEmitSourceMapAnchors(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name, source string
		anchors      []struct{ generated, original spot }
	}{
		{
			name:   "try operand",
			source: "declare const e: Effect.Effect<number>\neffect function f() {\n  const v = try e\n  return v\n}\n",
			anchors: []struct{ generated, original spot }{
				{spot{"$try(e)", "e"}, spot{"try e", "e"}},
				{spot{"return v", "v"}, spot{"return v", "v"}},
			},
		},
		{
			name:   "catch operand and handler",
			source: "effect function f() { return a() catch (err) => recover(err) }",
			anchors: []struct{ generated, original spot }{
				{spot{"$catch(a()", "a()"}, spot{"a() catch", "a"}},
				{spot{"recover(err)", "recover"}, spot{"=> recover(err)", "recover"}},
			},
		},
		{
			name:   "match subject and arm",
			source: "effect function g(o: Option.Option<number>) {\n  return match (o) {\n    when Option.Some(let v): v;\n    when Option.None: 0;\n  }\n}\n",
			anchors: []struct{ generated, original spot }{
				{spot{"let v =", "v"}, spot{"let v)", "v"}},
				{spot{"return 0", "0"}, spot{"None: 0", "0"}},
			},
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			js, sourceMap, diagnostics := Emit(c.source, testContext)
			assert.Equal(t, len(diagnostics), 0, "diagnostics: %v", diagnostics)
			var raw sourcemap.RawSourceMap
			assert.NilError(t, json.Unmarshal([]byte(sourceMap), &raw))
			jsLines := core.ComputeECMALineStarts(js)
			sourceLines := core.ComputeECMALineStarts(c.source)
			lineOf := func(starts []core.TextPos, at int) (int, int) {
				line := 0
				for line+1 < len(starts) && int(starts[line+1]) <= at {
					line++
				}
				return line, at - int(starts[line])
			}
			for _, a := range c.anchors {
				line, column := lineOf(jsLines, a.generated.find(t, js, 0, "generated"))
				wantLine, wantColumn := lineOf(sourceLines, a.original.find(t, c.source, 0, "original"))
				found := false
				for m := range sourcemap.DecodeMappings(raw.Mappings).Values() {
					if m.GeneratedLine == line && int(m.GeneratedCharacter) == column {
						found = true
						assert.Equal(t, [2]int{m.SourceLine, int(m.SourceCharacter)}, [2]int{wantLine, wantColumn},
							"%q at %d:%d in %s", a.generated.token, line, column, js)
					}
				}
				assert.Assert(t, found, "no mapping for %q at %d:%d in %s", a.generated.token, line, column, js)
			}
		})
	}
}
