package vibelang

import (
	"context"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// FixOnlyFlag limits a --fix run to the modules it lists. A migration
// rewrites a batch of a package: a run over the package also rewrote modules
// outside the batch, which a run stopped early left that way (alchemy's AWS
// SES/Contact lost an Effect.sync deferral, 2026-11-02), and its gate checks
// the whole program for each trial, so 27 modules of 6,876 took more than
// 20 minutes (alchemy-35, 2026-11-01).
const FixOnlyFlag = "--only"

// fixOnlyUsage says what --only takes.
const fixOnlyUsage = "--only takes a list of files: --only a.vibe,b.vibe or --only @list.txt"

// onlyArgument records the --only at args[i] and returns the index of the
// last argument it took. A flag with no value is reported by FixWithOptions,
// which has a system to write to.
func (o *FixOptions) onlyArgument(args []string, i int) int {
	o.onlyGiven = true
	if i+1 >= len(args) || strings.HasPrefix(args[i+1], "-") {
		o.onlyNoValue = true
		return i
	}
	o.onlyValues = append(o.onlyValues, args[i+1])
	return i + 1
}

// resolveOnly returns options with Only set from the command line's values.
// Paths are relative to the current directory, as files on a compiler
// command line are. A value is a comma-separated list, or @ and the name of
// a file with one path per line: a batch of thousands of modules passes
// Linux's limit on one argument, 128 KiB.
func (o FixOptions) resolveOnly(sys tsc.System) (FixOptions, error) {
	if !o.onlyGiven {
		return o, nil
	}
	if o.onlyNoValue {
		return o, errors.New(fixOnlyUsage)
	}
	if o.VIPOnly || o.MigrationOnly {
		return o, errors.New("--only takes ordinary --fix, not --fix-vip-only or --fix-migration-only: a project-wide migration changes what other modules mean, so it runs over the whole project")
	}
	cwd := sys.GetCurrentDirectory()
	o.Only = []tspath.RootedFilePath{}
	for _, value := range o.onlyValues {
		var names []string
		if list, ok := strings.CutPrefix(value, "@"); ok {
			text, ok := sys.FS().ReadFile(tspath.RootedFilePathFromAbsolute(tspath.GetNormalizedAbsolutePath(list, cwd)))
			if !ok {
				return o, fmt.Errorf("--only: cannot read the list %s", list)
			}
			names = strings.Split(text, "\n")
		} else {
			names = strings.Split(value, ",")
		}
		for _, name := range names {
			if name = strings.TrimSpace(name); name != "" {
				o.Only = append(o.Only, tspath.RootedFilePathFromAbsolute(tspath.GetNormalizedAbsolutePath(name, cwd)))
			}
		}
	}
	return o, nil
}

// A fixScope is the modules a --fix run may rewrite and whose errors its gate
// counts. A nil one is the whole project. Files are told apart by their real
// paths, so a list may name a module through a symbolic link.
type fixScope struct {
	fs     vfs.FS
	listed map[tspath.PathKey]tspath.RootedFilePath
	known  collections.SyncMap[tspath.RootedFilePath, bool]
}

// newFixScope returns the scope of only: nil, the whole project, when only is
// nil. A scope of no file is refused (check).
func newFixScope(fs vfs.FS, only []tspath.RootedFilePath) *fixScope {
	if only == nil {
		return nil
	}
	s := &fixScope{fs: fs, listed: make(map[tspath.PathKey]tspath.RootedFilePath, len(only))}
	for _, name := range only {
		s.listed[s.key(name)] = name
	}
	return s
}

func (s *fixScope) key(name tspath.RootedFilePath) tspath.PathKey {
	return s.fs.CaseSensitivity().PathKey(s.fs.Realpath(tspath.RootedPath(name)))
}

// includes reports whether the run may rewrite the file name.
func (s *fixScope) includes(name tspath.RootedFilePath) bool {
	if s == nil {
		return true
	}
	if known, ok := s.known.Load(name); ok {
		return known
	}
	_, listed := s.listed[s.key(name)]
	s.known.Store(name, listed)
	return listed
}

// fixable returns the files of program the run may rewrite.
func (s *fixScope) fixable(program *compiler.Program) []*ast.SourceFile {
	files := fixableFiles(program)
	if s == nil {
		return files
	}
	return slices.DeleteFunc(files, func(file *ast.SourceFile) bool { return !s.includes(file.FileName()) })
}

// errors returns the errors the gate counts: all of program's (programErrors)
// or, in a scope, those of its files and the program's own that name no other
// file. An unlisted module's errors decide nothing, and are not checked: the
// compilation after --fix reports them. So a fix a listed module takes is kept
// even if it breaks an unlisted module that imports it. Global diagnostics,
// which grow with what was checked, are left out too.
func (s *fixScope) errors(ctx context.Context, program *compiler.Program) []*ast.Diagnostic {
	if s == nil {
		return programErrors(ctx, program)
	}
	var errors []*ast.Diagnostic
	for _, d := range slices.Concat(program.GetConfigFileParsingDiagnostics(), program.GetProgramDiagnostics()) {
		if d.Category() == diagnostics.CategoryError && (d.File() == nil || s.includes(d.File().FileName())) {
			errors = append(errors, d)
		}
	}
	for _, file := range s.fixable(program) {
		for _, d := range slices.Concat(program.GetSyntacticDiagnostics(ctx, file), program.GetBindDiagnostics(ctx, file), program.GetSemanticDiagnostics(ctx, file)) {
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, d)
			}
		}
	}
	return errors
}

// check returns an error for an empty list, or naming the listed files
// program cannot rewrite: a list that names a file by mistake would otherwise
// fix nothing and exit 0.
func (s *fixScope) check(program *compiler.Program) error {
	if s == nil {
		return nil
	}
	if len(s.listed) == 0 {
		return errors.New("--only lists no file")
	}
	found := make(map[tspath.PathKey]bool, len(s.listed))
	for _, file := range s.fixable(program) {
		found[s.key(file.FileName())] = true
	}
	var missing []string
	for key, name := range s.listed {
		if !found[key] {
			missing = append(missing, name.AsString())
		}
	}
	if len(missing) == 0 {
		return nil
	}
	slices.Sort(missing)
	shown := missing[:min(len(missing), 5)]
	more := ""
	if n := len(missing) - len(shown); n > 0 {
		more = fmt.Sprintf(" and %d more", n)
	}
	return fmt.Errorf("--only lists %d %s that %s not .vibe %s of this project: %s%s", len(missing), plural(len(missing), "file", "files"), plural(len(missing), "is", "are"), plural(len(missing), "module", "modules"), strings.Join(shown, ", "), more)
}

// partial says what a listed run did not do, for its report: the modules it
// rewrote were checked, and the others were not, so a clean run is no verdict
// on the project.
func (s *fixScope) partial(w io.Writer) {
	fmt.Fprintf(w, "vibelang --fix: partial repair: --only limited it to %d %s and did not check the rest; this is not a verified project.\n", len(s.listed), plural(len(s.listed), "module", "modules"))
}
