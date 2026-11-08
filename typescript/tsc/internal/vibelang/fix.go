package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/ls/autoimport"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
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
// where it stands. --only limits a run to the modules it lists (fix_only.go).
// In build mode each project repairs its own files in dependency order.
// --fix cannot be combined with --watch.

// vipMigrationFixCodes are the codes whose quick fixes migrate code to an
// accepted VIP, which --fix-migration-only applies too.
var vipMigrationFixCodes []int32

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

// A fileFix is one diagnostic's quick fix: its code, its edits, and the key
// that names it across rounds, its code and the text it replaces.
type fileFix struct {
	code   int32
	edits  []sourceEdit
	key    string
	label  string // when set, the fix counts as a rewrite of this kind rather than under code: a native diagnostic has no EK code to count (fix_binding_rename.go)
	native bool   // the diagnostic code is TS rather than EK
	// siteStart and siteEnd, when sited, are the span of the diagnostic.
	siteStart int
	siteEnd   int
	sited     bool
	// scattered edits are separate sites, as a rename's uses are. A refusal
	// holds each of them, not the text between them.
	scattered bool
}

// A declinedSite is a diagnostic fileFixes found no fix for, or whose fix
// was refused before, by key.
type declinedSite struct {
	start  int
	end    int
	code   int32
	key    string
	reason string
}

// A proposal is one round's fixes of a file, whose edits do not overlap.
type proposal struct {
	file         *ast.SourceFile
	fixes        []fileFix
	cleanImports bool
	// declared is the imports file's declaration file writes, by
	// declaredImportKey, which the import cleanup keeps.
	declared map[string]bool
	declined []declinedSite // fileFixes' diagnostics without a fix
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
