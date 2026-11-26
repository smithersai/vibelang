package compiler_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	_ "github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func sidecarOwnershipConfig(layout, files, references string, composite bool) string {
	return fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"es2022","module":"esnext","moduleResolution":"bundler","types":[],"rootDir":".","rewriteRelativeImportExtensions":true,"noEmit":%t,"composite":%t,"declaration":%t,"outDir":%q},"vibe":{"effectGlobals":false,"effectModules":false,"sidecarDir":%q},"files":%s,"references":%s}`, !composite, composite, composite, core.IfElse(composite, "../out/worker", "out"), layout, files, references)
}

func emitOwnedSidecars(t *testing.T, fs vfs.FS, config string) {
	t.Helper()
	parsed, ds := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromNormalized(config), &core.CompilerOptions{}, nil, fs, nil)
	if len(ds) != 0 || len(parsed.Errors) != 0 {
		t.Fatalf("config: %v %v", ds, parsed.Errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	for _, d := range append(p.GetProgramDiagnostics(), p.GetSemanticDiagnostics(t.Context(), nil)...) {
		t.Errorf("check %s: %s", config, d.String())
	}
	if t.Failed() {
		t.FailNow()
	}
	ordinary := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		return fs.WriteFile(name, text)
	}})
	if ordinary != nil && len(ordinary.Diagnostics) != 0 {
		t.Fatalf("ordinary emit: %+v", ordinary)
	}
	result := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error { return fs.WriteFile(tspath.RootedFilePathFromNormalized(name), text) }, fs)
	if result != nil && (result.EmitSkipped || len(result.Diagnostics) != 0) {
		t.Fatalf("sidecar emit: %+v", result)
	}
}

func requireOwnedSidecar(t *testing.T, fs vfs.FS, path string) string {
	t.Helper()
	text, ok := fs.ReadFile(tspath.RootedFilePathFromNormalized(path))
	if !ok || !strings.Contains(text, "export declare const") {
		t.Fatalf("missing declaration %s: %q", path, text)
	}
	return text
}

func TestSidecarPruningNestedProjects(t *testing.T) {
	for _, referenced := range []bool{false, true} {
		for _, workerFirst := range []bool{false, true} {
			t.Run(fmt.Sprintf("references=%t/workerFirst=%t", referenced, workerFirst), func(t *testing.T) {
				refs := "[]"
				if referenced {
					refs = `[{"path":"./worker"}]`
				}
				fs := bundled.WrapFS(vfstest.FromMap(map[string]any{
					"/src/tsconfig.json":        sidecarOwnershipConfig(".vibe/declarations", `["Root.vibe"]`, refs, false),
					"/src/worker/tsconfig.json": sidecarOwnershipConfig("", `["W.vibe"]`, "[]", referenced),
					"/src/Root.vibe":            `import { W } from "./worker/W.vibe"; export const ROOT = W;`,
					"/src/worker/W.vibe":        `export const W = 1;`,
				}, tspath.CaseSensitive))
				// References need the dependency's ordinary output first.
				if referenced {
					emitOwnedSidecars(t, fs, "/src/worker/tsconfig.json")
				}
				order := []string{"/src/tsconfig.json", "/src/worker/tsconfig.json"}
				if workerFirst {
					order[0], order[1] = order[1], order[0]
				}
				for _, config := range order {
					emitOwnedSidecars(t, fs, config)
				}
				worker := requireOwnedSidecar(t, fs, "/src/worker/W.d.vibe.ts")
				if !referenced {
					requireOwnedSidecar(t, fs, "/src/.vibe/declarations/worker/W.d.vibe.ts")
				}
				for _, config := range order {
					emitOwnedSidecars(t, fs, config)
				}
				if got := requireOwnedSidecar(t, fs, "/src/worker/W.d.vibe.ts"); got != worker {
					t.Fatalf("other project changed declaration: %q", got)
				}
			})
		}
	}
}

func TestSidecarPruningSharedOutput(t *testing.T) {
	for _, first := range []string{"a", "b"} {
		t.Run(first, func(t *testing.T) {
			fs := bundled.WrapFS(vfstest.FromMap(map[string]any{
				"/src/a.json":      sidecarOwnershipConfig("", `["Shared.vibe"]`, "[]", false),
				"/src/b.json":      sidecarOwnershipConfig("", `["Shared.vibe"]`, "[]", false),
				"/src/Shared.vibe": `export const shared = 1;`,
			}, tspath.CaseSensitive))
			other := "b"
			if first == "b" {
				other = "a"
			}
			emitOwnedSidecars(t, fs, "/src/"+first+".json")
			emitOwnedSidecars(t, fs, "/src/"+other+".json")
			before := requireOwnedSidecar(t, fs, "/src/Shared.d.vibe.ts")
			fs.WriteFile(tspath.RootedFilePath("/src/"+first+".json"), sidecarOwnershipConfig(".vibe/declarations", `["Shared.vibe"]`, "[]", false))
			emitOwnedSidecars(t, fs, "/src/"+first+".json")
			if got := requireOwnedSidecar(t, fs, "/src/Shared.d.vibe.ts"); got != before {
				t.Fatalf("shared output changed: %q", got)
			}
			requireOwnedSidecar(t, fs, "/src/.vibe/declarations/Shared.d.vibe.ts")
			// Once the last owner moves, the old shared output is stale.
			fs.WriteFile(tspath.RootedFilePath("/src/"+other+".json"), sidecarOwnershipConfig(".vibe/declarations", `["Shared.vibe"]`, "[]", false))
			emitOwnedSidecars(t, fs, "/src/"+other+".json")
			if fs.FileExists("/src/Shared.d.vibe.ts") {
				t.Fatal("last owner did not prune stale output")
			}
		})
	}
}

func TestSidecarPruningOwnOutput(t *testing.T) {
	fs := bundled.WrapFS(vfstest.FromMap(map[string]any{
		"/src/tsconfig.json": sidecarOwnershipConfig("", `["Own.vibe"]`, "[]", false),
		"/src/Own.vibe":      `export const own = 1;`,
	}, tspath.CaseSensitive))
	emitOwnedSidecars(t, fs, "/src/tsconfig.json")
	requireOwnedSidecar(t, fs, "/src/Own.d.vibe.ts")
	fs.WriteFile("/src/tsconfig.json", sidecarOwnershipConfig(".vibe/declarations", `["Own.vibe"]`, "[]", false))
	emitOwnedSidecars(t, fs, "/src/tsconfig.json")
	if fs.FileExists("/src/Own.d.vibe.ts") {
		t.Fatal("own adjacent output was not pruned")
	}
	requireOwnedSidecar(t, fs, "/src/.vibe/declarations/Own.d.vibe.ts")
	fs.WriteFile("/src/tsconfig.json", sidecarOwnershipConfig("", `["Own.vibe"]`, "[]", false))
	emitOwnedSidecars(t, fs, "/src/tsconfig.json")
	if fs.DirectoryExists("/src/.vibe") {
		t.Fatal("own stale conventional directory was not pruned")
	}
}

func TestSidecarPruningPreservesUnownedOrEditedOutput(t *testing.T) {
	for _, edited := range []bool{false, true} {
		t.Run(fmt.Sprint(edited), func(t *testing.T) {
			fs := bundled.WrapFS(vfstest.FromMap(map[string]any{
				"/src/tsconfig.json": sidecarOwnershipConfig("", `["Own.vibe"]`, "[]", false),
				"/src/Own.vibe":      `export const own = 1;`,
			}, tspath.CaseSensitive))
			if edited {
				emitOwnedSidecars(t, fs, "/src/tsconfig.json")
			}
			const handwritten = "export declare const retained: unique symbol;\n"
			fs.WriteFile("/src/Own.d.vibe.ts", handwritten)
			fs.WriteFile("/src/tsconfig.json", sidecarOwnershipConfig(".vibe/declarations", `["Own.vibe"]`, "[]", false))
			emitOwnedSidecars(t, fs, "/src/tsconfig.json")
			if got, _ := fs.ReadFile("/src/Own.d.vibe.ts"); got != handwritten {
				t.Fatalf("unowned or edited declaration deleted: %q", got)
			}
		})
	}
}

func TestSidecarPruningLegacyOwnershipReceipt(t *testing.T) {
	fs := bundled.WrapFS(vfstest.FromMap(map[string]any{
		"/src/tsconfig.json": sidecarOwnershipConfig("", `["Own.vibe"]`, "[]", false),
		"/src/Own.vibe":      `export const own = 1;`,
	}, tspath.CaseSensitive))
	emitOwnedSidecars(t, fs, "/src/tsconfig.json")
	var receipts int
	for _, name := range fs.GetAccessibleEntries("/src").Files {
		if strings.HasSuffix(name, ".owner") {
			path := tspath.RootedFilePathFromNormalized("/src/" + name)
			text, _ := fs.ReadFile(path)
			if err := fs.WriteFile(path, strings.ReplaceAll(text, "// ", "")); err != nil {
				t.Fatal(err)
			}
			receipts++
		}
	}
	// One receipt for the sidecar and one for its native declaration, Own.d.ts.
	if receipts != 2 {
		t.Fatalf("expected an ownership receipt for each output, got %d", receipts)
	}
	fs.WriteFile("/src/tsconfig.json", sidecarOwnershipConfig(".vibe/declarations", `["Own.vibe"]`, "[]", false))
	emitOwnedSidecars(t, fs, "/src/tsconfig.json")
	if fs.FileExists("/src/Own.d.vibe.ts") || fs.FileExists("/src/Own.d.ts") {
		t.Fatal("a legacy receipt lost ownership of its unchanged declaration")
	}
	requireOwnedSidecar(t, fs, "/src/.vibe/declarations/Own.d.vibe.ts")
	if !fs.FileExists("/src/.vibe/declarations/Own.d.ts") {
		t.Fatal("the native declaration did not move with its sidecar")
	}
}

type forbiddenWalkFS struct {
	vfs.FS
	t         *testing.T
	forbidden map[string]bool
}

func (f *forbiddenWalkFS) GetAccessibleEntries(path tspath.RootedDirectoryPath) vfs.Entries {
	if f.forbidden[string(path)] {
		f.t.Errorf("sidecar pruning walked forbidden ancestor directory %q", path)
	}
	return f.FS.GetAccessibleEntries(path)
}

func TestSidecarPruningDoesNotWalkFilesystemRootOrAncestors(t *testing.T) {
	for _, tc := range []struct {
		name      string
		rootDir   string
		forbidden []string
	}{
		{
			name:      "filesystemRoot",
			rootDir:   "/",
			forbidden: []string{"/", "/unrelated", "/tmp"},
		},
		{
			name:      "ancestorDir",
			rootDir:   "/tmp",
			forbidden: []string{"/", "/tmp", "/tmp/other"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"es2022","module":"nodenext","moduleResolution":"nodenext","types":[],"rootDir":%q,"outDir":".emit","noEmit":false},"include":["src/**/*"]}`, tc.rootDir)
			base := bundled.WrapFS(vfstest.FromMap(map[string]any{
				"/tmp/project/tsconfig.json": cfg,
				"/tmp/project/src/keep.vibe": "export const keep = 1;\n",
				"/tmp/project/src/drop.vibe": "export const drop = 2;\n",
				"/tmp/other/sibling.txt":     "do not scan\n",
				"/unrelated/host.txt":        "do not scan\n",
			}, tspath.CaseSensitive))
			forbidden := map[string]bool{}
			for _, dir := range tc.forbidden {
				forbidden[dir] = true
			}
			watched := &forbiddenWalkFS{FS: base, t: t, forbidden: forbidden}

			emitOwnedSidecars(t, watched, "/tmp/project/tsconfig.json")
			requireOwnedSidecar(t, base, "/tmp/project/src/keep.d.vibe.ts")
			requireOwnedSidecar(t, base, "/tmp/project/src/drop.d.vibe.ts")

			// Deleting drop.vibe must still prune its stale sidecar inside the project
			// without walking rootDir or any ancestor outside configDir.
			if err := base.Remove("/tmp/project/src/drop.vibe"); err != nil {
				t.Fatal(err)
			}
			emitOwnedSidecars(t, watched, "/tmp/project/tsconfig.json")
			requireOwnedSidecar(t, base, "/tmp/project/src/keep.d.vibe.ts")
			if base.FileExists("/tmp/project/src/drop.d.vibe.ts") || base.FileExists("/tmp/project/src/drop.d.ts") {
				t.Fatal("stale sidecar inside project was not pruned")
			}
		})
	}
}
