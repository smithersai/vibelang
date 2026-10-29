// Package vibelangfuzz holds the shared harness of VibeLang's fuzz targets:
// a workspace that compiles generated or mutated sources against the real
// effect and vibelang-runtime packages, the invariants every compilation must
// keep, the specification facts those invariants come from, and a Node worker
// that runs emitted programs.
//
// The oracles come from the specification in docs/design/src, not from the
// compiler: where the specification is ahead of the implementation, a target
// records the gap in testdata/pending/ instead of encoding today's behavior.
// docs/research/fuzzing.md explains each target and how to run a campaign.
package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/repo"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"

	// The blank import registers VibeLang's checker, transform and
	// diagnostic hooks, as cmd/tsc's import does.
	_ "github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Root is the repository root: the directory that holds typescript/ and docs/.
func Root() string {
	return filepath.Dir(filepath.Dir(repo.RootPath()))
}

// DefaultConfig is the compiler configuration of the acceptance cases: ESM
// output on NodeNext resolution, strict, with source maps and declarations so
// that every emitter runs.
const DefaultConfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "out",
    "rootDir": "."
  }
}`

// A Workspace is a directory with effect and vibelang-runtime installed in
// node_modules, in which Compile writes each program to a fresh subdirectory.
// It parses each declaration file of the libraries and packages once and
// shares it between programs, so a compilation costs the checking of the
// program's own sources.
type Workspace struct {
	Dir   string
	fs    vfs.FS
	files sync.Map // ast.SourceFileParseOptions -> *ast.SourceFile
	next  atomic.Int64
}

// NewWorkspace installs the packages into a temporary directory that the test
// removes. A target that needs a missing dependency skips with the command
// that installs it, or fails when VIBELANG_FUZZ_REQUIRE=1, as the smoke run
// sets it, so that a gate never passes by testing nothing.
func NewWorkspace(tb testing.TB) *Workspace {
	tb.Helper()
	root := Root()
	effect := filepath.Join(os.Getenv("EFFECT_NODE_MODULES"), "effect")
	if os.Getenv("EFFECT_NODE_MODULES") == "" {
		effect = filepath.Join(root, "experiments/node_modules/effect")
	}
	if _, err := os.Stat(filepath.Join(effect, "package.json")); err != nil {
		Missing(tb, "effect is not installed at %s: run (cd experiments && bun install) or set EFFECT_NODE_MODULES", effect)
	}
	// VIP-32: one pinned Effect version. A compiled program and the Effect
	// TS a VIP shows must run the same Effect.
	if want, got := PinnedEffectVersion(), packageVersion(effect); got != want {
		Missing(tb, "effect %s is installed at %s, but VibeLang pins %s (VIP-32): run (cd experiments && bun install) or set EFFECT_NODE_MODULES to an install of effect %s", got, effect, want, want)
	}
	runtime := filepath.Join(root, "packages/runtime")
	if _, err := os.Stat(filepath.Join(runtime, "dist/index.d.ts")); err != nil {
		Missing(tb, "vibelang-runtime is not built at %s: run (cd packages/runtime && bun install && bun run build)", runtime)
	}
	if _, err := os.Stat(filepath.Join(runtime, "node_modules", platformNode, "package.json")); err != nil {
		Missing(tb, "%s is not installed in %s/node_modules: run (cd packages/runtime && bun install)", platformNode, runtime)
	}
	dir := tb.TempDir()
	if err := installPackages(dir, effect, runtime); err != nil {
		tb.Fatal(err)
	}
	return &Workspace{Dir: dir, fs: bundled.WrapFS(osvfs.FS())}
}

// Missing reports a missing dependency: it skips the test, or fails it when
// VIBELANG_FUZZ_REQUIRE=1.
func Missing(tb testing.TB, format string, args ...any) {
	tb.Helper()
	if os.Getenv("VIBELANG_FUZZ_REQUIRE") == "1" {
		tb.Fatalf(format, args...)
	}
	tb.Skipf(format, args...)
}

// platformNode is the package the entry statement of a main that names the
// Node platform provides (D312, Chapter 11: it "names @effect/platform-node's
// bundle"), and the runtime's experimental platform-node module imports.
const platformNode = "@effect/platform-node"

// installPackages links effect and copies the runtime's published files, as
// the smoke harness does: linking the runtime's checkout would resolve its
// peers through its development node_modules, and Node would load a second
// copy of effect. It then installs platformNode from the runtime's
// node_modules, where its development install puts it.
func installPackages(dir, effect, runtime string) error {
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"type":"module"}`), 0o600); err != nil {
		return err
	}
	modules := filepath.Join(dir, "node_modules")
	if err := os.MkdirAll(modules, 0o755); err != nil {
		return err
	}
	if err := os.Symlink(effect, filepath.Join(modules, "effect")); err != nil {
		return err
	}
	manifest, err := os.ReadFile(filepath.Join(runtime, "package.json"))
	if err != nil {
		return err
	}
	var pkg struct {
		Files []string `json:"files"`
	}
	if err := json.Unmarshal(manifest, &pkg); err != nil {
		return err
	}
	installed := filepath.Join(modules, "vibelang-runtime")
	if err := os.MkdirAll(installed, 0o755); err != nil {
		return err
	}
	for _, entry := range append([]string{"package.json"}, pkg.Files...) {
		source, target := filepath.Join(runtime, entry), filepath.Join(installed, entry)
		info, err := os.Stat(source)
		if os.IsNotExist(err) {
			continue // npm also omits missing files, such as an optional LICENSE.
		}
		if err != nil {
			return err
		}
		if info.IsDir() {
			err = os.CopyFS(target, os.DirFS(source))
		} else {
			var data []byte
			if data, err = os.ReadFile(source); err == nil {
				err = os.WriteFile(target, data, 0o600)
			}
		}
		if err != nil {
			return err
		}
	}
	return installPackage(modules, filepath.Join(runtime, "node_modules"), platformNode, false)
}

// installPackage installs the package name from the node_modules
// directory from into modules, with what it needs. Node resolves a linked
// package's imports from its real path, so a package that imports effect, a
// peer dependency, is copied instead, and resolves the one effect in modules;
// its dependencies and its other peers, such as @effect/platform-node's
// redis, are installed the same way. Any other package is linked. A peer
// (peer is true) that from does not hold is optional, and is left out.
func installPackage(modules, from, name string, peer bool) error {
	target := filepath.Join(modules, filepath.FromSlash(name))
	if _, err := os.Lstat(target); err == nil {
		return nil
	}
	source := filepath.Join(from, filepath.FromSlash(name))
	manifest, err := os.ReadFile(filepath.Join(source, "package.json"))
	if peer && os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var pkg struct {
		Dependencies     map[string]string `json:"dependencies"`
		PeerDependencies map[string]string `json:"peerDependencies"`
	}
	if err := json.Unmarshal(manifest, &pkg); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	if _, ok := pkg.PeerDependencies["effect"]; !ok {
		return os.Symlink(source, target)
	}
	if err := os.CopyFS(target, os.DirFS(source)); err != nil {
		return err
	}
	for _, dependency := range slices.Sorted(maps.Keys(pkg.Dependencies)) {
		if err := installPackage(modules, from, dependency, false); err != nil {
			return err
		}
	}
	for _, dependency := range slices.Sorted(maps.Keys(pkg.PeerDependencies)) {
		if err := installPackage(modules, from, dependency, true); err != nil {
			return err
		}
	}
	return nil
}

// A Project is one program's sources, by path relative to its directory.
// Config is its tsconfig.json; empty means DefaultConfig with every source
// listed in "files".
type Project struct {
	Files  map[string]string
	Config string
}

// Single is the project of one main.vibe.
func Single(source string) Project {
	return Project{Files: map[string]string{"main.vibe": source}}
}

// A Result is one compilation: the diagnostics of every stage tsc -p runs, in
// its order, and every file the emitters wrote, by path relative to the
// project's directory. Unlike tsc, Compile checks a program whose syntax has
// errors, so a target reaches the checker with every input.
type Result struct {
	Dir         string
	Program     *compiler.Program
	Sources     map[string]string
	Diagnostics []*ast.Diagnostic
	Outputs     map[string]string
	EmitSkipped bool
}

// Compile writes the project to a new subdirectory, checks it and emits it
// in memory. It never writes outputs to disk; Run does that when a target
// executes the program.
func (w *Workspace) Compile(ctx context.Context, project Project) (*Result, error) {
	dir := filepath.Join(w.Dir, fmt.Sprintf("p%d", w.next.Add(1)))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	config := project.Config
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
		return nil, err
	}
	for name, text := range project.Files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
			return nil, err
		}
	}
	configPath := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(configPath, &core.CompilerOptions{}, nil, w.fs, nil)
	result := &Result{Dir: dir, Sources: project.Files, Outputs: map[string]string{}}
	result.Diagnostics = append(result.Diagnostics, errors...)
	if parsed == nil {
		return result, nil
	}
	host := &sharingHost{CompilerHost: compiler.NewCompilerHost(w.fs, bundled.LibPath(), nil, nil, nil), files: &w.files}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: host})
	result.Program = program
	// The configuration's diagnostics include parsed.Errors.
	result.Diagnostics = append(result.Diagnostics, program.GetConfigFileParsingDiagnostics()...)
	result.Diagnostics = append(result.Diagnostics, program.GetSyntacticDiagnostics(ctx, nil)...)
	result.Diagnostics = append(result.Diagnostics, program.GetProgramDiagnostics()...)
	result.Diagnostics = append(result.Diagnostics, program.GetGlobalDiagnostics(ctx)...)
	result.Diagnostics = append(result.Diagnostics, program.GetSemanticDiagnostics(ctx, nil)...)
	result.Diagnostics = append(result.Diagnostics, program.GetDeclarationDiagnostics(ctx, nil)...)
	prefix := filepath.ToSlash(dir) + "/"
	var outputs sync.Mutex // the emitters of a multi-file program write in parallel
	emitted := program.Emit(ctx, compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		outputs.Lock()
		defer outputs.Unlock()
		result.Outputs[strings.TrimPrefix(string(name), prefix)] = text
		return nil
	}})
	result.EmitSkipped = emitted.EmitSkipped
	result.Diagnostics = append(result.Diagnostics, emitted.Diagnostics...)
	return result, nil
}

// Remove deletes the project's directory. Targets call it after each input so
// that a long campaign does not fill the disk.
func (r *Result) Remove() {
	_ = os.RemoveAll(r.Dir)
}

// SourceFile returns the program's file for a source path relative to the
// project.
func (r *Result) SourceFile(name string) *ast.SourceFile {
	if r.Program == nil {
		return nil
	}
	return r.Program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(r.Dir, filepath.FromSlash(name)))))
}

func isSource(name string) bool {
	for _, extension := range []string{".vibe", ".ts", ".mts", ".cts", ".tsx"} {
		if strings.HasSuffix(name, extension) {
			return true
		}
	}
	return false
}

// sharingHost parses each library and package declaration file once per
// workspace. Programs never change those files, and the language server
// shares source files between programs the same way.
type sharingHost struct {
	compiler.CompilerHost
	files *sync.Map
}

func (h *sharingHost) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	name := string(opts.FileName)
	if !strings.Contains(name, "/node_modules/") && !strings.HasPrefix(name, string(bundled.LibPath())) {
		return h.CompilerHost.GetSourceFile(opts)
	}
	if file, ok := h.files.Load(opts); ok {
		return file.(*ast.SourceFile)
	}
	file := h.CompilerHost.GetSourceFile(opts)
	if file == nil {
		return nil
	}
	actual, _ := h.files.LoadOrStore(opts, file)
	return actual.(*ast.SourceFile)
}

// pinnedEffect reads the Effect version VibeLang pins, a string literal in
// packages/runtime/src/version.ts that the merge queue reads too.
var pinnedEffect = regexp.MustCompile(`PINNED_EFFECT_VERSION = "([^"]+)"`)

// PinnedEffectVersion returns the Effect version VibeLang pins (VIP-32), or
// "" when the pin cannot be read.
func PinnedEffectVersion() string {
	text, err := os.ReadFile(filepath.Join(Root(), "packages/runtime/src/version.ts"))
	if err != nil {
		return ""
	}
	if m := pinnedEffect.FindSubmatch(text); m != nil {
		return string(m[1])
	}
	return ""
}

// packageVersion returns the version in a package's package.json.
func packageVersion(dir string) string {
	text, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return ""
	}
	var manifest struct{ Version string }
	if json.Unmarshal(text, &manifest) != nil {
		return ""
	}
	return manifest.Version
}
