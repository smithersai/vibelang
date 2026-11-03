package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// doProgramLabel names the rewrite in the --fix report: an effect block
// written around a do expression that built a program.
const doProgramLabel = "effect"

// doProgramEdits migrates a do expression at an Effect destination. Keep
// the do expression inside the new Effect: this preserves every TC39
// completion (including branches and switches) without guessing a tail.
func doProgramEdits(c *checker.Checker, file *ast.SourceFile) ([]sourceEdit, int) {
	text := file.Text()
	var edits []sourceEdit
	seen := map[int]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) || ast.IsCallExpression(node) {
			start := scanner.SkipTrivia(text, node.Pos())
			end := node.End()
			if start >= 0 && start+2 < len(text) && end <= len(text) && end > start+2 && text[start:start+2] == "do" && !seen[start] {
				open := scanner.SkipTrivia(text, start+2)
				if open < end && text[open:open+1] == "{" && isEffectType(c, c.GetContextualType(node, checker.ContextFlagsNone)) && !isEffectType(c, c.GetTypeAtLocation(node)) {
					seen[start] = true
					edits = append(edits, sourceEdit{start, start, "effect { return "}, sourceEdit{end, end, " }"})
					return false
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return edits, len(seen)
}

// mergeInsertions joins insertions at one offset into one edit, in the order
// they were made, so applyEdits sees no two edits at one place.
func mergeInsertions(edits []sourceEdit) []sourceEdit {
	var merged []sourceEdit
	at := map[int]int{}
	for _, e := range edits {
		if e.start == e.end {
			if i, ok := at[e.start]; ok {
				merged[i].text += e.text
				continue
			}
			at[e.start] = len(merged)
		}
		merged = append(merged, e)
	}
	slices.SortStableFunc(merged, func(x, y sourceEdit) int {
		if x.start != y.start {
			return x.start - y.start
		}
		return (x.end - x.start) - (y.end - y.start)
	})
	return merged
}

// rewriteDoPrograms writes effect { return do { … } } around each do
// expression that stood where a program was expected (VIP-2's old reading),
// where that adds no error to program's: in every file when they pass
// together, else in each file that passes on its own, as rewriteTries does.
// It records the rewrites in result and texts.
func rewriteDoPrograms(g *fixGate, fs vfs.FS, program *compiler.Program, texts map[tspath.RootedFilePath]string, result *FixResult) {
	rewrites := map[tspath.RootedFilePath][]sourceEdit{}
	counts := map[tspath.RootedFilePath]int{}
	for _, file := range g.scope.fixable(program) {
		program.GetSemanticDiagnostics(g.ctx, file)
		c, done := program.GetTypeCheckerForFile(g.ctx, file)
		edits, count := doProgramEdits(c, file)
		done()
		if len(edits) != 0 {
			rewrites[file.FileName()] = mergeInsertions(edits)
			counts[file.FileName()] = count
		}
	}
	if len(rewrites) == 0 {
		return
	}
	base := effectless(g.errorCounts(program))
	firstAdded := ""
	passes := func(overlay map[tspath.RootedFilePath]string) bool {
		var added []string
		for key, n := range effectless(g.errorCounts(g.build(maps(texts, overlay)))) {
			if n > base[key] {
				added = append(added, key)
			}
		}
		slices.Sort(added)
		if len(added) > 0 {
			firstAdded = added[0]
		}
		return len(added) == 0
	}
	candidates := map[tspath.RootedFilePath]string{}
	var names []tspath.RootedFilePath
	for name, edits := range rewrites {
		candidates[name] = applyEdits(program.GetSourceFile(name).Text(), edits)
		names = append(names, name)
	}
	slices.SortFunc(names, tspath.RootedFilePath.Compare)
	kept := map[tspath.RootedFilePath]string{}
	if passes(candidates) {
		kept = candidates
	} else {
		for _, name := range names {
			if g.done.Err() != nil {
				return
			}
			trial := maps(kept, map[tspath.RootedFilePath]string{name: candidates[name]})
			if passes(trial) {
				kept = trial
			} else {
				result.Refused = append(result.Refused, FixRefusal{File: name, Error: firstAdded})
			}
		}
	}
	for _, name := range names {
		text, ok := kept[name]
		if !ok {
			continue
		}
		fixed := result.Files[name]
		if fixed == nil {
			original, _ := fs.ReadFile(name)
			fixed = &FixedFile{Original: original, Counts: map[int32]int{}}
			result.Files[name] = fixed
			result.Order = append(result.Order, name)
		}
		if fixed.Rewrites == nil {
			fixed.Rewrites = map[string]int{}
		}
		fixed.Rewrites[doProgramLabel] += counts[name]
		fixed.Text = text
		texts[name] = text
	}
}

// effectless returns counts with try and effect removed from each error's
// key, so an error that quotes code the rewrite changed keeps its key.
func effectless(counts map[string]int) map[string]int {
	result := make(map[string]int, len(counts))
	for key, n := range counts {
		key = strings.ReplaceAll(key, "try ", "")
		key = strings.ReplaceAll(key, "effect ", "")
		result[key] += n
	}
	return result
}
