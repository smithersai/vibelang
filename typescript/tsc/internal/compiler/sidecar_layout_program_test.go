package compiler

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// sidecarOwnerReadsFS counts reads of owning-project sources and slows each
// one, so parallel importers overlap while a layout is being probed.
type sidecarOwnerReadsFS struct {
	vfs.FS
	mu    sync.Mutex
	reads map[string]int
}

func (f *sidecarOwnerReadsFS) ReadFile(file tspath.RootedFilePath) (string, bool) {
	if name := string(file); strings.HasPrefix(name, "/owner") && strings.HasSuffix(name, ".vibe") {
		f.mu.Lock()
		f.reads[name]++
		f.mu.Unlock()
		time.Sleep(time.Millisecond)
	}
	return f.FS.ReadFile(file)
}

type sidecarOwnerShape struct {
	layout string // inferred, explicit or composite
	roots  int
}

// sidecarLayoutWorkspace writes owning projects /owner<i> that relocate their
// sidecars to types/ and are linked into /app/node_modules, and one importer
// per app directory, so each import is a separate resolution.
func sidecarLayoutWorkspace(t *testing.T, owners []sidecarOwnerShape, importers int) (map[string]any, []string) {
	t.Helper()
	files := map[string]any{"/app/package.json": `{"type":"module"}`}
	names := []string{}
	for i, owner := range owners {
		name := fmt.Sprintf("owner%d", i)
		names = append(names, name)
		dir := "/" + name
		options := map[string]any{"noLib": true, "noEmit": true, "module": "nodenext", "allowArbitraryExtensions": true, "allowImportingTsExtensions": true}
		sidecarDir := "types/"
		switch owner.layout {
		case "explicit":
			options["rootDir"] = "src"
		case "composite":
			options["composite"] = true
			sidecarDir += "src/"
		}
		roots := []string{}
		for j := range owner.roots {
			roots = append(roots, fmt.Sprintf("src/m%d.vibe", j))
			files[fmt.Sprintf("%s/src/m%d.vibe", dir, j)] = fmt.Sprintf("export const v%d = %d;", j, j)
			files[fmt.Sprintf("%s/%sm%d.d.vibe.ts", dir, sidecarDir, j)] = fmt.Sprintf("export declare const v%d: %d;", j, j)
		}
		config, err := json.Marshal(map[string]any{"compilerOptions": options, "vibe": map[string]any{"effectGlobals": false, "effectModules": false, "sidecarDir": "types"}, "files": roots})
		if err != nil {
			t.Fatal(err)
		}
		files[dir+"/tsconfig.json"] = string(config)
		files[dir+"/package.json"] = fmt.Sprintf(`{"name":%q,"type":"module","types":"./%sm0.d.vibe.ts"}`, name, sidecarDir)
		files["/app/node_modules/"+name] = vfstest.Symlink(dir)
	}
	roots := []string{}
	for i := range importers {
		lines := []string{}
		for _, name := range names {
			lines = append(lines, fmt.Sprintf("import { v0 as %s } from %q;", name, name))
		}
		lines = append(lines, "export const copy = "+strings.Join(names, " + ")+";")
		file := fmt.Sprintf("p%d/main.ts", i)
		roots = append(roots, file)
		files["/app/"+file] = strings.Join(lines, "\n")
	}
	config, err := json.Marshal(map[string]any{"compilerOptions": map[string]any{"noLib": true, "noEmit": true, "module": "nodenext", "allowArbitraryExtensions": true, "allowImportingTsExtensions": true}, "vibe": map[string]any{"effectGlobals": false, "effectModules": false}, "files": roots})
	if err != nil {
		t.Fatal(err)
	}
	files["/app/tsconfig.json"] = string(config)
	return files, names
}

// checkSidecarLayoutProbes loads the app and checks each owner: its relocated
// sidecar joins its source, and its layout is probed at most once. Only a
// layout program reads m1.vibe, a root no importer reaches.
func checkSidecarLayoutProbes(t *testing.T, owners []sidecarOwnerShape, importers int) {
	t.Helper()
	files, names := sidecarLayoutWorkspace(t, owners, importers)
	fs := &sidecarOwnerReadsFS{FS: vfstest.FromMap(files, tspath.CaseSensitive), reads: map[string]int{}}
	config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(ds) > 0 || len(config.Errors) > 0 {
		t.Fatalf("configuration: %v %v", ds, config.Errors)
	}
	program := NewProgram(ProgramOptions{Config: config, Host: NewCompilerHost(fs, "/", nil, nil, nil)})
	for i, owner := range owners {
		dir := "/" + names[i]
		if program.GetSourceFile(tspath.RootedFilePath(dir+"/src/m0.vibe")) == nil {
			t.Fatalf("%s (%s layout): the relocated sidecar did not resolve to its source", names[i], owner.layout)
		}
		want := 0
		if owner.layout == "inferred" {
			want = 1
		}
		if got := fs.reads[dir+"/src/m1.vibe"]; got != want {
			t.Fatalf("%s (%s layout, %d roots): %d layout programs for %d importers; want %d", names[i], owner.layout, owner.roots, got, importers, want)
		}
	}
}

// A program built one layout program per importing directory while the first
// was still loading, so 32 importers of one owner held up to 32 copies of its
// graph at once.
func TestSidecarLayoutProbedOncePerProgram(t *testing.T) {
	checkSidecarLayoutProbes(t, []sidecarOwnerShape{{"inferred", 24}}, 32)
}

// Several owners with mixed layouts share one program: each inferred owner is
// probed once, and an explicit root or a composite project never.
func TestSidecarLayoutProbesAcrossOwnerShapes(t *testing.T) {
	layouts := []string{"inferred", "explicit", "composite"}
	for seed := range uint64(12) {
		random := rand.New(rand.NewPCG(seed, 0x51dec4))
		owners := make([]sidecarOwnerShape, 1+random.IntN(3))
		for i := range owners {
			owners[i] = sidecarOwnerShape{layouts[random.IntN(len(layouts))], 2 + random.IntN(15)}
		}
		importers := 2 + random.IntN(31)
		t.Run(fmt.Sprintf("seed%d", seed), func(t *testing.T) {
			checkSidecarLayoutProbes(t, owners, importers)
		})
	}
}
