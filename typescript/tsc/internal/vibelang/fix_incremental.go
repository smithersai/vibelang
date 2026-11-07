package vibelang

import (
	"context"
	"fmt"
	"os"
	"slices"
	"strings"
	"weak"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// The gate checked the whole program for each trial it could not refuse
// from some files, and on a 25-module batch of Smithers' apps/mvp worker
// (5,510 files, 2,392 of them checked) those checks were 70% of the run:
// from its third round on, each round checked the whole program once for
// a few fixes in one to eight files (2026-11-07). A fix changes the errors
// only of the files that read what it changed: TypeScript's incremental
// builder takes those to be the file and the files that import it
// (BuilderState.getFilesAffectedBy), and so does a --fix run. The gate keeps
// what its last check of a program found (a checkedProgram), and in a
// program that differs from it checks only
//
//   - the files whose text differs and every file that imports one, at any
//     depth; in a round, only the files that import one whose signature
//     changed, its declaration file or its exported statements but their
//     function bodies (fixRound; the builder also stops at an importer whose
//     own declaration is unchanged, which this does not);
//   - every file that reported an error in the last program, when a changed
//     file exports other names: an error names a type by a module that
//     exports it (symbolaccessibility.go);
//   - the .vibe files a changed file imports, which can bind their main
//     (wire.go's mainImported);
//   - the files that declare globals.
//
// A file the program adds is a changed file, and a file it drops was read
// only by changed files. Every other file reported no error in the last
// program and reads only files whose text is the same, so it reports none
// now. A check of the whole program stands in where that does not hold:
//
//   - a changed, added or dropped file declares globals, or a file that
//     imports a changed one does, since every file reads them;
//   - a changed file changes what VibeLang reads from every file of the
//     program: its service and control classes, their keys and default
//     values (services_check.go's sharingKey, service_reference_types.go);
//   - a .vibe file of the program does not resolve vibelang-runtime, and
//     missing_runtime.go reads every .vibe file;
//   - the program reports a global diagnostic, which any file's check can
//     add, or the run's first program did once checked;
//   - --only limits the errors the gate counts (fix_only.go).
//
// A check of the changed files that adds an error is made again of the
// whole program, in a program no check has read, so a refusal rests on the
// evidence it always rested on: a check of some files first can report an
// error a check of the whole program does not (gateRound.orderErrors).
//
// VIBELANG_FIX_CHECKS=whole checks the whole program every time;
// VIBELANG_FIX_CHECKS=verify checks it after each check of the changed
// files as well, keeps what the whole check found, and says on stderr where
// the two differ.

// A checkedProgram is what a check of a program found: its files, the
// files each imports, the files that reported an error, and the semantic
// errors of each, by name.
type checkedProgram struct {
	files    map[tspath.RootedFilePath]*ast.SourceFile
	imports  map[tspath.RootedFilePath][]tspath.RootedFilePath
	errors   map[tspath.RootedFilePath]bool
	semantic map[tspath.RootedFilePath][]*ast.Diagnostic
}

// FixChecks says how the gate checks a trial's whole program:
// FixChecksChanged checks the changed files and their readers,
// FixChecksWhole every file, and FixChecksVerify both.
type FixChecks int

const (
	FixChecksChanged FixChecks = iota
	FixChecksWhole
	FixChecksVerify
)

// fixChecksFromEnvironment reads VIBELANG_FIX_CHECKS.
func fixChecksFromEnvironment() (FixChecks, error) {
	switch value := os.Getenv("VIBELANG_FIX_CHECKS"); value {
	case "":
		return FixChecksChanged, nil
	case "whole":
		return FixChecksWhole, nil
	case "verify":
		return FixChecksVerify, nil
	default:
		return 0, fmt.Errorf("VIBELANG_FIX_CHECKS is %q; it is whole or verify, or unset", value)
	}
}

// fixBuilt is the program a run built last, and whether a build has handed
// it out again since: a program handed out twice may have been read. It
// does not keep the program: a run lets the last one go while it builds the
// next, and a checked program holds its type caches.
type fixBuilt struct {
	program weak.Pointer[compiler.Program]
	again   bool
}

// is reports whether p is the program b names, built and not handed out
// again.
func (b *fixBuilt) is(p *compiler.Program) bool {
	return b != nil && !b.again && b.program.Value() == p
}

// checkedOf returns what a check of program found: errors, its errors, of
// which semantic are the semantic ones.
func checkedOf(program *compiler.Program, errors, semantic []*ast.Diagnostic) *checkedProgram {
	files := program.SourceFiles()
	c := &checkedProgram{files: make(map[tspath.RootedFilePath]*ast.SourceFile, len(files)), imports: make(map[tspath.RootedFilePath][]tspath.RootedFilePath, len(files)), errors: map[tspath.RootedFilePath]bool{}, semantic: map[tspath.RootedFilePath][]*ast.Diagnostic{}}
	for _, file := range files {
		c.files[file.FileName()] = file
		c.imports[file.FileName()] = importedFiles(program, file)
	}
	c.found(errors, semantic)
	return c
}

// found records the files that report errors, and the semantic errors of
// each.
func (c *checkedProgram) found(errors, semantic []*ast.Diagnostic) {
	for _, d := range errors {
		if d.File() != nil && c.files[d.File().FileName()] == d.File() {
			c.errors[d.File().FileName()] = true
		}
	}
	for _, d := range semantic {
		if d.File() != nil && c.files[d.File().FileName()] == d.File() && d.Category() == diagnostics.CategoryError {
			c.semantic[d.File().FileName()] = append(c.semantic[d.File().FileName()], d)
		}
	}
}

// programErrorsOf returns the errors of program as programErrors does, and
// the semantic ones: GetSemanticDiagnosticsOfFiles checks the program's files
// as GetSemanticDiagnostics(ctx, nil) does, and returns them by file.
func programErrorsOf(ctx context.Context, program *compiler.Program) (errors, semantic []*ast.Diagnostic) {
	all := slices.Concat(program.GetConfigFileParsingDiagnostics(), program.GetSyntacticDiagnostics(ctx, nil), program.GetProgramDiagnostics(), program.GetGlobalDiagnostics(ctx), program.GetBindDiagnostics(ctx, nil))
	for _, diagnostics := range program.GetSemanticDiagnosticsOfFiles(ctx, program.SourceFiles()) {
		semantic = append(semantic, diagnostics...)
	}
	semantic = compiler.SortAndDeduplicateDiagnostics(semantic)
	return onlyErrors(append(all, semantic...)), onlyErrors(semantic)
}

// onlyErrors returns the errors of diagnostics.
func onlyErrors(all []*ast.Diagnostic) []*ast.Diagnostic {
	var errors []*ast.Diagnostic
	for _, d := range all {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, d)
		}
	}
	return errors
}

// importedFiles returns the files of program that file imports, imports
// types or a module from, or references.
func importedFiles(program *compiler.Program, file *ast.SourceFile) []tspath.RootedFilePath {
	var imports []tspath.RootedFilePath
	for _, m := range program.GetResolvedModules()[file.PathKey()] {
		if m != nil && m.IsResolved() {
			if target := program.GetSourceFileForResolvedModule(m); target != nil {
				imports = append(imports, target.FileName())
			}
		}
	}
	dir := tspath.GetDirectoryPath(file.FileName().AsString())
	for _, ref := range file.ReferencedFiles {
		if target := program.GetSourceFile(tspath.RootedFilePathFromAbsolute(tspath.ResolvePath(dir, ref.FileName))); target != nil {
			imports = append(imports, target.FileName())
		}
	}
	return imports
}

// exportSurface returns what file exports: each export and re-export
// statement, and the kind and names of each exported declaration.
func exportSurface(file *ast.SourceFile) string {
	var b strings.Builder
	for _, statement := range file.Statements.Nodes {
		switch {
		case ast.IsExportDeclaration(statement) || ast.IsExportAssignment(statement):
			b.WriteString(file.Text()[scanner.SkipTrivia(file.Text(), statement.Pos()):statement.End()])
		case ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport):
			fmt.Fprintf(&b, "%d", statement.Kind)
			if ast.IsVariableStatement(statement) {
				for _, declaration := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
					fmt.Fprintf(&b, " %s", scanner.GetTextOfNode(declaration.Name()))
				}
			} else if name := statement.Name(); name != nil {
				fmt.Fprintf(&b, " %s", scanner.GetTextOfNode(name))
			}
			if ast.HasSyntacticModifier(statement, ast.ModifierFlagsDefault) {
				b.WriteString(" default")
			}
		default:
			continue
		}
		b.WriteByte('\n')
	}
	return b.String()
}

// crossFileFacts returns what VibeLang reads from file for every file of
// the program: each service or control class, its name, its written key
// and whether it has a default value.
func crossFileFacts(file *ast.SourceFile) string {
	if !isVibeLangFile(file) {
		return ""
	}
	var b strings.Builder
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if kind := classKindOf(node); kind != ordinaryClass {
			key, written := writtenKey(node)
			fmt.Fprintf(&b, "%d %q %q %t %t\n", kind, node.Name().Text(), key, written != nil, hasDefaultValue(node))
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return b.String()
}

// A changedSet is what a trial's program changed from the program the gate
// compares it with: the program's files and imports, the files whose text
// changed or that it added, the files to check whatever they declare, and
// each file's importers in either program.
type changedSet struct {
	now       *checkedProgram
	changed   []tspath.RootedFilePath
	first     map[tspath.RootedFilePath]bool
	importers map[tspath.RootedFilePath][]tspath.RootedFilePath
}

// readers returns the files of s's program that import one of names, at
// any depth, and names, or false when one of them declares globals.
func (s *changedSet) readers(names []tspath.RootedFilePath) (map[tspath.RootedFilePath]bool, bool) {
	reached := map[tspath.RootedFilePath]bool{}
	pending := slices.Clone(names)
	for len(pending) > 0 {
		name := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		file := s.now.files[name]
		if reached[name] || file == nil {
			continue
		}
		reached[name] = true
		if declaresGlobals(file) {
			return nil, false
		}
		pending = append(pending, s.importers[name]...)
	}
	return reached, true
}

// changedReaders returns what program changed from the program the gate
// compares it with (g.round's in a round, else g.checked), or why a whole
// check must stand in. A file the program adds is a changed one; a file it
// drops was read only by changed files, which no longer import it.
func (g *fixGate) changedReaders(program *compiler.Program) (*changedSet, string) {
	last := g.checked
	if g.round != nil {
		last = g.round.checked
	}
	if last == nil {
		return nil, "no check to compare"
	}
	if !g.changedOnly {
		return nil, "runtime or global diagnostics"
	}
	files := program.SourceFiles()
	now := &checkedProgram{files: make(map[tspath.RootedFilePath]*ast.SourceFile, len(files)), imports: make(map[tspath.RootedFilePath][]tspath.RootedFilePath, len(files)), errors: map[tspath.RootedFilePath]bool{}, semantic: map[tspath.RootedFilePath][]*ast.Diagnostic{}}
	set := &changedSet{now: now, first: map[tspath.RootedFilePath]bool{}, importers: map[tspath.RootedFilePath][]tspath.RootedFilePath{}}
	exports := false
	for _, file := range files {
		name := file.FileName()
		now.files[name] = file
		before := last.files[name]
		if before == file {
			now.imports[name] = last.imports[name]
			continue
		}
		if declaresGlobals(file) || before != nil && declaresGlobals(before) {
			return nil, "globals"
		}
		var facts, surface string
		if before != nil {
			facts, surface = crossFileFacts(before), exportSurface(before)
		}
		if crossFileFacts(file) != facts {
			return nil, "service classes"
		}
		exports = exports || before == nil || exportSurface(file) != surface
		now.imports[name] = importedFiles(program, file)
		set.changed = append(set.changed, name)
		set.first[name] = true
	}
	for name, before := range last.files {
		if now.files[name] == nil {
			if declaresGlobals(before) || crossFileFacts(before) != "" {
				return nil, "globals"
			}
			exports = true
		}
	}
	for _, imports := range []*checkedProgram{last, now} {
		for name, targets := range imports.imports {
			for _, target := range targets {
				set.importers[target] = append(set.importers[target], name)
			}
		}
	}
	for _, name := range set.changed {
		for _, imports := range [][]tspath.RootedFilePath{last.imports[name], now.imports[name]} {
			for _, target := range imports {
				if target.IsVibeLangSource() {
					set.first[target] = true
				}
			}
		}
	}
	if exports {
		for name := range last.errors {
			set.first[name] = true
		}
	}
	for _, file := range files {
		if !program.SkipTypeChecking(file, false) && declaresGlobals(file) {
			set.first[file.FileName()] = true
		}
	}
	return set, ""
}

// A fixRound is the program a round of the gate starts from, which the
// checks of its trials compare with: what the gate found when it checked
// it, and the signature of each file the round's fixes may change
// (declarationSignatures).
type fixRound struct {
	checked    *checkedProgram
	signatures map[tspath.RootedFilePath]string
}

// beginRound starts a round of fixes to files of program, whose check
// g.checked records: a trial that changes one of files checks the files
// that import it only when its signature changes, as TypeScript's builder
// checks again the files that import a file only when its declaration
// changes (BuilderState.getFilesAffectedBy).
func (g *fixGate) beginRound(program *compiler.Program, files []tspath.RootedFilePath) {
	g.round = nil
	if g.scope != nil || g.checks == FixChecksWhole || !g.known.of(program) || g.checked == nil {
		return
	}
	g.progress.stage("finding declarations")
	g.round = &fixRound{checked: g.checked, signatures: declarationSignatures(g.ctx, program, files)}
}

// endRound ends the round beginRound started.
func (g *fixGate) endRound() {
	g.round = nil
}

// declarationSignatures returns, by file, what each of names declares to
// the files that import it: its declaration file, which every .vibe file
// has (declarationsOf), and the text of each of its exported statements but
// their function bodies, which VibeLang reads beside the declaration's
// types. A file with no declaration has no signature.
func declarationSignatures(ctx context.Context, program *compiler.Program, names []tspath.RootedFilePath) map[tspath.RootedFilePath]string {
	declarations := declarationsOf(ctx, program, names)
	signatures := make(map[tspath.RootedFilePath]string, len(declarations))
	for name, declaration := range declarations {
		if file := program.GetSourceFile(name); file != nil {
			signatures[name] = declaration + "\x00" + exportHeaders(file)
		}
	}
	return signatures
}

// exportHeaders returns the text of file's exported statements, each
// function body in them written as {}. VibeLang reparses some forms, such
// as for concurrent, into nodes whose ranges are not in source order, so the
// bodies are cut by their ranges, outermost first.
func exportHeaders(file *ast.SourceFile) string {
	text := file.Text()
	var b strings.Builder
	for _, statement := range file.Statements.Nodes {
		if !ast.IsExportDeclaration(statement) && !ast.IsExportAssignment(statement) && !ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) {
			continue
		}
		start, end := scanner.SkipTrivia(text, statement.Pos()), statement.End()
		if start > end || end > len(text) {
			continue
		}
		var bodies [][2]int
		var visit func(node *ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsFunctionLike(node) && node.Body() != nil {
				body := node.Body()
				if from, to := scanner.SkipTrivia(text, body.Pos()), body.End(); start <= from && from <= to && to <= end {
					bodies = append(bodies, [2]int{from, to})
				}
				return false
			}
			return node.ForEachChild(visit)
		}
		visit(statement)
		slices.SortFunc(bodies, func(x, y [2]int) int { return x[0] - y[0] })
		at := start
		for _, body := range bodies {
			if body[0] < at {
				continue // inside a body already cut
			}
			b.WriteString(text[at:body[0]])
			b.WriteString("{}")
			at = body[1]
		}
		b.WriteString(text[at:end])
		b.WriteByte('\n')
	}
	return b.String()
}

// changedOnly reports whether a run whose first program, checked, is
// program may check only the files a trial changes and their readers: every
// .vibe file finds vibelang-runtime, as missing_runtime.go asks before it
// checks a file (when one does not, that check reads every .vibe file of the
// program), and the check found no global diagnostic.
func changedOnly(ctx context.Context, program *compiler.Program) bool {
	if len(program.GetGlobalDiagnostics(ctx)) > 0 {
		return false
	}
	for _, file := range program.SourceFiles() {
		if !isVibeLangFile(file) || program.IsSourceFileFromExternalLibrary(file) {
			continue
		}
		c, done := program.GetTypeCheckerForFile(ctx, file)
		installed := runtimeInstalledFor(c, file)
		done()
		if !installed {
			return false
		}
	}
	return true
}

// changedErrors returns the errors of program, as programErrors returns
// them, from a check of only the files changedReaders names and the files
// that read a changed file whose signature changed, or why a whole check
// must stand in, and then whether this check read program.
func (g *fixGate) changedErrors(program *compiler.Program) (errors []*ast.Diagnostic, now *checkedProgram, whole string, read bool) {
	set, whole := g.changedReaders(program)
	if whole != "" {
		return nil, nil, whole, false
	}
	now = set.now
	check := set.first
	if g.round == nil {
		readers, ok := set.readers(set.changed)
		if !ok {
			return nil, nil, "globals", false
		}
		check = mergeNames(check, readers)
	}
	ctx := g.ctx
	all := slices.Concat(program.GetConfigFileParsingDiagnostics(), program.GetSyntacticDiagnostics(ctx, nil), program.GetProgramDiagnostics())
	if len(program.GetGlobalDiagnostics(ctx)) > 0 {
		return nil, nil, "global diagnostics", true
	}
	all = append(all, program.GetBindDiagnostics(ctx, nil)...)
	semantic := g.checkNamed(program, check, nil)
	checked := len(check)
	checkedNames := check
	if g.round != nil {
		// The files that import a changed file whose signature is the same
		// read what they read; those that import one whose signature changed
		// are checked too.
		signatures := declarationSignatures(ctx, program, set.changed)
		var shaped []tspath.RootedFilePath
		for _, name := range set.changed {
			if signature, ok := signatures[name]; !ok || signature != g.round.signatures[name] {
				shaped = append(shaped, name)
			}
		}
		readers, ok := set.readers(shaped)
		if !ok {
			return nil, nil, "globals", true
		}
		semantic = append(semantic, g.checkNamed(program, readers, check)...)
		checkedNames = mergeNames(check, readers)
		checked = len(checkedNames)
	}
	g.progress.checkedChanged(checked)
	if len(program.GetGlobalDiagnostics(ctx)) > 0 {
		return nil, nil, "global diagnostics", true
	}
	// A file not checked again reports the semantic errors it did.
	last := g.checked
	if g.round != nil {
		last = g.round.checked
	}
	for name, carried := range last.semantic {
		if file := now.files[name]; file != nil && file == last.files[name] && !checkedNames[name] {
			semantic = append(semantic, carried...)
		}
	}
	semantic = compiler.SortAndDeduplicateDiagnostics(semantic)
	errors = onlyErrors(append(all, semantic...))
	now.found(errors, semantic)
	return errors, now, "", true
}

// checkNamed returns the semantic diagnostics of the files of program that
// names holds and done does not, checked in the program's order.
func (g *fixGate) checkNamed(program *compiler.Program, names, done map[tspath.RootedFilePath]bool) []*ast.Diagnostic {
	var files []*ast.SourceFile
	for _, file := range program.SourceFiles() {
		if names[file.FileName()] && !done[file.FileName()] {
			files = append(files, file)
		}
	}
	var semantic []*ast.Diagnostic
	for _, diagnostics := range program.GetSemanticDiagnosticsOfFiles(g.ctx, files) {
		semantic = append(semantic, diagnostics...)
	}
	return semantic
}

// mergeNames returns a set of the names of a and b.
func mergeNames(a, b map[tspath.RootedFilePath]bool) map[tspath.RootedFilePath]bool {
	merged := make(map[tspath.RootedFilePath]bool, len(a)+len(b))
	for name := range a {
		merged[name] = true
	}
	for name := range b {
		merged[name] = true
	}
	return merged
}

// errorsOf returns the errors of program the gate counts, which a trial of
// texts built, and the program they are of: program, or one built again
// from texts when a whole check stands in for a check of program's changed
// files that read it.
func (g *fixGate) errorsOf(program *compiler.Program, texts map[tspath.RootedFilePath]string) (*compiler.Program, []*ast.Diagnostic) {
	if g.scope == nil && g.checks != FixChecksWhole && g.built.is(program) && texts != nil {
		g.built.again = true
		g.progress.stage("checking changed files")
		errors, now, whole, read := g.changedErrors(program)
		if whole == "" && len(addedCounts(errors, g.baseline)) > 0 {
			whole = "added errors"
		}
		if whole == "" {
			if g.checks != FixChecksVerify || g.done.Err() != nil {
				g.checked, g.known = now, knownErrors{weak.Make(program), errors, true}
				return program, errors
			}
			program, wholeErrors := g.wholeErrors(g.fresh(texts))
			if differs := differentErrors(errors, wholeErrors); differs != "" {
				g.progress.differed("vibelang --fix: a check of the changed files found other errors than the whole program: " + differs)
			}
			return program, wholeErrors
		}
		g.progress.wholeInstead(whole)
		if g.done.Err() != nil {
			// A stopped run builds no program: a check that added errors
			// refuses what it tried, and a check that read program goes on
			// to the rest of it.
			if whole == "added errors" {
				return program, errors
			}
			return g.wholeErrors(program)
		}
		if read {
			program = g.fresh(texts)
		}
		if whole == "added errors" {
			// The check of the whole program stands, and says whether the
			// check of the changed files added the same errors.
			program, wholeErrors := g.wholeErrors(program)
			if differs := differentErrors(keyedErrors(errors, g.baseline), keyedErrors(wholeErrors, g.baseline)); differs != "" {
				g.progress.differed("vibelang --fix: a check of the changed files added other errors than the whole program: " + differs)
			}
			return program, wholeErrors
		}
	}
	return g.wholeErrors(program)
}

// wholeErrors returns the errors of program the gate counts, from a check
// of the whole program.
func (g *fixGate) wholeErrors(program *compiler.Program) (*compiler.Program, []*ast.Diagnostic) {
	g.progress.stage("checking diagnostics")
	if g.scope != nil {
		return program, g.scope.errors(g.ctx, program)
	}
	if g.known.of(program) && len(program.GetGlobalDiagnostics(g.ctx)) == 0 {
		return program, g.known.errors
	}
	errors, semantic := programErrorsOf(g.ctx, program)
	g.checked, g.known = checkedOf(program, errors, semantic), knownErrors{weak.Make(program), errors, false}
	return program, errors
}

// keyedErrors returns the errors of errors that baseline does not hold.
func keyedErrors(errors []*ast.Diagnostic, baseline errorBaseline) []*ast.Diagnostic {
	added := addedCounts(errors, baseline)
	var kept []*ast.Diagnostic
	for _, d := range errors {
		if key := errorKey(d); added[key] > 0 {
			added[key]--
			kept = append(kept, d)
		}
	}
	return kept
}

// knownErrors are the errors errorsOf last returned and the program they
// are of, which they do not keep, and whether a check of its changed files
// found them.
type knownErrors struct {
	program weak.Pointer[compiler.Program]
	errors  []*ast.Diagnostic
	changed bool
}

// of reports whether k are the errors of program.
func (k knownErrors) of(program *compiler.Program) bool {
	return program != nil && k.program.Value() == program
}

// programErrors returns the errors of program, which errorsOf may have
// found already: a check of program's other files, one by one, would find
// none after a check of its changed files, and cost about one of the whole
// program. programErrors asks for the global diagnostics again, and finds
// the ones a check added since, so the known errors stand only when there
// are none.
func (g *fixGate) programErrors(program *compiler.Program) []*ast.Diagnostic {
	if g.known.of(program) && len(program.GetGlobalDiagnostics(g.ctx)) == 0 {
		return g.known.errors
	}
	return programErrors(g.ctx, program)
}

// checkFixable checks files, program's files that can be fixed, together,
// when a check of program's changed files found its errors: the round
// asks for each one's diagnostics in turn, which a check of the whole
// program had found.
func (g *fixGate) checkFixable(program *compiler.Program, files []*ast.SourceFile) {
	if g.known.of(program) && g.known.changed {
		g.progress.stage("checking fixable files")
		program.GetSemanticDiagnosticsOfFiles(g.ctx, files)
	}
}

// differentErrors returns the first error, by errorKey, that one of a and b
// reports more often than the other, or "" when they report the same.
func differentErrors(a, b []*ast.Diagnostic) string {
	counts := map[string]int{}
	for _, d := range a {
		counts[errorKey(d)]++
	}
	for _, d := range b {
		counts[errorKey(d)]--
	}
	var keys []string
	for key, n := range counts {
		if n != 0 {
			keys = append(keys, fmt.Sprintf("%s (%+d)", key, n))
		}
	}
	slices.Sort(keys)
	if len(keys) == 0 {
		return ""
	}
	return keys[0]
}
