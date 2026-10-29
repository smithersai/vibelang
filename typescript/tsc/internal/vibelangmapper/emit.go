package vibelangmapper

import (
	"context"
	"encoding/json"
	"path"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/locale"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"github.com/microsoft/TypeScript/tsc/internal/transpile"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// CodeExecSyntax marks text of the executable rendering that TypeScript
// cannot parse, usually VibeLang syntax the projector does not lower yet.
const CodeExecSyntax = 9002

// Emit returns the JavaScript of the .vibe file whose text is text, in
// context ctx: the executable rendering of the file's lowering plan, with
// its types erased by TypeScript's own single-file transpiler. sourceMap is
// a source map (version 3, JSON) from the JavaScript to text, built from the
// plan's segments: verbatim text maps to its original position, and
// synthesized text to the position of the edit that wrote it. Like Project,
// Emit is a pure function of text and ctx and never fails: diagnostics
// holds the projector's own and any text of the rendering that does not
// parse (CodeExecSyntax), in original coordinates.
//
// Relative imports of .vibe modules name the JavaScript they compile to
// (./users.js), and of .ts modules likewise, as tsc's
// rewriteRelativeImportExtensions does; the output is ES2022 with ES
// modules, the target of every case.
func Emit(text string, ctx FileContext) (js string, sourceMap string, diagnostics []Diagnostic) {
	executable := Executable(text, ctx)
	exec, segments := executable.Text, executable.Segments
	diagnostics = executable.Diagnostics
	if exec == "" && len(text) > 0 {
		return "", "", diagnostics
	}
	stem := strings.TrimSuffix(path.Base(ctx.FileName), ".vibe")
	if stem == "" || stem == "." || stem == "/" {
		stem = "module"
	}
	output := transpile.TranspileModule(context.Background(), exec, transpile.Options{
		CompilerOptions: &core.CompilerOptions{
			Target:                          core.ScriptTargetES2022,
			Module:                          core.ModuleKindESNext,
			SourceMap:                       core.TSTrue,
			RewriteRelativeImportExtensions: core.TSTrue,
		},
		FileName:          "/" + stem + ".ts",
		ReportDiagnostics: true,
	})
	if output == nil {
		return "", "", diagnostics
	}
	toOriginal := func(pos int) int { return originalPosition(segments, pos) }
	for _, d := range output.Diagnostics {
		start := toOriginal(d.Pos())
		diagnostics = append(diagnostics, Diagnostic{
			Start:   start,
			Length:  max(0, toOriginal(d.End())-start),
			Code:    CodeExecSyntax,
			Message: "The executable rendering does not parse here (TS" + strconv.Itoa(int(d.Code())) + ": " + d.Localize(locale.Default) + ").",
		})
	}
	js = output.OutputText
	if at := strings.LastIndex(js, "//# sourceMappingURL="); at >= 0 {
		js = strings.TrimRight(js[:at], "\n") + "\n"
	}
	sourceMap = composeSourceMap(output.SourceMapText, exec, segments, text, ctx.FileName, stem+".js")
	return js, sourceMap, diagnostics
}

// Executable returns the executable rendering of the .vibe file whose
// text is text, in context ctx, as TypeScript whose types Emit erases: the
// JavaScript before type erasure, with its segments back to text. A host
// that already compiles TypeScript, such as the fork's emit inside its own
// program, takes this text instead of Emit's, which spends most of its time
// on a single-file program of its own. Text is "" when the lowered plan's
// edits overlap, a projector bug, which a diagnostic reports.
func Executable(text string, ctx FileContext) Projection {
	p := lower(text, ctx)
	text = p.text // without the try keywords lower blanks
	lowered := p.execPlan()
	r := newExecRendering(p.names)
	exec, segments, overlap, ok := lowered.render(r, text, r.prefix)
	diagnostics := slices.Clone(p.diagnostics)
	if !ok {
		diagnostics = append(diagnostics, Diagnostic{
			Start:   overlap,
			Code:    CodeUnprojectedForm,
			Message: "The executable rendering produced invalid or overlapping edits here; the file emits no JavaScript.",
		})
		return Projection{Diagnostics: diagnostics}
	}
	return Projection{Text: exec, Segments: withoutTries(segments, p.tries), Diagnostics: diagnostics}
}

// originalPosition maps pos, a position in a rendering, to the original
// text: through the verbatim segment that holds it, or, in synthesized text,
// to where the edit that wrote it starts, the end of the segment before it.
func originalPosition(segments []spanmap.Segment, pos int) int {
	i := sort.Search(len(segments), func(i int) bool { return int(segments[i].VirtualEnd) > pos })
	if i < len(segments) && int(segments[i].VirtualStart) <= pos {
		s := segments[i]
		return int(s.OriginalStart) + pos - int(s.VirtualStart)
	}
	if i > 0 {
		return int(segments[i-1].OriginalEnd)
	}
	return 0
}

// composeSourceMap returns a source map from the JavaScript to the original
// text: each mapping of tsMap, the transpiler's map from the JavaScript to
// the rendering exec, moved to the original through segments.
func composeSourceMap(tsMap string, exec string, segments []spanmap.Segment, original string, fileName string, jsName string) string {
	var raw sourcemap.RawSourceMap
	if json.Unmarshal([]byte(tsMap), &raw) != nil {
		return ""
	}
	source := fileName
	if source == "" {
		source = "/module.vibe"
	}
	dir := tspath.RootedDirectoryPathFromNormalized(path.Dir(source))
	generator := sourcemap.NewGenerator(jsName, "", dir, tspath.CaseSensitive)
	index := generator.AddSource(tspath.RootedFilePathFromAbsolute(source))
	_ = generator.SetSourceContent(index, original)
	execLines := core.ComputeECMALineStarts(exec)
	originalLines := core.ComputeECMALineStarts(original)
	for mapping := range sourcemap.DecodeMappings(raw.Mappings).Values() {
		if !mapping.IsSourceMapping() {
			_ = generator.AddGeneratedMapping(mapping.GeneratedLine, mapping.GeneratedCharacter)
			continue
		}
		pos := scanner.ComputePositionOfLineAndUTF16Character(execLines, mapping.SourceLine, mapping.SourceCharacter, exec, true /*allowEdits*/)
		at := min(max(originalPosition(segments, pos), 0), len(original))
		line := sort.Search(len(originalLines), func(i int) bool { return int(originalLines[i]) > at }) - 1
		line = max(line, 0)
		character := core.UTF16Len(original[originalLines[line]:at])
		_ = generator.AddSourceMapping(mapping.GeneratedLine, mapping.GeneratedCharacter, index, line, character)
	}
	return generator.String()
}
