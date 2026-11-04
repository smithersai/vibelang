package vibelang

import (
	"crypto/sha256"
	"fmt"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// Each pass of a --fix run offers the prelude rewrites again, and the gate
// checked again each one it had refused in an earlier pass, though nothing
// it read had changed. On a 10-module slice of Smithers' apps/mvp, a pass
// re-checked the same 14 refused rewrites in about 3 minutes, a fifth to a
// third of each run (fixperf2-smithers, 2026-11-03). So the gate keeps, for
// the run, each prelude rewrite it refused and what the refusal read, and
// refuses it again without a check (fixGate.stillRefused) while all of
// that is as it was:
//
//   - the rewrite's file and its rewritten text;
//   - the files the refusal read: the rewrite's file, the files that reported
//     the errors it added, the files the trial checked first, and every file
//     they import, in the texts of the trial that refused it (and, when that
//     trial checked only some files, in the round's own texts too, which
//     gateRound.orderErrors read);
//   - the baseline's errors, texts and type reads of those files but the
//     imported ones;
//   - the program's files. A file changed since is not one the refusal read,
//     and it declares no globals before or after (declaresGlobals).
//
// A parser error newly added in the exact proposed source is a smaller
// sufficient witness: its source and baseline alone decide it. Imported
// types and global declarations cannot repair that same syntax. Such a
// witness is reused without consulting semantic inputs below.
//
// That is the rule TypeScript's incremental builder reuses a file's
// diagnostics by: they depend on the file, the files it imports, and the
// files that declare globals. A refusal is never carried to another run.

// A preludeRefusal is a prelude rewrite the gate refused, and what the
// refusal read.
type preludeRefusal struct {
	base, text string // the file before and after the rewrite
	syntax     bool   // the exact proposed source alone adds a parser error
	reads      map[tspath.RootedFilePath]bool
	// tried holds the overlay texts of the trial that refused the
	// rewrite, and round the round's own when the trial checked only
	// some files.
	tried, round map[tspath.RootedFilePath]string
	// globals holds the files of the trial's program that declare
	// globals; files fingerprints its file names.
	globals  map[tspath.RootedFilePath]bool
	files    [32]byte
	counted  []tspath.RootedFilePath // the files whose baseline is fingerprinted
	baseline [32]byte
}

// A trialEvidence is what a trial that added errors read, kept until the
// next trial for the refusals it proves: its overlay texts, the files it
// checked first when it checked only some, the imports of its program's
// files, those that declare globals, and the fingerprint of their names.
type trialEvidence struct {
	texts   map[tspath.RootedFilePath]string
	syntax  map[tspath.RootedFilePath][]*ast.Diagnostic
	first   []tspath.RootedFilePath
	imports map[tspath.RootedFilePath][]tspath.RootedFilePath
	globals map[tspath.RootedFilePath]bool
	files   [32]byte
}

// evidenceOf returns what a trial of overlay texts in program read, first
// being the files it checked when it checked only some.
func evidenceOf(program *compiler.Program, texts map[tspath.RootedFilePath]string, first []tspath.RootedFilePath) *trialEvidence {
	e := &trialEvidence{syntax: map[tspath.RootedFilePath][]*ast.Diagnostic{}, texts: texts, first: slices.Clone(first), imports: map[tspath.RootedFilePath][]tspath.RootedFilePath{}, globals: map[tspath.RootedFilePath]bool{}, files: programFilesKey(program)}
	resolved := program.GetResolvedModules()
	for _, file := range program.SourceFiles() {
		name := file.FileName()
		for _, d := range file.Diagnostics() {
			// The denied trailing-block hook consults another program to
			// suppress separator recoveries. Do not use those as local proof.
			args := d.MessageArgs()
			if d.Source() == "" && d.Code() == 1005 && len(args) == 1 && (args[0] == ";" || args[0] == ",") {
				continue
			}
			e.syntax[name] = append(e.syntax[name], d)
		}
		var imports []tspath.RootedFilePath
		for _, m := range resolved[file.PathKey()] {
			if m != nil && m.IsResolved() {
				if target := program.GetSourceFileForResolvedModule(m); target != nil {
					imports = append(imports, target.FileName())
				}
			}
		}
		dir := tspath.GetDirectoryPath(name.AsString())
		for _, ref := range file.ReferencedFiles {
			if target := program.GetSourceFile(tspath.RootedFilePathFromAbsolute(tspath.ResolvePath(dir, ref.FileName))); target != nil {
				imports = append(imports, target.FileName())
			}
		}
		e.imports[name] = imports
		if declaresGlobals(file) {
			e.globals[name] = true
		}
	}
	// Global declarations may import types from ordinary modules. Those
	// imports can change a global's meaning without changing its source.
	var pending []tspath.RootedFilePath
	for name := range e.globals {
		pending = append(pending, name)
	}
	for len(pending) > 0 {
		name := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		for _, dependency := range e.imports[name] {
			if !e.globals[dependency] {
				e.globals[dependency] = true
				pending = append(pending, dependency)
			}
		}
	}
	return e
}

// declaresGlobals reports whether file can declare a name of another file's
// scope: a script, a module augmentation or global block, or a UMD global.
func declaresGlobals(file *ast.SourceFile) bool {
	if !ast.IsExternalModule(file) || len(file.ModuleAugmentations) > 0 {
		return true
	}
	for _, statement := range file.Statements.Nodes {
		if statement.Kind == ast.KindNamespaceExportDeclaration || ast.IsGlobalScopeAugmentation(statement) || ast.IsModuleWithStringLiteralName(statement) {
			return true
		}
	}
	return false
}

// programFilesKey fingerprints the names of program's files.
func programFilesKey(program *compiler.Program) [32]byte {
	names := make([]string, 0, len(program.SourceFiles()))
	for _, file := range program.SourceFiles() {
		names = append(names, file.FileName().AsString())
	}
	slices.Sort(names)
	hash := sha256.New()
	for _, name := range names {
		fmt.Fprintf(hash, "%q", name)
	}
	var key [32]byte
	copy(key[:], hash.Sum(nil))
	return key
}

// baselineKey fingerprints what of b decides whether an error of files is
// added (strictAddedCounts, isUnusedTypeName): their errors with both keys,
// texts and type reads.
func baselineKey(b errorBaseline, files []tspath.RootedFilePath) [32]byte {
	in := map[string]bool{}
	for _, name := range files {
		in[name.AsString()] = true
	}
	var lines []string
	for _, d := range b.errors {
		if d.File() != nil && in[d.File().FileName().AsString()] {
			lines = append(lines, errorKey(d)+"\x00"+errorSpanKey(d))
		}
	}
	slices.Sort(lines)
	hash := sha256.New()
	for _, line := range lines {
		fmt.Fprintf(hash, "%q", line)
	}
	for _, name := range files {
		reads := make([]string, 0, len(b.typeReads[name.AsString()]))
		for read := range b.typeReads[name.AsString()] {
			reads = append(reads, read)
		}
		slices.Sort(reads)
		text, ok := b.texts[name.AsString()]
		fmt.Fprintf(hash, "%q%t%q%q", name.AsString(), ok, text, reads)
	}
	var key [32]byte
	copy(key[:], hash.Sum(nil))
	return key
}

// notePreludeRefusal keeps the refusal of the fix at, which the round's
// last trial proves by the errors added, for fixGate.stillRefused. It
// keeps nothing for an error of no file.
func (r *gateRound) notePreludeRefusal(at [2]int, added map[string]int) {
	e := r.evidence
	if e == nil || len(added) == 0 {
		return
	}
	p := r.proposals[at[0]]
	name := p.file.FileName()
	roots := []tspath.RootedFilePath{name}
	for key := range added {
		found := false
		for file := range e.imports {
			if strings.HasPrefix(key, file.AsString()+": ") { // errorKey's
				found = true
				if !slices.Contains(roots, file) {
					roots = append(roots, file)
				}
			}
		}
		if !found {
			return
		}
	}
	for _, file := range e.first {
		if !slices.Contains(roots, file) {
			roots = append(roots, file)
		}
	}
	slices.SortFunc(roots, tspath.RootedFilePath.Compare)
	reads := map[tspath.RootedFilePath]bool{}
	for next := slices.Clone(roots); len(next) > 0; {
		file := next[len(next)-1]
		next = next[:len(next)-1]
		if reads[file] {
			continue
		}
		reads[file] = true
		next = append(next, e.imports[file]...)
	}
	refusal := &preludeRefusal{base: p.file.Text(), text: r.subset(at[0], []int{at[1]}).text(), reads: reads, tried: e.texts, globals: e.globals, files: e.files, counted: roots, baseline: baselineKey(r.g.baseline, roots)}
	// Only a parser diagnostic from this exact proposal is local evidence.
	// A subset of parser diagnostics still exceeding the complete baseline
	// proves refusal independently of every semantic diagnostic.
	if e.texts[name] == refusal.text {
		for key := range addedCounts(e.syntax[name], r.g.baseline) {
			if added[key] > 0 {
				refusal.syntax = true
				break
			}
		}
	}
	if e.first != nil {
		refusal.round = maps(r.texts, nil)
	}
	if r.g.preludeRefusals == nil {
		r.g.preludeRefusals = map[tspath.RootedFilePath]*preludeRefusal{}
	}
	r.g.preludeRefusals[name] = refusal
}

// stillRefused reports whether the gate refused p, a prelude rewrite of a
// file of program, earlier in the run, and nothing the refusal read has
// changed since (preludeRefusal). files is programFilesKey(program), and
// fs reads the files' texts before the run.
func (g *fixGate) stillRefused(fs vfs.FS, program *compiler.Program, files [32]byte, texts map[tspath.RootedFilePath]string, p proposal) bool {
	name := p.file.FileName()
	refusal := g.preludeRefusals[name]
	if refusal == nil || refusal.base != p.file.Text() || refusal.text != p.text() || refusal.files != files || refusal.baseline != baselineKey(g.baseline, refusal.counted) {
		return false
	}
	if refusal.syntax {
		return true
	}
	changed := func(before map[tspath.RootedFilePath]string, file tspath.RootedFilePath, now string) bool {
		then, ok := before[file]
		if !ok {
			then, _ = fs.ReadFile(file)
		}
		return then != now
	}
	candidates := map[tspath.RootedFilePath]bool{}
	for _, m := range []map[tspath.RootedFilePath]string{texts, refusal.tried, refusal.round} {
		for file := range m {
			candidates[file] = true
		}
	}
	for file := range candidates {
		if file == name {
			continue
		}
		source := program.GetSourceFile(file)
		if source == nil {
			return false
		}
		now := source.Text()
		if !changed(refusal.tried, file, now) && (refusal.round == nil || !changed(refusal.round, file, now)) {
			continue
		}
		if refusal.reads[file] || refusal.globals[file] || declaresGlobals(source) {
			return false
		}
	}
	return true
}
