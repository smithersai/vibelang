package vibelang

import (
	"cmp"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
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
// error the original did not, by file, code, and message, or by file, code,
// and span, a span after or before a fix's edits taken where it lay before
// them (an error whose message a fix makes more precise is not new); when the
// round as a whole would add one, the errors say which fixes add them: a
// fix whose own text holds an added error is set aside, an error elsewhere
// is traced to the fix whose text holds a declaration it reads, and the
// rest is checked again (fix_gate.go). Each fix that adds an error is
// refused, named with the first error it adds, and not tried again; an
// edit refused on its own is refused without a check when a later round
// offers it again to the same texts. A round so costs a few checks of the
// program however many fixes it refuses, and the programs share the files
// no fix edited. After the last round, it writes what the prelude makes
// shorter
// (fix_prelude.go): it removes the imports of modules the prelude supplies
// (D310, D311) and writes M.M as M where a module's name names its service,
// keeping each file's rewrites only when the program then reports no error
// it did not before. Then an import of effect or one of its modules that
// the fixes left unused is removed. The rounds and rewrites repeat until
// no fix applies, so a completed run reaches a fixed point. The command
// writes each verified state (fix_keep.go), preserving checked fixes when
// interrupted; a second run finishes the work. If a pass repeats a source
// state, or fixes still apply at fixPassLimit, the run reports an error.
// The fix of the retired try(…) hatch (EK4616, VIP-5) runs under
// --fix-migration-only too. --fix-vip-only applies only the VIP
// migrations: that fix, then try before each call that runs where it stands
// (fix_try.go), which keeps the call's meaning while every call still runs
// where it stands. --fix cannot be combined with --build or --watch.

// vipMigrationFixCodes are the codes whose quick fixes migrate code to an
// accepted VIP, which --fix-migration-only applies too.
var vipMigrationFixCodes []int32

// maxTryRounds bounds the VIP-1 migration's try rounds: each round marks
// the functions whose calls the round before tried, so a chain of calls
// through n unmarked functions takes n+1 rounds.
const maxTryRounds = 16

// FixFlag is the command line flag that applies the quick fixes.
const FixFlag = "--fix"

// FixOptions scopes repository migration tools without also rewriting the
// TypeScript-style teaching examples or their explicit imports (D382).
// VIPOnly applies the VIP migrations and nothing else. CheckEachFix checks
// each fix on its own instead of a round together: the oracle the fix gate
// is fuzzed against, which no command line sets. Verified, when set, is
// called with the text of each file the fixes change each time the gate
// verifies them together: after a round, after each set of a round's fixes
// it keeps, and after each later rewrite (fix_keep.go). Progress, when
// set, receives a line on what the run is doing at most once each
// ProgressEvery, or each fixProgressEvery when that is 0 (fix_progress.go);
// the command line sets it to stderr. IsolationChecks and CheckpointFirst,
// when not 0, replace fixIsolationChecks and fixCheckpointFirst
// (fix_gate.go): FuzzFixGateBounds varies them, and no command line sets
// them.
type FixOptions struct {
	MigrationOnly, VIPOnly, CheckEachFix bool
	Verified                             func(texts map[tspath.RootedFilePath]string)
	Progress                             io.Writer
	ProgressEvery                        time.Duration
	IsolationChecks, CheckpointFirst     int
}

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
// sys's writer. It returns a nonzero exit status when it cannot run or
// fixes still apply at the pass limit; compilation diagnostics are reported
// by the subsequent compilation.
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
	configDiagnostics := errors
	if config != nil {
		configDiagnostics = slices.Concat(configDiagnostics, config.GetConfigFileParsingDiagnostics())
	}
	configFS, configChanges := sidecarConfigFixes(sys.FS(), configDiagnostics)
	if len(configChanges) > 0 {
		config, errors = tsoptions.GetParsedCommandLineOfConfigFilePath(configFileName, path, commandLine.CompilerOptions(), nil, configFS, &tsc.ExtendedConfigCache{})
	}
	if len(errors) > 0 || config == nil {
		return 0 // the compilation reports them
	}
	run, stop := context.WithCancel(ctx)
	defer stop()
	keeper := &fixKeeper{sys: sys, config: configChanges, stop: stop, last: map[tspath.RootedFilePath]string{}, original: map[tspath.RootedFilePath]string{}}
	options.Verified = keeper.keep
	if options.Progress == nil {
		options.Progress = sys.ErrorWriter()
	}
	options.Progress = keeperWriter{keeper, options.Progress}
	// A check runs to its end once it starts (FixProjectWithOptions), and
	// on a large package one takes an hour: t3code's server ignored SIGTERM
	// that long, and its driver killed it. The fixes it verified are on
	// disk, so a stopped run returns at once, after a write under way; the
	// gate it leaves writes nothing more and ends with the process.
	finished := make(chan *FixResult, 1)
	fixRuns.Add(1)
	go func() {
		defer fixRuns.Done()
		finished <- FixProjectWithOptions(run, configFS, sys.DefaultLibraryPath(), config, options)
	}()
	var result *FixResult
	select {
	case result = <-finished:
	case <-ctx.Done():
		kept := keeper.close()
		fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: interrupted; %s.\n", kept)
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	if keeper.err != nil {
		fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: %v\n", keeper.err)
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	if ctx.Err() != nil {
		fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: interrupted; %s.\n", keeper.kept())
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	if result.Err != nil {
		fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: %v; %s.\n", result.Err, keeper.kept())
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	texts := map[tspath.RootedFilePath]string{}
	for _, name := range result.Order {
		texts[name] = result.Files[name].Text
	}
	if keeper.keep(texts); keeper.err == nil {
		keeper.writeConfig()
	}
	if keeper.err != nil {
		fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: %v\n", keeper.err)
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	reportSidecarConfigFixes(sys, configChanges)
	result.Report(sys.Writer(), func(name tspath.RootedFilePath) string { return relativeName(sys, name) })
	if n := len(result.Remaining); n > 0 {
		fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: stopped after %d %s with %d %s still applying; run vibelang --fix again.\n", fixPassLimit, plural(fixPassLimit, "pass", "passes"), n, plural(n, "fix", "fixes"))
		return int(tsc.ExitStatusDiagnosticsPresent_OutputsGenerated)
	}
	if refused := result.refusedTries(); options.VIPOnly && refused > 0 {
		return refusedTries(sys, configFileName, refused)
	}
	return 0
}

// FixStatusRefused is what FixWithOptions returns when the VIP-1 migration
// refused a call. The command still compiles, so each refused site shows its
// error, and then exits with FixRefusedExit at least.
const FixStatusRefused = -1

// FixRefusedExit is the least exit status of a --fix-vip-only run that
// refused a call.
const FixRefusedExit = int(tsc.ExitStatusDiagnosticsPresent_OutputsGenerated)

// refusedTries makes EK4802 an error in the project's config, with a comment
// that says why, when --fix-vip-only refused calls it can't tell ran before
// VIP-1 (decided detail 274): such a call returns its program now, which
// EK4802 otherwise only warns about. The owner removes the setting once a
// run refuses none.
func refusedTries(sys tsc.System, configFileName tspath.RootedFilePath, refused int) int {
	why := fmt.Sprintf("vibelang --fix-vip-only refused %d %s that may have run before VIP-1 (decided detail 274): EK4802 is an error until each is migrated by hand; remove this setting when --fix-vip-only refuses none.", refused, plural(refused, "call", "calls"))
	text, ok := sys.FS().ReadFile(configFileName)
	if !ok {
		fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: can't read %s to make EK4802 an error.\n", relativeName(sys, configFileName))
		return FixStatusRefused
	}
	if updated, changed := tsoptions.SetVibeSeverity(configFileName, text, "EK4802", "error", why); changed {
		if err := sys.FS().WriteFile(configFileName, updated); err != nil {
			fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: can't write %s: %v\n", relativeName(sys, configFileName), err)
			return FixStatusRefused
		}
		fmt.Fprintf(sys.Writer(), "vibelang --fix: %s: EK4802 is now an error: %s\n", relativeName(sys, configFileName), why)
	}
	return FixStatusRefused
}

// refusedTries counts the calls the VIP-1 migration refused to decide.
func (r *FixResult) refusedTries() int {
	n := 0
	for _, refusal := range r.Refused {
		if refusal.Rewrite == tryLabel {
			n++
		}
	}
	return n
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
	Rewrites map[string]int // source rewrites applied, by kind
}

// A FixRefusal is a fix that would add an error.
type FixRefusal struct {
	File    tspath.RootedFilePath
	Line    int // 1-based, in the text the fix was tried on
	Code    int32
	Label   string // a source migration without a diagnostic
	Rewrite string // a rewrite's label, as try, when no diagnostic's fix was refused
	Error   string // the first error the fix would add, or for a rewrite why it was not written
}

// A FixRemaining is a fix that still applies after the pass limit.
type FixRemaining struct {
	File tspath.RootedFilePath
	Line int    // 1-based, in the fixed text
	Fix  string // EK4841, or a prelude rewrite's kind (fix_prelude.go)
}

// FixResult is what FixProject did.
type FixResult struct {
	Files     map[tspath.RootedFilePath]*FixedFile
	Order     []tspath.RootedFilePath
	Refused   []FixRefusal
	Remaining []FixRemaining // the fixes that still apply after fixPassLimit passes
	Err       error          // normalization could not reach a fixed point
}

// Report writes one line per fixed file, per refusal and per fix that still
// applies, and a summary.
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
			parts = append(parts, fixCodeName(code)+" ×"+strconv.Itoa(fixed.Counts[code]))
		}
		kinds := []string{tryLabel, effectLabel, untriedLabel, preludeImportLabel, preludeKeyLabel, isBindingRenameLabel}
		var otherKinds []string
		for kind := range fixed.Rewrites {
			if !slices.Contains(kinds, kind) {
				otherKinds = append(otherKinds, kind)
			}
		}
		slices.Sort(otherKinds)
		for _, kind := range append(kinds, otherKinds...) {
			if n := fixed.Rewrites[kind]; n > 0 {
				parts = append(parts, kind+" ×"+strconv.Itoa(n))
				count += n
			}
		}
		total += count
		fmt.Fprintf(w, "vibelang --fix: %s: %d %s (%s)\n", name(file), count, plural(count, "fix", "fixes"), strings.Join(parts, ", "))
	}
	for _, refusal := range r.Refused {
		if refusal.Rewrite != "" {
			fmt.Fprintf(w, "vibelang --fix: %s:%d: %s not written: %s\n", name(refusal.File), refusal.Line, refusal.Rewrite, refusal.Error)
			continue
		}
		code := refusal.Label
		if code == "" {
			code = fixCodeName(refusal.Code)
		}
		fmt.Fprintf(w, "vibelang --fix: %s:%d: %s not fixed: the fixed program would report %s\n", name(refusal.File), refusal.Line, code, refusal.Error)
	}
	for _, remaining := range r.Remaining {
		fmt.Fprintf(w, "vibelang --fix: %s:%d: %s still applies after %d %s\n", name(remaining.File), remaining.Line, remaining.Fix, fixPassLimit, plural(fixPassLimit, "pass", "passes"))
	}
	fmt.Fprintf(w, "vibelang --fix: %d %s in %d %s", total, plural(total, "fix", "fixes"), len(r.Order), plural(len(r.Order), "file", "files"))
	if len(r.Refused) > 0 {
		fmt.Fprintf(w, "; %d %s refused", len(r.Refused), plural(len(r.Refused), "fix", "fixes"))
	}
	if n := len(r.Remaining); n > 0 {
		fmt.Fprintf(w, "; %d %s still %s", n, plural(n, "fix", "fixes"), plural(n, "applies", "apply"))
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

// fixPassLimit bounds the passes of a --fix run, as ESLint's --fix bounds
// its passes at ten. A run still applying fixes at the limit stops, keeps
// what it fixed, and reports the fixes that still apply.
var fixPassLimit = 10

func FixProjectWithOptions(ctx context.Context, fs vfs.FS, libraryPath tspath.RootedDirectoryPath, config *tsoptions.ParsedCommandLine, options FixOptions) *FixResult {
	result := &FixResult{Files: map[tspath.RootedFilePath]*FixedFile{}}
	// A checker that sees its context canceled panics when it is asked
	// again, so the checks run to their end and ctx is tested between them.
	done := ctx
	ctx = context.WithoutCancel(ctx)
	progress := newFixProgress(options.Progress, options.ProgressEvery)
	defer progress.close()
	// The files options.Verified writes are read as they were: the run's
	// programs read their fixed text from its overlay, and a fixed file's
	// Original is the text before the run.
	originals := &collections.SyncMap[tspath.RootedFilePath, string]{}
	disk := fs
	fs = wrapvfs.Wrap(disk, wrapvfs.Replacements{ReadFile: func(name tspath.RootedFilePath) (string, bool) {
		if text, ok := originals.Load(name); ok {
			return text, true
		}
		return disk.ReadFile(name)
	}})
	verified := func(state map[tspath.RootedFilePath]string) {
		if options.Verified == nil {
			return
		}
		for name := range state {
			if _, ok := originals.Load(name); !ok {
				if text, ok := disk.ReadFile(name); ok {
					originals.Store(name, text)
				}
			}
		}
		options.Verified(state)
	}
	texts := map[tspath.RootedFilePath]string{}
	sourceFiles, _ := disk.(fixSourceFiles)
	parsed := &fixParsedFiles{sourceFiles: sourceFiles}
	// When a round's fixes pass together, the next round's program is the one
	// the gate just checked them in; building it again checked the project
	// twice per round. A program does not change once built, so build returns
	// the last one when the overlay is the same.
	var lastOverlay [32]byte
	var last *compiler.Program
	build := func(overlay map[tspath.RootedFilePath]string) *compiler.Program {
		key := overlayKey(overlay)
		if last == nil || key != lastOverlay {
			progress.building()
			last = nil // the last program can go while the next is built
			last, lastOverlay = fixProgram(fs, libraryPath, config, parsed, overlay), key
		}
		return last
	}
	program := build(texts)
	if done.Err() != nil {
		return result
	}
	// fresh builds a program no check has read, as the last one: on
	// opencode's core, a box of 12 GiB ran out of memory when it held
	// both (2026-11-02).
	fresh := func(overlay map[tspath.RootedFilePath]string) *compiler.Program {
		progress.building()
		last = nil
		last, lastOverlay = fixProgram(fs, libraryPath, config, parsed, overlay), overlayKey(overlay)
		return last
	}
	g := &fixGate{ctx: ctx, done: done, build: build, fresh: fresh, baseline: baselineOf(ctx, program), refused: map[string]bool{}, alone: map[[32]byte]map[string]int{}, verified: verified, progress: progress, isolationChecks: options.IsolationChecks, checkpointFirst: options.CheckpointFirst}
	var roundRefusals []FixRefusal
	refuse := func(refusal FixRefusal, key string) {
		g.refused[key] = true
		roundRefusals = append(roundRefusals, refusal)
		result.Refused = append(result.Refused, refusal)
	}
	// retryRefused forgets the round refusals, each of which held for the
	// program it was tried on, and adds program's errors to the baseline: the
	// gate accepted them, and each is held by the span it has now. A fix refused
	// before later fixes may apply now, as it would to a second --fix (chapter 7:
	// running it again changes nothing). One that does not is refused again.
	retryRefused := func(program *compiler.Program) {
		for _, r := range roundRefusals {
			if i := slices.Index(result.Refused, r); i >= 0 {
				result.Refused = slices.Delete(result.Refused, i, i+1)
			}
		}
		roundRefusals = nil
		g.refused = map[string]bool{}
		g.baseline = g.baseline.with(baselineOf(ctx, program))
	}
	// propose returns a round's fixes: in each fixable file of program, the
	// fixes options select whose edits do not overlap.
	propose := func(program *compiler.Program) []proposal {
		var proposals []proposal
		for _, file := range fixableFiles(program) {
			var p proposal
			if options.VIPOnly {
				p = fileFixes(ctx, program, file, g.refused, vipMigrationFixCodes)
				p = p.withFixes(fiberNameMigrationFixes(ctx, program, file, g.refused))
			} else {
				p = pipeConditionalFixes(file, g.refused)
				p = p.withFixes(dualBlockMigrationFixes(ctx, program, file, g.refused, refuse))
				p = p.withFixes(vipTypeMigrationFixes(ctx, program, file, g.refused))
				p = p.withFixes(ambiguousRootMigrationFixes(ctx, program, file, g.refused))
				p = p.withFixes(bindingRenameMigrationFixes(ctx, program, file, g.refused))
				p = p.withFixes(fiberNameMigrationFixes(ctx, program, file, g.refused))
				if options.MigrationOnly && len(p.fixes) == 0 {
					p = sourceFileMigrationFixes(ctx, program, file, g.refused)
				}
				if len(p.fixes) == 0 && !options.MigrationOnly {
					p = fileFixes(ctx, program, file, g.refused, tsFormFixCodes)
					// Pipe and stage rewrites follow rules that consume their operands.
					if len(p.fixes) == 0 {
						p = effectPipeFixes(ctx, program, file, g.refused, refuse)
					}
					if len(p.fixes) == 0 {
						p = effectStageFixes(ctx, program, file, g.refused)
					}
				} else if len(p.fixes) == 0 {
					p = fileFixes(ctx, program, file, g.refused, vipMigrationFixCodes)
				}
			}
			p.cleanImports = !options.MigrationOnly && !options.VIPOnly
			if len(p.fixes) > 0 && (p.cleanImports || removesImport(file, p.fixes)) {
				p.declared = declarationImportKeys(ctx, program, file)
				p.fixes = keepDeclaredImports(file, p.fixes, p.declared)
			}
			if len(p.fixes) > 0 {
				proposals = append(proposals, p)
			}
		}
		return proposals
	}
	finish := func() *FixResult {
		slices.SortFunc(result.Order, tspath.RootedFilePath.Compare)
		return result
	}
	round := 0
	changed := false // the program changed since the refusals were last retried
	seen := map[[32]byte]bool{fixState(program): true}
	for pass := 1; ; pass++ {
		// The rounds: each takes the fixes that apply, until none does.
		for {
			if done.Err() != nil {
				return result
			}
			round++
			progress.enter("round", round, fixesApplied(result), len(result.Refused), "finding fixes")
			proposals := propose(program)
			if len(proposals) == 0 {
				if changed && len(roundRefusals) > 0 {
					changed = false
					retryRefused(program)
					continue
				}
				break
			}
			offered := 0
			for _, p := range proposals {
				offered += len(p.fixes)
			}
			progress.offered(offered)
			accept := g.accept
			if options.CheckEachFix {
				accept = g.acceptEach
			}
			refusedBefore := len(roundRefusals)
			accepted := accept(texts, proposals, refuse)
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
					if f.label != "" {
						if fixed.Rewrites == nil {
							fixed.Rewrites = map[string]int{}
						}
						fixed.Rewrites[f.label]++
					} else {
						fixed.Counts[f.code]++
					}
				}
				texts[name] = fixed.Text
			}
			changed = changed || refusedBefore > 0 // a fix accepted beside a refusal changes nothing it was tried with
			verified(texts)
			program = build(texts)
			state := fixState(program)
			if seen[state] {
				result.Err = fmt.Errorf("normalization repeated a source state instead of reaching a fixed point (automatic fix round, pass %d)", pass)
				return result
			}
			seen[state] = true
		}
		if options.MigrationOnly {
			return finish()
		}
		// The rewrites after the rounds, on program, the last round's.
		before := maps(texts, nil)
		beforeState := fixState(program)
		// VIP-2: old program-building do expressions become explicit Effects
		// (rewriteDoPrograms, fix_effect.go), before the rewrites that read program.
		if done.Err() == nil {
			rewriteDoPrograms(g, fs, program, texts, result)
			verified(texts)
			if !sameTexts(before, texts) {
				program = build(texts)
			}
		}
		if options.VIPOnly {
			// try before each call that ran where it stood before VIP-1, and effect on
			// each function the old compiler made an Effect function (fix_try.go).
			// A function marked effect returns its Effect now, so the calls of it
			// that ran get their try in the next round.
			if done.Err() == nil {
				var refused []FixRefusal
				for round := 1; round <= maxTryRounds && done.Err() == nil; round++ {
					progress.enter("try", round, fixesApplied(result), len(result.Refused), "finding rewrites")
					var wrote bool
					wrote, refused = rewriteTries(g, fs, build(texts), texts, result)
					verified(texts)
					if !wrote {
						break
					}
				}
				// A later pass meets the same refusals again; report each once.
				for _, r := range refused {
					if !slices.Contains(result.Refused, r) {
						result.Refused = append(result.Refused, r)
					}
				}
			}
		} else {
			// What the prelude makes shorter (D310, D311).
			if done.Err() == nil {
				progress.enter("prelude", 0, fixesApplied(result), len(result.Refused), "finding rewrites")
				rewritePrelude(g, fs, program, texts, result)
				verified(texts)
			}
			// Remove the effect imports that the fixes left unused.
			if done.Err() == nil {
				removeUnusedEffectImports(g, program, texts, result)
			}
		}
		if done.Err() != nil {
			return finish()
		}
		if sameTexts(before, texts) {
			break // the pass changed nothing: no fix applies
		}
		program = build(texts)
		state := fixState(program)
		if state == beforeState {
			// A read can cache an unchanged file in the sparse overlay.
			// Compare the actual source state before treating that as a cycle.
			break
		}
		if seen[state] {
			result.Err = fmt.Errorf("normalization repeated a source state instead of reaching a fixed point (normalization rewrites, pass %d)", pass)
			return result
		}
		seen[state] = true
		changed = true
		if pass == fixPassLimit {
			result.Remaining = remainingFixes(ctx, program, texts, fresh, propose, options)
			break
		}
	}
	return finish()
}

// removeUnusedEffectImports removes, from each file the fixes changed, the
// import bindings of effect and its modules that the fixes left unused
// (withoutUnusedEffectImports), except those the file's declaration file in
// program writes, when the program then adds no error to g's baseline, and
// records the texts in result and texts.
func removeUnusedEffectImports(g *fixGate, program *compiler.Program, texts map[tspath.RootedFilePath]string, result *FixResult) {
	cleaned := map[tspath.RootedFilePath]string{}
	for _, name := range result.Order {
		if _, ok := withoutUnusedEffectImports(name, result.Files[name].Original, texts[name], nil); !ok {
			continue
		}
		var declared map[string]bool
		if file := program.GetSourceFile(name); file != nil {
			declared = declarationImportKeys(g.ctx, program, file)
		}
		if text, ok := withoutUnusedEffectImports(name, result.Files[name].Original, texts[name], declared); ok {
			cleaned[name] = text
		}
	}
	if len(cleaned) == 0 {
		return
	}
	g.progress.enter("imports", 0, fixesApplied(result), len(result.Refused), "removing unused imports")
	if _, ok := g.passes(texts, cleaned); !ok {
		return
	}
	for name, text := range cleaned {
		result.Files[name].Text = text
		texts[name] = text
	}
	g.verified(texts)
}

// sameTexts reports whether a and b hold the same files with the same texts.
func sameTexts(a, b map[tspath.RootedFilePath]string) bool {
	if len(a) != len(b) {
		return false
	}
	for name, text := range a {
		if other, ok := b[name]; !ok || other != text {
			return false
		}
	}
	return true
}

// remainingFixes returns the fixes that still apply to program, which the
// pass limit stopped --fix from applying: the next round's fixes, as
// propose takes them, and the prelude rewrites, by file and line.
func remainingFixes(ctx context.Context, program *compiler.Program, texts map[tspath.RootedFilePath]string, fresh func(map[tspath.RootedFilePath]string) *compiler.Program, propose func(*compiler.Program) []proposal, options FixOptions) []FixRemaining {
	var remaining []FixRemaining
	for _, p := range propose(program) {
		for _, f := range p.fixes {
			line, _ := scannerLineOf(p.file, firstEdit(f.edits))
			remaining = append(remaining, FixRemaining{File: p.file.FileName(), Line: line + 1, Fix: fixCodeName(f.code)})
		}
	}
	if !options.VIPOnly {
		for name, r := range preludeRewriteProject(ctx, program, texts, fresh) {
			line, _ := scannerLineOf(program.GetSourceFile(name), firstEdit(r.edits))
			kind := preludeImportLabel
			if r.imports == 0 {
				kind = preludeKeyLabel
			}
			remaining = append(remaining, FixRemaining{File: name, Line: line + 1, Fix: kind})
		}
	}
	slices.SortFunc(remaining, func(a, b FixRemaining) int {
		if c := a.File.Compare(b.File); c != 0 {
			return c
		}
		return cmp.Compare(a.Line, b.Line)
	})
	return remaining
}

// fixesApplied counts the fixes and rewrites result holds.
func fixesApplied(result *FixResult) int {
	n := 0
	for _, file := range result.Files {
		for _, c := range file.Counts {
			n += c
		}
		for _, c := range file.Rewrites {
			n += c
		}
	}
	return n
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
// pass together, else each file's that adds none to those kept before it,
// as fixGate.accept keeps a round's fixes. It records them in result and
// texts.
func rewritePrelude(g *fixGate, fs vfs.FS, program *compiler.Program, texts map[tspath.RootedFilePath]string, result *FixResult) {
	rewrites := preludeRewriteProject(g.ctx, program, texts, g.fresh)
	if len(rewrites) == 0 {
		return
	}
	var names []tspath.RootedFilePath
	for name, r := range rewrites {
		if editsPreserveComments(program.GetSourceFile(name).Text(), r.edits) {
			names = append(names, name)
		}
	}
	slices.SortFunc(names, tspath.RootedFilePath.Compare)
	// The gate keeps the files' rewrites that add no error, as it keeps a
	// round's fixes: a rewrite is one fix, and one that adds an error is
	// left out, unreported. Checking the program once for each file when
	// the rewrites together added an error took about a minute a file on
	// a 60-module slice of t3code's apps/server, and both the files and
	// the check grow with the project (2026-11-01).
	proposals := make([]proposal, 0, len(names))
	for _, name := range names {
		proposals = append(proposals, proposal{file: program.GetSourceFile(name), fixes: []fileFix{{edits: rewrites[name].edits, key: "prelude: " + name.AsString()}}})
	}
	g.progress.offered(len(proposals))
	kept := map[tspath.RootedFilePath]string{}
	for _, p := range g.accept(texts, proposals, func(FixRefusal, string) {}) {
		kept[p.file.FileName()] = p.text()
	}
	if g.done.Err() != nil {
		return
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

// overlayKey fingerprints overlay, its file names and texts in name order,
// framed by quoting as fixState frames them.
func overlayKey(overlay map[tspath.RootedFilePath]string) [32]byte {
	names := make([]tspath.RootedFilePath, 0, len(overlay))
	for name := range overlay {
		names = append(names, name)
	}
	slices.SortFunc(names, tspath.RootedFilePath.Compare)
	hash := sha256.New()
	for _, name := range names {
		fmt.Fprintf(hash, "%q%q", name.AsString(), overlay[name])
	}
	var key [32]byte
	copy(key[:], hash.Sum(nil))
	return key
}

// fixParsedFiles holds the files a --fix run has parsed, by parse options.
// A caller that already parsed a dependency may supply its immutable syntax.
// The fixer still reads current text and checks the complete parse options;
// every program and checker is fresh, and a stale tree is never reused.
type fixSourceFiles interface {
	GetSourceFile(ast.SourceFileParseOptions) *ast.SourceFile
}

type fixParsedFiles struct {
	collections.SyncMap[ast.SourceFileParseOptions, *ast.SourceFile]
	sourceFiles fixSourceFiles
}

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
	if h.parsed.sourceFiles != nil {
		if file := h.parsed.sourceFiles.GetSourceFile(opts); file != nil && file.ParseOptions() == opts && file.Text() == text {
			h.parsed.Store(opts, file)
			return file
		}
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

// errorCounts counts the errors of program (programErrors) by file, code,
// and message.
func errorCounts(ctx context.Context, program *compiler.Program) map[string]int {
	counts := map[string]int{}
	for _, d := range programErrors(ctx, program) {
		counts[errorKey(d)]++
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
	return file + ": " + errorCode(d) + ": " + d.String()
}

// errorCode is d's code as a diagnostic prints it: TS2345, EK1001.
func errorCode(d *ast.Diagnostic) string {
	source := d.Source()
	if source == "" {
		source = "TS"
	}
	if source == diagnosticSource {
		return fmt.Sprintf("EK%04d", d.Code())
	}
	return source + strconv.Itoa(int(d.Code()))
}

// errorSpanKey names d by its file, code, and span; "" for an error with no
// file.
func errorSpanKey(d *ast.Diagnostic) string {
	if d.File() == nil {
		return ""
	}
	return spanKeyAt(d, d.Pos())
}

func spanKeyAt(d *ast.Diagnostic, pos int) string {
	return fmt.Sprintf("%s: %s at %d+%d", d.File().FileName().AsString(), errorCode(d), pos, d.Len())
}

// An errorBaseline holds the errors a fix may not add to: the program's
// occurrences, counts by errorKey and errorSpanKey, and the text of each file
// that reports one, against which spanKeys places a later program's errors.
type errorBaseline struct {
	errors          []*ast.Diagnostic
	messages, spans map[string]int
	texts           map[string]string
}

func baselineOf(ctx context.Context, program *compiler.Program) errorBaseline {
	errors := programErrors(ctx, program)
	b := countErrors(errors, errorSpanKey)
	b.texts = map[string]string{}
	for _, d := range errors {
		if d.File() != nil {
			b.texts[d.File().FileName().AsString()] = d.File().Text()
		}
	}
	return b
}

// with returns b holding other's errors too, each key at the larger count.
func (b errorBaseline) with(other errorBaseline) errorBaseline {
	merged := errorBaseline{errors: slices.Concat(b.errors, other.errors), messages: map[string]int{}, spans: map[string]int{}, texts: map[string]string{}}
	for _, from := range []errorBaseline{b, other} {
		for key, count := range from.messages {
			merged.messages[key] = max(merged.messages[key], count)
		}
		for key, count := range from.spans {
			merged.spans[key] = max(merged.spans[key], count)
		}
		for name, text := range from.texts {
			merged.texts[name] = text
		}
	}
	return merged
}

func countErrors(errors []*ast.Diagnostic, spanKey func(*ast.Diagnostic) string) errorBaseline {
	b := errorBaseline{errors: errors, messages: map[string]int{}, spans: map[string]int{}}
	for _, d := range errors {
		b.messages[errorKey(d)]++
		if key := spanKey(d); key != "" {
			b.spans[key]++
		}
	}
	return b
}

// addedCounts returns how many of errors baseline does not hold, by
// errorKey. An error is held by its file, code, and message, or by its file,
// code, and span: a fix that makes a type more precise rewrites the message
// of an error the program already reported at the same place, and adds no
// error. In t3code, writing a schema helper's plain return type turns
// Effect<brand<…>> into brand<…> in a test's existing TS2345, which an
// unrelated helper causes. A span in a file a fix edits is compared where it
// lay before the edits (spanKeys).
func addedCounts(errors []*ast.Diagnostic, baseline errorBaseline) map[string]int {
	spanKey := baseline.spanKeys()
	// Each baseline occurrence has one owner, even when both its keys match.
	byMessage, bySpan := map[string][]int{}, map[string][]int{}
	owners := make([]int, len(baseline.errors))
	for i, d := range baseline.errors {
		byMessage[errorKey(d)] = append(byMessage[errorKey(d)], i)
		if span := errorSpanKey(d); span != "" {
			bySpan[span] = append(bySpan[span], i)
		}
		owners[i] = -1
	}
	messages, spans := make([]string, len(errors)), make([]string, len(errors))
	for i, d := range errors {
		messages[i], spans[i] = errorKey(d), spanKey(d)
	}
	// An augmenting path can move an earlier message match to a span match
	// (or vice versa), so a greedy choice cannot refuse a valid repair.
	seen := make([]int, len(baseline.errors))
	var match func(int, int) bool
	match = func(current, visit int) bool {
		for _, candidates := range [][]int{bySpan[spans[current]], byMessage[messages[current]]} {
			for _, old := range candidates {
				if seen[old] == visit {
					continue
				}
				seen[old] = visit
				if owners[old] < 0 || match(owners[old], visit) {
					owners[old] = current
					return true
				}
			}
		}
		return false
	}
	added := map[string]int{}
	for i := range errors {
		if !match(i, i+1) {
			added[messages[i]]++
		}
	}
	return added
}

// spanKeys returns errorSpanKey with each span moved back to where it lay in
// b's text of its file. A fix's edits move every span after them, so an
// error the edited program reports after the edits, or before them, keeps
// its baseline place: in t3code, annotating the first of two Config helpers
// a plain function calls moves the function's one EK9203, which now names
// the second call. A span inside the edited text has no baseline place: "".
func (b errorBaseline) spanKeys() func(*ast.Diagnostic) string {
	type ends struct{ prefix, suffix int }
	edited := map[string]ends{}
	return func(d *ast.Diagnostic) string {
		if d.File() == nil {
			return ""
		}
		name := d.File().FileName().AsString()
		before, ok := b.texts[name]
		now := d.File().Text()
		if !ok || before == now {
			return errorSpanKey(d)
		}
		e, ok := edited[name]
		if !ok {
			e.prefix, e.suffix = unchangedEnds(before, now)
			edited[name] = e
		}
		switch {
		case d.Pos()+d.Len() <= e.prefix:
			return errorSpanKey(d)
		case d.Pos() >= len(now)-e.suffix:
			return spanKeyAt(d, d.Pos()-len(now)+len(before))
		}
		return ""
	}
}

// unchangedEnds returns the lengths of the longest common prefix of a and b
// and of the longest common suffix of what follows it.
func unchangedEnds(a, b string) (prefix, suffix int) {
	n := min(len(a), len(b))
	for prefix < n && a[prefix] == b[prefix] {
		prefix++
	}
	for suffix < n-prefix && a[len(a)-1-suffix] == b[len(b)-1-suffix] {
		suffix++
	}
	return prefix, suffix
}

// newError returns an error program reports that baseline does not hold, as
// the line a refusal names, and true; or false.
func newError(ctx context.Context, program *compiler.Program, baseline errorBaseline) (string, bool) {
	added := addedErrors(ctx, program, baseline)
	if len(added) == 0 {
		return "", false
	}
	return added[0], true
}

// addedErrors returns the errors program reports that baseline does not
// hold (addedCounts), by errorKey, sorted.
func addedErrors(ctx context.Context, program *compiler.Program, baseline errorBaseline) []string {
	var added []string
	for key := range addedCounts(programErrors(ctx, program), baseline) {
		added = append(added, key)
	}
	slices.Sort(added)
	return added
}

// fixGate keeps the fixes whose edited program adds no error to baseline.
type fixGate struct {
	lastFailed *compiler.Program // complete rejected program whose errors guide the search
	ctx        context.Context   // never canceled: see FixProject
	done       context.Context   // canceled when the command is interrupted
	build      func(map[tspath.RootedFilePath]string) *compiler.Program
	// fresh builds a program that no check has read, which build may
	// return (gateRound.orderErrors); build when nil.
	fresh    func(map[tspath.RootedFilePath]string) *compiler.Program
	baseline errorBaseline
	refused  map[string]bool // fixes refused, by fixKey
	// verified is called with the texts of each set of fixes the gate
	// verifies together (FixOptions.Verified).
	verified func(map[tspath.RootedFilePath]string)
	// progress says on stderr what the run is doing (fix_progress.go).
	progress *fixProgress
	// alone holds the errors each fix refused on its own added, by
	// aloneKey: a later round that offers the same edit to the same texts
	// builds the same program, so it is refused without a check.
	alone map[[32]byte]map[string]int
	// isolationChecks and checkpointFirst replace fixIsolationChecks and
	// fixCheckpointFirst when not 0 (FixOptions).
	isolationChecks, checkpointFirst int
}

// passes reports whether the program with overlay over texts adds no error,
// and returns the first error it adds.
func (g *fixGate) passes(texts, overlay map[tspath.RootedFilePath]string) (string, bool) {
	g.progress.checkFiles(len(overlay))
	program := g.build(maps(texts, overlay))
	g.progress.label("")
	error, bad := newError(g.ctx, program, g.baseline)
	g.lastFailed = nil
	if bad {
		g.lastFailed = program
	}
	return error, !bad
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
	label string // when set, the fix counts as a rewrite of this kind rather than under code: a native diagnostic has no EK code to count (fix_binding_rename.go)
}

// A proposal is one round's fixes of a file, whose edits do not overlap.
type proposal struct {
	file         *ast.SourceFile
	fixes        []fileFix
	cleanImports bool
	// declared is the imports file's declaration file writes, by
	// declaredImportKey, which the import cleanup keeps.
	declared map[string]bool
}

// text returns the proposal's file with its fixes applied.
func (p proposal) text() string {
	var edits []sourceEdit
	for _, f := range p.fixes {
		edits = append(edits, f.edits...)
	}
	text := applyEdits(p.file.Text(), edits)
	// Check the complete proposed rewrite. Delaying this cleanup until after
	// acceptance would make noUnusedLocals reject a fix for its unused import.
	if p.cleanImports {
		if cleaned, ok := withoutUnusedEffectImports(p.file.FileName(), p.file.Text(), text, p.declared); ok {
			return cleaned
		}
	}
	return text
}

// fileFixes asks the language server for the quick fix of each safe
// diagnostic of file, one of codes, and applies the fixes whose edits do
// not overlap.
func fileFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool, codes []int32) proposal {
	var fixable []*ast.Diagnostic
	// Some VibeLang syntax errors have a recovered tree and an insertion-only
	// fix. Keep those fixes available when type checking is disabled, too.
	diagnostics := append(slices.Clone(program.GetSyntacticDiagnostics(ctx, file)), program.GetSemanticDiagnostics(ctx, file)...)
	seen := map[string]bool{}
	for _, d := range diagnostics {
		// Providers opt their native diagnostics in explicitly.
		if (d.Source() == diagnosticSource || d.Source() == "" && slices.Contains(nativeFixCodes, d.Code())) && slices.Contains(codes, d.Code()) && d.File() == file {
			// The syntactic and semantic lists can both carry one diagnostic;
			// identify it by position, not text, so two spellings of the same
			// type on different lines keep their own fixes.
			key := strconv.Itoa(int(d.Code())) + ":" + strconv.Itoa(d.Pos()) + ":" + strconv.Itoa(d.End())
			if !seen[key] {
				fixable = append(fixable, d)
				seen[key] = true
			}
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
			changes := *action.CodeAction.Edit.Changes
			if len(changes) != 1 || changes[uri] == nil {
				continue // a fix that edits another file is not one --fix applies
			}
			var edits []sourceEdit
			for _, edit := range changes[uri] {
				span := converters.FromLSPRangeToOriginal(file, edit.Range)
				edits = append(edits, sourceEdit{span.Pos(), span.End(), edit.NewText})
			}
			candidates = append(candidates, fileFix{code: d.Code(), edits: edits, key: key})
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
// original's code used and text's does not, except one that kept, the
// declaration file's imports by declaredImportKey, holds: the declaration
// keeps the import its TypeScript wrote (D501), so an Effect.fn the fixes
// turned into an effect arrow keeps import * as Effect from "effect/Effect"
// while the export's type names Effect.
func withoutUnusedEffectImports(name tspath.RootedFilePath, original, text string, kept map[string]bool) (string, bool) {
	parse := func(source string) *ast.SourceFile {
		return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: name, PathKey: tspath.CaseSensitive.PathKey(tspath.RootedPath(name))}, source, core.ScriptKindTS)
	}
	before, after := parse(original), parse(text)
	names := map[string]bool{}
	for _, b := range importBindingsOf(after) {
		// A specifier that is no string, as error recovery can leave one,
		// names no module.
		if module := b.declaration.ModuleSpecifier(); module != nil && ast.IsStringLiteral(module) && (module.Text() == "effect" || strings.HasPrefix(module.Text(), "effect/")) && !kept[declaredImportKey(module.Text(), b.name)] {
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
