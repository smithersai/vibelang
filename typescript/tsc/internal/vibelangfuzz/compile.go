package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// An Order is the order in which a compilation asks the program for its
// diagnostics and its output. The checker is lazy: what it computes first
// can decide what it reports later, so a compiler whose results depend on
// the order has a bug that tsc, the language server and the bundler plugins
// each meet in a different form (Chapter 28: they see the same diagnostics).
type Order int

const (
	// OrderTsc asks as tsc does: syntactic, global, semantic and declaration
	// diagnostics for the whole program, then emit.
	OrderTsc Order = iota
	// OrderReverse asks for semantic diagnostics one file at a time, the
	// program's last file first, as an editor does for the file it shows.
	OrderReverse
	// OrderEmitFirst emits before it asks for any diagnostic, as a bundler
	// plugin that transpiles a module on request does.
	OrderEmitFirst
)

func (o Order) String() string {
	return [...]string{"tsc order", "reverse file order", "emit first"}[o]
}

// A Compilation is a Result that also records which source file each output
// came from.
type Compilation struct {
	*Result
	// From maps each output path to the program file it was emitted from.
	From map[string]*ast.SourceFile
	// EmitDiagnostics are the diagnostics Emit returned, also in
	// Diagnostics.
	EmitDiagnostics []*ast.Diagnostic
}

// CompileOrdered compiles a project as Compile does, asking for diagnostics
// and output in the given order. With singleThreaded, every check and emit
// runs on the calling goroutine, so a panic in the compiler reaches the
// caller's recover.
func (w *Workspace) CompileOrdered(ctx context.Context, project Project, order Order, singleThreaded bool) (*Compilation, error) {
	dir, err := w.writeProject(project)
	if err != nil {
		return nil, err
	}
	return w.CompileIn(ctx, dir, project, order, singleThreaded), nil
}

// CompileIn compiles a project that CompileOrdered already wrote to dir, in
// a fresh program: the same files at the same paths, so that a service key,
// which names its module's path (Chapter 4), is the same too.
func (w *Workspace) CompileIn(ctx context.Context, dir string, project Project, order Order, singleThreaded bool) *Compilation {
	c := w.programIn(dir, singleThreaded)
	c.Sources = project.Files
	program := c.Program
	if program == nil {
		return c
	}
	prefix := filepath.ToSlash(dir) + "/"
	var mu sync.Mutex // Emit writes the files of a program's sources in parallel
	emit := func() {
		emitted := program.Emit(ctx, compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, data *compiler.WriteFileData) error {
			mu.Lock()
			defer mu.Unlock()
			rel := strings.TrimPrefix(string(name), prefix)
			c.Outputs[rel] = text
			if data != nil && data.SourceFile != nil {
				c.From[rel] = data.SourceFile
			}
			return nil
		}})
		c.EmitSkipped = emitted.EmitSkipped
		c.EmitDiagnostics = emitted.Diagnostics
		c.Diagnostics = append(c.Diagnostics, emitted.Diagnostics...)
	}
	if order == OrderEmitFirst {
		emit()
	}
	c.Diagnostics = append(c.Diagnostics, program.GetConfigFileParsingDiagnostics()...)
	c.Diagnostics = append(c.Diagnostics, program.GetSyntacticDiagnostics(ctx, nil)...)
	c.Diagnostics = append(c.Diagnostics, program.GetProgramDiagnostics()...)
	c.Diagnostics = append(c.Diagnostics, program.GetGlobalDiagnostics(ctx)...)
	if order == OrderReverse {
		// The project's own files one at a time, last first; then the
		// libraries' and packages' files, whose checks skipLibCheck usually
		// skips, all at once.
		var own []*ast.SourceFile
		for _, file := range program.SourceFiles() {
			if name := string(file.FileName()); strings.HasPrefix(name, prefix) && !strings.Contains(name, "/node_modules/") {
				own = append(own, file)
			}
		}
		for i := len(own) - 1; i >= 0; i-- {
			c.Diagnostics = append(c.Diagnostics, program.GetSemanticDiagnostics(ctx, own[i])...)
		}
		for _, d := range program.GetSemanticDiagnostics(ctx, nil) {
			if d.File() == nil || !slices.Contains(own, d.File()) {
				c.Diagnostics = append(c.Diagnostics, d)
			}
		}
	} else {
		c.Diagnostics = append(c.Diagnostics, program.GetSemanticDiagnostics(ctx, nil)...)
	}
	c.Diagnostics = append(c.Diagnostics, program.GetDeclarationDiagnostics(ctx, nil)...)
	if order != OrderEmitFirst {
		emit()
	}
	return c
}

// programIn creates the program of the tsconfig.json in dir, with its
// configuration diagnostics.
func (w *Workspace) programIn(dir string, singleThreaded bool) *Compilation {
	configPath := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(configPath, &core.CompilerOptions{}, nil, w.fs, nil)
	c := &Compilation{Result: &Result{Dir: dir, Outputs: map[string]string{}}, From: map[string]*ast.SourceFile{}}
	c.Diagnostics = append(c.Diagnostics, errors...)
	if parsed == nil {
		return c
	}
	// The program's GetConfigFileParsingDiagnostics returns parsed.Errors
	// with the config file's syntax errors, so they are not added here: tsc
	// reports each once.
	host := &sharingHost{CompilerHost: compiler.NewCompilerHost(w.fs, bundled.LibPath(), nil, nil, nil), files: &w.files}
	threads := core.TSUnknown
	if singleThreaded {
		threads = core.TSTrue
	}
	c.Program = compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: host, SingleThreaded: threads})
	return c
}

// compileDir creates the program of the tsconfig.json in dir, on the calling
// goroutine, and asks it for nothing.
func (w *Workspace) compileDir(ctx context.Context, dir string) (*Compilation, error) {
	return w.programIn(dir, true), nil
}

// writeProject writes a project to a new subdirectory of the workspace, as
// Compile does, and returns the directory.
func (w *Workspace) writeProject(project Project) (string, error) {
	dir := filepath.Join(w.Dir, fmt.Sprintf("p%d", w.next.Add(1)))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	// Config wins; a project that carries its configuration as a file, as
	// ProjectFromArchive lifts it, is next; otherwise the default lists the
	// sources. A tsconfig.json entry is never written over the chosen config.
	config := project.Config
	if config == "" {
		config = project.Files["tsconfig.json"]
	}
	if config == "" {
		names := make([]string, 0, len(project.Files))
		for name := range project.Files {
			if isSource(name) {
				names = append(names, name)
			}
		}
		slices.Sort(names)
		listed, _ := json.Marshal(names)
		config = strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": " + string(listed) + "\n}"
	}
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0o600); err != nil {
		return "", err
	}
	for name, text := range project.Files {
		if name == "tsconfig.json" {
			continue
		}
		if err := writeInside(dir, name, text); err != nil {
			return "", err
		}
	}
	return dir, nil
}

// writeInside writes a file at a relative path under dir, refusing any path
// that would leave it.
func writeInside(dir, name, text string) error {
	if !SafeRelativePath(name) {
		return fmt.Errorf("refusing to write %q outside %s", name, dir)
	}
	path := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(text), 0o600)
}

// SafeRelativePath reports whether name is a clean relative path that stays
// inside its directory. Unlike ValidProjectPath it allows out/ and
// node_modules/, the places outputs go.
func SafeRelativePath(name string) bool {
	if name == "" || strings.ContainsAny(name, "\\\x00:") || strings.HasPrefix(name, "/") || filepath.ToSlash(filepath.Clean(name)) != name {
		return false
	}
	for part := range strings.SplitSeq(name, "/") {
		if part == ".." || part == "." {
			return false
		}
	}
	return true
}

// ProjectFromArchive turns a fuzz input into a project: its tsconfig.json,
// when it has one, is the project's configuration. An input without file
// markers is the text of one main.vibe, so a mutation that breaks the first
// marker still compiles.
func ProjectFromArchive(archive string) Project {
	files := Unarchive(archive)
	if len(files) == 0 {
		return Single(archive)
	}
	project := Project{Files: files}
	if config, ok := files["tsconfig.json"]; ok {
		project.Config = config
		delete(files, "tsconfig.json")
	}
	return project
}

// ConfinedProject reports why a project could reach outside its directory,
// or "" when it cannot: a configuration path that is absolute or climbs out
// (an include of "/**/*" would read the whole disk), or a reference to a
// device file. Targets skip such inputs; they test the compiler, not the
// machine.
func ConfinedProject(project Project) string {
	texts := []string{project.Config}
	for name, text := range project.Files {
		if strings.HasSuffix(name, ".json") {
			texts = append(texts, text)
		}
	}
	for _, text := range texts {
		for _, bad := range []string{"..", `"/`, `"~`, `\\`, `"\u`} {
			if strings.Contains(text, bad) {
				return "a configuration names " + bad
			}
		}
	}
	for name, text := range project.Files {
		for _, bad := range []string{"/dev/", "/proc/", "/sys/"} {
			if strings.Contains(text, bad) {
				return name + " names " + bad
			}
		}
	}
	return ""
}
