package vibelang

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/autoimport"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/wrapvfs"
)

// vibelang --fix (D291) applies every safe quick fix to a project's .vibe
// files, then compiles as the rest of the command line says:
//
//	vibelang -p tsconfig.json --fix --noEmit
//
// A safe fix is the quick fix of a diagnostic in tsFormFixCodes that the
// project reports, so a code turned off in the vibelang setting diagnostics,
// or silenced by an @vibelang-diagnostics comment, is not fixed. Fixes apply
// in rounds, through the language server's own code actions: each round
// takes, in each file, the fixes whose edits do not overlap, and a fix that
// overlaps one taken waits for the next round, which rechecks the edited
// program. A round's fixes are kept only when the edited program reports no
// error the original did not, compared by file, code, and message; when the
// round as a whole would add one, the files that report the added errors are
// tried apart from the rest, and a set of files that adds one is halved until
// the files that add it are found, then each such file's fixes are; each fix
// that adds an error is refused, named with the first error it adds, and not
// tried again. A round so costs a few checks of the program, not one per
// file, and the programs share the files no fix edited. After the last
// round, it writes what the prelude makes shorter
// (fix_prelude.go): it removes the imports of modules the prelude supplies
// (D310, D311) and writes M.M as M where a module's name names its service,
// keeping each file's rewrites only when the program then reports no error
// it did not before. Then an import of effect or one of its modules that
// the fixes left unused is removed. Nothing is written until every round is
// done, nothing at all when the command is interrupted, and a second run
// finds nothing to fix. The fix of the retired try(…) hatch (EK4616, VIP-5)
// runs under --fix-migration-only too. --fix-vip-only applies only the VIP
// migrations: that fix, then try before each call that runs where it stands
// (fix_try.go), which keeps the call's meaning while every call still runs
// where it stands. --fix cannot be combined with --build or --watch.

// vipMigrationFixCodes are the codes whose quick fixes migrate code to an
// accepted VIP, which --fix-migration-only applies too.
var vipMigrationFixCodes []int32

// FixFlag is the command line flag that applies the quick fixes.
const FixFlag = "--fix"

// FixOptions scopes repository migration tools without also rewriting the
// TypeScript-style teaching examples or their explicit imports (D382).
// VIPOnly applies the VIP migrations and nothing else.
type FixOptions struct{ MigrationOnly, VIPOnly bool }

// FixOptionsArguments removes the optional scope flag after --fix was found.
// Ordinary --fix keeps its existing behavior, including prelude cleanup.
func FixOptionsArguments(args []string) ([]string, FixOptions) {
	var options FixOptions
	var rest []string
	for _, arg := range args {
		if strings.EqualFold(arg, "--fix-migration-only") {
			options.MigrationOnly = true
		} else if strings.EqualFold(arg, "--fix-vip-only") {
			options.VIPOnly = true
		} else {
			rest = append(rest, arg)
		}
	}
	return rest, options
}

// FixArguments returns args without any --fix flags, and whether it held one.
func FixArguments(args []string) ([]string, bool) {
	index := slices.IndexFunc(args, func(arg string) bool { return strings.EqualFold(arg, FixFlag) })
	if index < 0 {
		return args, false
	}
	return slices.DeleteFunc(slices.Clone(args), func(arg string) bool { return strings.EqualFold(arg, FixFlag) }), true
}

// Fix applies the safe quick fixes to the project that args, a command line
// without --fix, names, writes the files they change, and reports them on
// sys's writer. It returns a nonzero exit status only when it cannot run;
// diagnostics are the compilation's to report.
func Fix(ctx context.Context, sys tsc.System, args []string) int {
	return FixWithOptions(ctx, sys, args, FixOptions{})
}

func FixWithOptions(ctx context.Context, sys tsc.System, args []string, options FixOptions) int {
	for _, arg := range args {
		switch strings.ToLower(arg) {
		case "-b", "--b", "-build", "--build", "-w", "--w", "-watch", "--watch":
			fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: %s cannot be combined with --fix; run vibelang -p <tsconfig> --fix for each project.\n", arg)
			return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
		}
	}
	commandLine := tsoptions.ParseCommandLine(args, sys.FS(), sys.GetCurrentDirectory())
	if len(commandLine.Errors) > 0 {
		return 0 // the compilation reports them
	}
	configFileName := fixConfigFile(sys, commandLine)
	if configFileName == "" {
		fmt.Fprintln(sys.ErrorWriter(), "vibelang --fix: no tsconfig.json: name a project with -p.")
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	if err := migrateSeverityConfigs(sys, configFileName); err != nil {
		fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: %v\n", err)
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	path := sys.FS().CaseSensitivity().PathKey(tspath.RootedPath(configFileName))
	config, errors := tsoptions.GetParsedCommandLineOfConfigFilePath(configFileName, path, commandLine.CompilerOptions(), nil, sys.FS(), &tsc.ExtendedConfigCache{})
	if len(errors) > 0 || config == nil {
		return 0 // the compilation reports them
	}
	result := FixProjectWithOptions(ctx, sys.FS(), sys.DefaultLibraryPath(), config, options)
	if ctx.Err() != nil {
		fmt.Fprintln(sys.ErrorWriter(), "vibelang --fix: interrupted; no file written.")
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	if result.Err != nil {
		fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: %v; no file written.\n", result.Err)
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	for _, name := range result.Order {
		file := result.Files[name]
		if err := os.WriteFile(name.AsString(), []byte(file.Text), 0o644); err != nil {
			fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: %s: %v\n", relativeName(sys, name), err)
			return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
		}
	}
	result.Report(sys.Writer(), func(name tspath.RootedFilePath) string { return relativeName(sys, name) })
	return 0
}

// fixConfigFile returns the tsconfig.json that commandLine names with -p, or
// the nearest one above the current directory, as the compilation finds it.
func fixConfigFile(sys tsc.System, commandLine *tsoptions.ParsedCommandLine) tspath.RootedFilePath {
	if project := commandLine.CompilerOptions().Project; project != "" {
		directory := tspath.RootedDirectoryPathFromPath(project)
		if sys.FS().DirectoryExists(directory) {
			return tsoptions.ConfigFileInDirectory(directory, sys.FS().FileExists)
		}
		return tspath.RootedFilePathFromPath(project)
	}
	return tsoptions.FindConfigFile(sys.GetCurrentDirectory(), sys.FS().FileExists)
}

// relativeName returns name relative to sys's current directory.
func relativeName(sys tsc.System, name tspath.RootedFilePath) string {
	return tspath.ConvertToRelativePath(name.AsString(), sys.GetCurrentDirectory(), sys.FS().CaseSensitivity())
}

// A FixedFile is a file that the fixes change.
type FixedFile struct {
	Original string
	Text     string
	Counts   map[int32]int  // fixes applied, by code
	Rewrites map[string]int // prelude rewrites applied, by kind (fix_prelude.go)
}

// A FixRefusal is a fix that would add an error.
type FixRefusal struct {
	File  tspath.RootedFilePath
	Line  int // 1-based, in the text the fix was tried on
	Code  int32
	Error string // the first error the fix would add
}

// FixResult is what FixProject did.
type FixResult struct {
	Files   map[tspath.RootedFilePath]*FixedFile
	Order   []tspath.RootedFilePath
	Refused []FixRefusal
	Err     error // normalization could not reach a fixed point
}

// Report writes one line per fixed file and per refusal, and a summary.
func (r *FixResult) Report(w io.Writer, name func(tspath.RootedFilePath) string) {
	total := 0
	for _, file := range r.Order {
		fixed := r.Files[file]
		var codes []int32
		count := 0
		for code, n := range fixed.Counts {
			codes = append(codes, code)
			count += n
		}
		slices.Sort(codes)
		var parts []string
		for _, code := range codes {
			parts = append(parts, fmt.Sprintf("EK%04d ×%d", code, fixed.Counts[code]))
		}
		for _, kind := range []string{tryLabel, effectLabel, preludeImportLabel, preludeKeyLabel} {
			if n := fixed.Rewrites[kind]; n > 0 {
				parts = append(parts, kind+" ×"+strconv.Itoa(n))
				count += n
			}
		}
		total += count
		fmt.Fprintf(w, "vibelang --fix: %s: %d %s (%s)\n", name(file), count, plural(count, "fix", "fixes"), strings.Join(parts, ", "))
	}
	for _, refusal := range r.Refused {
		fmt.Fprintf(w, "vibelang --fix: %s:%d: EK%04d not fixed: the fixed program would report %s\n", name(refusal.File), refusal.Line, refusal.Code, refusal.Error)
	}
	fmt.Fprintf(w, "vibelang --fix: %d %s in %d %s", total, plural(total, "fix", "fixes"), len(r.Order), plural(len(r.Order), "file", "files"))
	if len(r.Refused) > 0 {
		fmt.Fprintf(w, "; %d %s refused", len(r.Refused), plural(len(r.Refused), "fix", "fixes"))
	}
	fmt.Fprintln(w, ".")
}

func plural(n int, one, many string) string {
	return core.IfElse(n == 1, one, many)
}

// FixProject applies the safe quick fixes to config's .vibe files and
// returns the files they change, without writing them. When ctx is done it
// stops after the program it is checking, and returns what it had.
func FixProject(ctx context.Context, fs vfs.FS, libraryPath tspath.RootedDirectoryPath, config *tsoptions.ParsedCommandLine) *FixResult {
	return FixProjectWithOptions(ctx, fs, libraryPath, config, FixOptions{})
}

func FixProjectWithOptions(ctx context.Context, fs vfs.FS, libraryPath tspath.RootedDirectoryPath, config *tsoptions.ParsedCommandLine, options FixOptions) *FixResult {
	result := &FixResult{Files: map[tspath.RootedFilePath]*FixedFile{}}
	// A checker that sees its context canceled panics when it is asked
	// again, so the checks run to their end and ctx is tested between them.
	done := ctx
	ctx = context.WithoutCancel(ctx)
	texts := map[tspath.RootedFilePath]string{}
	parsed := &fixParsedFiles{}
	build := func(overlay map[tspath.RootedFilePath]string) *compiler.Program {
		return fixProgram(fs, libraryPath, config, parsed, overlay)
	}
	program := build(texts)
	if done.Err() != nil {
		return result
	}
	g := &fixGate{ctx: ctx, done: done, build: build, baseline: errorCounts(ctx, program), refused: map[string]bool{}}
	seen := map[[32]byte]bool{fixState(program): true}
	for {
		if done.Err() != nil {
			return result
		}
		var proposals []proposal
		for _, file := range fixableFiles(program) {
			refuse := func(refusal FixRefusal, key string) {
				g.refused[key] = true
				result.Refused = append(result.Refused, refusal)
			}
			var p proposal
			if options.VIPOnly {
				p = fileFixes(ctx, program, file, g.refused, vipMigrationFixCodes)
				if len(p.fixes) > 0 {
					proposals = append(proposals, p)
				}
				continue
			}
			p = pipeMigrationFixes(ctx, program, file, g.refused, refuse)
			p = p.withFixes(dualBlockMigrationFixes(ctx, program, file, g.refused, refuse))
			p = p.withFixes(keywordMigrationFixes(ctx, program, file, g.refused, refuse))
			p = p.withFixes(vipTypeMigrationFixes(ctx, program, file, g.refused))
			if len(p.fixes) == 0 && !options.MigrationOnly {
				p = fileFixes(ctx, program, file, g.refused, tsFormFixCodes)
			} else if len(p.fixes) == 0 {
				p = fileFixes(ctx, program, file, g.refused, vipMigrationFixCodes)
			}
			if len(p.fixes) > 0 {
				proposals = append(proposals, p)
			}
		}
		if len(proposals) == 0 {
			break
		}
		accepted := g.accept(texts, proposals, func(refusal FixRefusal, key string) {
			g.refused[key] = true
			result.Refused = append(result.Refused, refusal)
		})
		if done.Err() != nil {
			return result
		}
		if len(accepted) == 0 {
			continue // every fix refused; the next round tries the rest
		}
		for _, p := range accepted {
			name := p.file.FileName()
			fixed := result.Files[name]
			if fixed == nil {
				original, _ := fs.ReadFile(name)
				fixed = &FixedFile{Original: original, Counts: map[int32]int{}}
				result.Files[name] = fixed
				result.Order = append(result.Order, name)
			}
			fixed.Text = p.text()
			for _, f := range p.fixes {
				fixed.Counts[f.code]++
			}
			texts[name] = fixed.Text
		}
		program = build(texts)
		state := fixState(program)
		if seen[state] {
			result.Err = fmt.Errorf("normalization repeated a source state instead of reaching a fixed point")
			return result
		}
		seen[state] = true
	}
	// try before each call that runs where it stands (VIP-5, fix_try.go).
	if done.Err() == nil && options.VIPOnly {
		rewriteTries(g, fs, build(texts), texts, result)
	}
	// effect where a function compiles to an Effect (VIP-1, VIP-2, fix_effect.go).
	if done.Err() == nil && options.VIPOnly {
		rewriteEffects(g, fs, build(texts), texts, result)
	}
	if options.MigrationOnly || options.VIPOnly {
		slices.SortFunc(result.Order, tspath.RootedFilePath.Compare)
		return result
	}
	// What the prelude makes shorter (D310, D311).
	if done.Err() == nil {
		rewritePrelude(g, fs, build(texts), texts, result)
	}
	// Remove the effect imports that the fixes left unused.
	cleaned := map[tspath.RootedFilePath]string{}
	for _, name := range result.Order {
		if text, ok := withoutUnusedEffectImports(name, result.Files[name].Original, texts[name]); ok {
			cleaned[name] = text
		}
	}
	if len(cleaned) > 0 && done.Err() == nil {
		if _, bad := newError(ctx, build(maps(texts, cleaned)), g.baseline); !bad {
			for name, text := range cleaned {
				result.Files[name].Text = text
			}
		}
	}
	slices.SortFunc(result.Order, tspath.RootedFilePath.Compare)
	return result
}

// fixState fingerprints the complete project source state, with file names
// and lengths framed by quoting. Repeated states are a cycle or a no-op, not
// successful normalization; the CLI reports the failure without writing.
func fixState(program *compiler.Program) [32]byte {
	files := fixableFiles(program)
	slices.SortFunc(files, func(a, b *ast.SourceFile) int { return a.FileName().Compare(b.FileName()) })
	hash := sha256.New()
	for _, file := range files {
		fmt.Fprintf(hash, "%q%q", file.FileName().AsString(), file.Text())
	}
	var state [32]byte
	copy(state[:], hash.Sum(nil))
	return state
}

// rewritePrelude applies the prelude rewrites of program's files
// (fix_prelude.go) that add no error to g's baseline: all of them when they
// pass together, else each file's that passes on its own. It records them in
// result and texts.
func rewritePrelude(g *fixGate, fs vfs.FS, program *compiler.Program, texts map[tspath.RootedFilePath]string, result *FixResult) {
	rewrites := preludeRewriteProject(g.ctx, program)
	if len(rewrites) == 0 {
		return
	}
	candidates := map[tspath.RootedFilePath]string{}
	var names []tspath.RootedFilePath
	for name, r := range rewrites {
		if !editsPreserveComments(program.GetSourceFile(name).Text(), r.edits) {
			continue
		}
		candidates[name] = applyEdits(program.GetSourceFile(name).Text(), r.edits)
		names = append(names, name)
	}
	slices.SortFunc(names, tspath.RootedFilePath.Compare)
	kept := map[tspath.RootedFilePath]string{}
	if _, ok := g.passes(texts, candidates); ok {
		kept = candidates
	} else {
		for _, name := range names {
			if g.done.Err() != nil {
				return
			}
			trial := maps(kept, map[tspath.RootedFilePath]string{name: candidates[name]})
			if _, ok := g.passes(texts, trial); ok {
				kept = trial
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
		fixed.Rewrites[preludeImportLabel] += rewrites[name].imports
		fixed.Rewrites[preludeKeyLabel] += rewrites[name].keys
		fixed.Text = text
		texts[name] = text
	}
}

// maps returns base with additions written over it.
func maps(base, additions map[tspath.RootedFilePath]string) map[tspath.RootedFilePath]string {
	merged := make(map[tspath.RootedFilePath]string, len(base)+len(additions))
	for k, v := range base {
		merged[k] = v
	}
	for k, v := range additions {
		merged[k] = v
	}
	return merged
}

// fixParsedFiles holds the files a --fix run has parsed, by parse options.
type fixParsedFiles = collections.SyncMap[ast.SourceFileParseOptions, *ast.SourceFile]

// fixProgram builds config's program with the texts of overlay in place of
// the files on disk, reusing the files of parsed whose text is unchanged.
func fixProgram(fs vfs.FS, libraryPath tspath.RootedDirectoryPath, config *tsoptions.ParsedCommandLine, parsed *fixParsedFiles, overlay map[tspath.RootedFilePath]string) *compiler.Program {
	overlaid := wrapvfs.Wrap(fs, wrapvfs.Replacements{
		ReadFile: func(name tspath.RootedFilePath) (string, bool) {
			if text, ok := overlay[name]; ok {
				return text, true
			}
			return fs.ReadFile(name)
		},
	})
	host := fixCompilerHost{compiler.NewCompilerHost(overlaid, libraryPath, nil, nil, nil), parsed}
	return compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: host})
}

// fixCompilerHost lets a --fix run's programs share parsed files. The run
// builds a program for each round and trial, and nearly all of their text,
// the libraries and the packages, stays as it was: parsing and binding it
// again took three quarters of the run. A file's tree and binding do not
// change once made, so programs can share them, as the language server's do.
type fixCompilerHost struct {
	compiler.CompilerHost
	parsed *fixParsedFiles
}

func (h fixCompilerHost) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	text, ok := h.FS().ReadFile(opts.FileName)
	if !ok {
		return nil
	}
	if file, ok := h.parsed.Load(opts); ok && file.Text() == text {
		return file
	}
	file := h.CompilerHost.GetSourceFile(opts)
	h.parsed.Store(opts, file)
	return file
}

// fixableFiles returns the .vibe files of program's own project, the ones
// tsc would emit for it: not a file that a package import reached, as a
// workspace dependency's source linked into node_modules is, nor a
// referenced project's source. Their diagnostics are still the
// compilation's to report.
func fixableFiles(program *compiler.Program) []*ast.SourceFile {
	var files []*ast.SourceFile
	for _, file := range program.SourceFiles() {
		if isVibeLangFile(file) && !strings.Contains(file.FileName().AsString(), "/node_modules/") &&
			!program.IsSourceFileFromExternalLibrary(file) && program.GetProjectReferenceFromSource(file.PathKey()) == nil {
			files = append(files, file)
		}
	}
	return files
}

// errorCounts counts program's errors by file, code, and message. It
// collects every kind of error whatever the others hold, as the language
// server does: GetDiagnosticsOfAnyProgram stops at syntax errors, so a
// syntax error anywhere would hide every type error a fix adds.
func errorCounts(ctx context.Context, program *compiler.Program) map[string]int {
	counts := map[string]int{}
	all := slices.Concat(
		program.GetConfigFileParsingDiagnostics(),
		program.GetSyntacticDiagnostics(ctx, nil),
		program.GetProgramDiagnostics(),
		program.GetGlobalDiagnostics(ctx),
		program.GetBindDiagnostics(ctx, nil),
		program.GetSemanticDiagnostics(ctx, nil),
	)
	for _, d := range all {
		if d.Category() == diagnostics.CategoryError {
			counts[errorKey(d)]++
		}
	}
	return counts
}

// errorKey names d by its file, code, and message, which edits elsewhere in
// the file leave as they were.
func errorKey(d *ast.Diagnostic) string {
	file := ""
	if d.File() != nil {
		file = d.File().FileName().AsString()
	}
	source := d.Source()
	if source == "" {
		source = "TS"
	}
	code := source + strconv.Itoa(int(d.Code()))
	if source == diagnosticSource {
		code = fmt.Sprintf("EK%04d", d.Code())
	}
	return file + ": " + code + ": " + d.String()
}

// newError returns an error program reports that baseline does not hold, as
// the line a refusal names, and true; or false.
func newError(ctx context.Context, program *compiler.Program, baseline map[string]int) (string, bool) {
	added := addedErrors(ctx, program, baseline)
	if len(added) == 0 {
		return "", false
	}
	return added[0], true
}

// addedErrors returns the errors program reports that baseline does not
// hold, by errorKey, sorted.
func addedErrors(ctx context.Context, program *compiler.Program, baseline map[string]int) []string {
	var added []string
	for key, n := range errorCounts(ctx, program) {
		if n > baseline[key] {
			added = append(added, key)
		}
	}
	slices.Sort(added)
	return added
}

// fixGate keeps the fixes whose edited program adds no error to baseline.
type fixGate struct {
	ctx      context.Context // never canceled: see FixProject
	done     context.Context // canceled when the command is interrupted
	build    func(map[tspath.RootedFilePath]string) *compiler.Program
	baseline map[string]int
	refused  map[string]bool // fixes refused, by fixKey
}

// passes reports whether the program with overlay over texts adds no error,
// and returns the first error it adds.
func (g *fixGate) passes(texts, overlay map[tspath.RootedFilePath]string) (string, bool) {
	error, bad := newError(g.ctx, g.build(maps(texts, overlay)), g.baseline)
	return error, !bad
}

// accept returns proposals cut down to the fixes that, together, add no
// error, and calls refuse for each fix that adds one. It tries the round as
// a whole; when that adds an error, it tries the files that report none of
// the added errors, then the files that do, which most likely hold the fixes
// that add them. A set of files that adds an error is halved until each half
// passes or is one file, keeping the halves that pass, and each failing
// file's fixes are halved the same way, so that finding k bad files among n
// costs about 2k·log2(n) checks of the program, not n.
func (g *fixGate) accept(texts map[tspath.RootedFilePath]string, proposals []proposal, refuse func(FixRefusal, string)) []proposal {
	all := map[tspath.RootedFilePath]string{}
	for _, p := range proposals {
		all[p.file.FileName()] = p.text()
	}
	added := addedErrors(g.ctx, g.build(maps(texts, all)), g.baseline)
	if len(added) == 0 {
		return proposals
	}
	var others, suspects []proposal
	for _, p := range proposals {
		prefix := p.file.FileName().AsString() + ": " // errorKey's
		if slices.ContainsFunc(added, func(key string) bool { return strings.HasPrefix(key, prefix) }) {
			suspects = append(suspects, p)
		} else {
			others = append(others, p)
		}
	}
	var accepted, failing []proposal
	kept := map[tspath.RootedFilePath]string{}
	keep := func(p proposal) {
		kept[p.file.FileName()] = p.text()
		accepted = append(accepted, p)
	}
	var files func([]proposal, bool)
	files = func(ps []proposal, known bool) { // known: ps together add an error
		if g.done.Err() != nil {
			return
		}
		if !known {
			trial := maps(kept, nil)
			for _, p := range ps {
				trial[p.file.FileName()] = p.text()
			}
			if _, ok := g.passes(texts, trial); ok {
				for _, p := range ps {
					keep(p)
				}
				return
			}
		}
		if len(ps) == 1 {
			failing = append(failing, ps[0])
			return
		}
		files(ps[:len(ps)/2], false)
		files(ps[len(ps)/2:], false)
	}
	if len(others) == 0 || len(suspects) == 0 {
		files(proposals, true)
	} else {
		files(others, false)
		files(suspects, false)
	}
	for _, p := range failing {
		name := p.file.FileName()
		var taken []fileFix
		var fixes func([]fileFix, bool)
		fixes = func(fs []fileFix, known bool) { // known: taken and fs together add an error
			if g.done.Err() != nil {
				return
			}
			if !known || len(fs) == 1 {
				trial := proposal{file: p.file, fixes: append(slices.Clone(taken), fs...)}
				error, ok := g.passes(texts, maps(kept, map[tspath.RootedFilePath]string{name: trial.text()}))
				if ok {
					taken = append(taken, fs...)
					return
				}
				if len(fs) == 1 {
					line, _ := scannerLineOf(p.file, firstEdit(fs[0].edits))
					refuse(FixRefusal{File: name, Line: line + 1, Code: fs[0].code, Error: error}, fs[0].key)
					return
				}
			}
			fixes(fs[:len(fs)/2], false)
			fixes(fs[len(fs)/2:], false)
		}
		fixes(p.fixes, true)
		if len(taken) > 0 {
			keep(proposal{file: p.file, fixes: taken})
		}
	}
	return accepted
}

// scannerLineOf returns the 0-based line and column of pos in file.
func scannerLineOf(file *ast.SourceFile, pos int) (int, int) {
	text := file.Text()[:pos]
	return strings.Count(text, "\n"), len(text) - strings.LastIndex(text, "\n") - 1
}

// A fileFix is one diagnostic's quick fix: its code, its edits, and the key
// that names it across rounds, its code and the text it replaces.
type fileFix struct {
	code  int32
	edits []sourceEdit
	key   string
}

// A proposal is one round's fixes of a file, whose edits do not overlap.
type proposal struct {
	file  *ast.SourceFile
	fixes []fileFix
}

// text returns the proposal's file with its fixes applied.
func (p proposal) text() string {
	var edits []sourceEdit
	for _, f := range p.fixes {
		edits = append(edits, f.edits...)
	}
	return applyEdits(p.file.Text(), edits)
}

// fileFixes asks the language server for the quick fix of each safe
// diagnostic of file, one of codes, and applies the fixes whose edits do
// not overlap.
func fileFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool, codes []int32) proposal {
	var fixable []*ast.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(ctx, file) {
		if d.Source() == diagnosticSource && slices.Contains(codes, d.Code()) && d.File() == file {
			fixable = append(fixable, d)
		}
	}
	if len(fixable) == 0 {
		return proposal{file: file}
	}
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		if f := program.GetSourceFile(name); f != nil {
			return lsconv.ComputeLSPLineStarts(f.Text())
		}
		return lsconv.ComputeLSPLineStarts("")
	})
	service := ls.NewLanguageService(nil, program, fixHost{program: program, converters: converters}, file.FileName().AsString())
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
	var candidates []fileFix
	for _, d := range fixable {
		key := fixKey(file, d)
		if refused[key] {
			continue
		}
		diagnostic := lsconv.DiagnosticToLSPPush(ctx, converters, d)
		response, err := service.ProvideCodeActions(ctx, &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: uri},
			Range:        diagnostic.Range,
			Context:      &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}, Only: &only},
		})
		if err != nil || response.CommandOrCodeActionArray == nil {
			continue
		}
		for _, action := range *response.CommandOrCodeActionArray {
			if action.CodeAction == nil || action.CodeAction.Edit == nil || action.CodeAction.Edit.Changes == nil {
				continue
			}
			if slices.Contains(writtenFormCodes, d.Code()) && !strings.HasPrefix(action.CodeAction.Title, returnTypeFixTitle) {
				continue // of these codes' fixes, --fix writes only a helper's return type (D500)
			}
			changes := *action.CodeAction.Edit.Changes
			if len(changes) != 1 || changes[uri] == nil {
				continue // a fix that edits another file is not one --fix applies
			}
			var edits []sourceEdit
			for _, edit := range changes[uri] {
				span := converters.FromLSPRangeToOriginal(file, edit.Range)
				edits = append(edits, sourceEdit{span.Pos(), span.End(), edit.NewText})
			}
			candidates = append(candidates, fileFix{d.Code(), edits, key})
			break
		}
	}
	// Take the fixes in source order whose edits overlap no fix taken.
	slices.SortStableFunc(candidates, func(a, b fileFix) int { return firstEdit(a.edits) - firstEdit(b.edits) })
	var taken []sourceEdit
	p := proposal{file: file}
	for _, candidate := range candidates {
		if slices.ContainsFunc(candidate.edits, func(e sourceEdit) bool { return overlapsAny(e, taken) }) {
			continue
		}
		taken = append(taken, candidate.edits...)
		p.fixes = append(p.fixes, candidate)
	}
	return p
}

// firstEdit returns the earliest start of edits.
func firstEdit(edits []sourceEdit) int {
	first := -1
	for _, e := range edits {
		if first < 0 || e.start < first {
			first = e.start
		}
	}
	return first
}

// overlapsAny reports whether e overlaps an edit of taken. Two insertions at
// one place overlap too, since their order would be ambiguous.
func overlapsAny(e sourceEdit, taken []sourceEdit) bool {
	for _, t := range taken {
		if e.start < t.end && t.start < e.end || e.start == t.start || e.start == e.end && t.start <= e.start && e.start <= t.end || t.start == t.end && e.start <= t.start && t.start <= e.end {
			return true
		}
	}
	return false
}

// applyEdits applies edits, which do not overlap, to text.
func applyEdits(text string, edits []sourceEdit) string {
	edits = slices.Clone(edits)
	slices.SortFunc(edits, func(a, b sourceEdit) int { return b.start - a.start })
	for _, e := range edits {
		text = text[:e.start] + e.text + text[e.end:]
	}
	return text
}

// withoutUnusedEffectImports removes from text, a file the fixes changed
// from original, each import binding of effect or one of its modules that
// original's code used and text's does not.
func withoutUnusedEffectImports(name tspath.RootedFilePath, original, text string) (string, bool) {
	parse := func(source string) *ast.SourceFile {
		return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: name, PathKey: tspath.CaseSensitive.PathKey(tspath.RootedPath(name))}, source, core.ScriptKindTS)
	}
	before, after := parse(original), parse(text)
	names := map[string]bool{}
	for _, b := range importBindingsOf(after) {
		// A specifier that is no string, as error recovery can leave one,
		// names no module.
		if module := b.declaration.ModuleSpecifier(); module != nil && ast.IsStringLiteral(module) && (module.Text() == "effect" || strings.HasPrefix(module.Text(), "effect/")) {
			names[b.name] = true
		}
	}
	if len(names) == 0 {
		return "", false
	}
	_, used := identifierUses(before, nil, names, nil)
	_, still := identifierUses(after, nil, names, nil)
	gone := map[string]int{}
	for name := range names {
		if used[name] > 0 && still[name] == 0 {
			gone[name] = used[name]
		}
	}
	if len(gone) == 0 {
		return "", false
	}
	edits := unusedImportEdits(after, nil, gone)
	if len(edits) == 0 || !editsPreserveComments(text, edits) {
		return "", false
	}
	return applyEdits(text, edits), true
}

// fixHost is the language service host of a fix: a program on disk, with no
// editor.
type fixHost struct {
	program    *compiler.Program
	converters *lsconv.Converters
}

func (h fixHost) CaseSensitivity() tspath.CaseSensitivity { return tspath.CaseSensitive }
func (h fixHost) ReadFile(path tspath.RootedFilePath) (string, bool) {
	if file := h.program.GetSourceFile(path); file != nil {
		return file.Text(), true
	}
	return "", false
}
func (h fixHost) Converters() *lsconv.Converters                                { return h.converters }
func (h fixHost) GetPreferences(string) lsutil.UserPreferences                  { return lsutil.UserPreferences{} }
func (h fixHost) GetECMALineInfo(tspath.RootedFilePath) *sourcemap.ECMALineInfo { return nil }
func (h fixHost) AutoImportRegistry() *autoimport.Registry                      { return nil }
func (h fixHost) ReadDirectory(tspath.RootedDirectoryPath, []string, []string, []string, int) []tspath.RootedFilePath {
	return nil
}
func (h fixHost) GetDirectories(tspath.RootedDirectoryPath) []string { return nil }
func (h fixHost) DirectoryExists(tspath.RootedDirectoryPath) bool    { return false }
func (h fixHost) FileExists(tspath.RootedFilePath) bool              { return false }

// Migrate the selected config and its extends chain, including JSONC bases.
func migrateSeverityConfigs(sys tsc.System, name tspath.RootedFilePath) error {
	path := sys.FS().CaseSensitivity().PathKey(tspath.RootedPath(name))
	config, _ := tsoptions.GetParsedCommandLineOfConfigFilePath(name, path, nil, nil, sys.FS(), &tsc.ExtendedConfigCache{})
	names := []tspath.RootedFilePath{name}
	if config != nil {
		names = append(names, config.ExtendedSourceFiles()...)
	}
	seen := map[tspath.RootedFilePath]bool{}
	for _, name := range names {
		if seen[name] {
			continue
		}
		seen[name] = true
		text, ok := sys.FS().ReadFile(name)
		if !ok {
			continue
		}
		if fixed, changed := tsoptions.MigrateLegacySeverities(name, text); changed {
			info, err := os.Stat(name.AsString())
			if err != nil {
				return err
			}
			if err := os.WriteFile(name.AsString(), []byte(fixed), info.Mode().Perm()); err != nil {
				return err
			}
			fmt.Fprintf(sys.Writer(), "vibelang --fix: %s: migrated vibelang.diagnostics to vibe.severities.\n", relativeName(sys, name))
		}
	}
	return nil
}
