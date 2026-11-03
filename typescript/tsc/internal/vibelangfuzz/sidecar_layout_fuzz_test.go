package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/execute"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

const sidecarLayoutQuote = "Declaration sidecars are emit outputs like `.d.ts`."

// Build mode compares the system clock with real output mtimes. Keep the
// actual CLI clock when the oracle uses the real filesystem.
type sidecarLayoutSystem struct{ *sidecarParitySystem }

func (*sidecarLayoutSystem) Now() time.Time { return time.Now() }

func TestSidecarOutsideRootQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), sidecarLayoutQuote) {
		t.Fatal(sidecarLayoutQuote)
	}
}

// Spec-agent ruling 2026-11-03 under "match TypeScript": sidecarDir plays
// declarationDir's part. The oracle executes stock tsc 5.9.3, never the fork's
// .ts emitter (TypeScript 7 changed inferred rootDir). Keyed layout seeds cover
// imported sources, explicit roots, and ownership through project references.
func FuzzSidecarOutsideRoot(f *testing.F) {
	startShortBudget(f)
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = filepath.Join(Root(), "experiments", "node_modules")
	}
	stock := filepath.Join(modules, "typescript", "bin", "tsc")
	if _, err := os.Stat(stock); err != nil {
		Missing(f, "install experiments dependencies: %v", err)
	}
	for _, key := range []string{"beside", "directory", "rootDir", "references"} {
		f.Add(key, []byte{0, 0, 0})
		f.Add(key, []byte{1, 1, 0})
		f.Add(key, []byte{0, 2, 1})
		f.Add(key, []byte{1, 2, 1})
	}
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		modes := []string{"beside", "directory", "rootDir", "references"}
		if !slices.Contains(modes, key) {
			index := 0
			if len(key) > 0 {
				index = int(key[0]) % len(modes)
			}
			key = modes[index]
		}
		at := func(i int) byte {
			if i < len(data) {
				return data[i]
			}
			return 0
		}
		outside := at(0)&1 != 0
		directory := key == "directory" || (key != "beside" && at(2)&1 != 0)
		depth := int(at(1) % 3)
		nesting := strings.Repeat("nested/", depth)
		dir := t.TempDir()
		type observation struct {
			Success bool
			Codes   []string
			Files   []string
		}
		var results []observation
		for _, ext := range []string{"ts", "vibe"} {
			home := filepath.Join(dir, ext)
			put := func(file string, value any) {
				var text []byte
				if s, ok := value.(string); ok {
					text = []byte(s)
				} else {
					var err error
					text, err = json.Marshal(value)
					if err != nil {
						t.Fatal(err)
					}
				}
				path := filepath.Join(home, filepath.FromSlash(file))
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, text, 0600); err != nil {
					t.Fatal(err)
				}
			}
			source := "b/src/" + nesting + "x." + ext
			if outside {
				source = "a/src/" + nesting + "x." + ext
			}
			put(source, "export const x = 1\n")
			importer := "b/src/z." + ext
			relative, err := filepath.Rel(filepath.Dir(importer), source)
			if err != nil {
				t.Fatal(err)
			}
			relative = filepath.ToSlash(relative)
			if !strings.HasPrefix(relative, ".") {
				relative = "./" + relative
			}
			put(importer, fmt.Sprintf("export { x } from %q\n", relative))
			config := func(owner bool) map[string]any {
				options := map[string]any{"target": "ESNext", "module": "ESNext", "moduleResolution": "Bundler", "types": []string{}, "skipLibCheck": true, "declaration": true, "emitDeclarationOnly": true, "rewriteRelativeImportExtensions": true}
				if key == "rootDir" {
					options["rootDir"] = "src"
				}
				if key == "references" {
					options["rootDir"] = "src"
					options["composite"] = true
					if ext == "vibe" {
						options["declarationDir"] = "public"
					}
				}
				config := map[string]any{"compilerOptions": options, "include": []string{"src"}}
				if ext == "vibe" {
					vibe := map[string]any{"effectGlobals": false, "effectModules": false}
					if directory {
						vibe["sidecarDir"] = "decl"
					} else if owner && key != "references" {
						vibe["sidecarDir"] = "owner-decl"
					}
					config["vibe"] = vibe
				} else if directory {
					options["declarationDir"] = "decl"
				}
				if key == "references" && !owner && outside {
					config["references"] = []any{map[string]string{"path": "../a"}}
				}
				return config
			}
			put("a/tsconfig.json", config(true))
			put("b/tsconfig.json", config(false))
			args := []string{"-p", "b", "--pretty", "false"}
			if key == "references" {
				args[0] = "-b"
			}
			var success bool
			var output string
			if ext == "ts" {
				ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
				cmd := exec.CommandContext(ctx, "node", append([]string{stock}, args...)...)
				cmd.Dir = home
				out, err := cmd.CombinedOutput()
				cancel()
				if ctx.Err() == context.DeadlineExceeded {
					t.Fatal("stock tsc timed out")
				}
				success, output = err == nil, string(out)
			} else {
				sys := &sidecarLayoutSystem{&sidecarParitySystem{fs: bundled.WrapFS(osvfs.FS()), cwd: tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(home))}}
				ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
				result := execute.CommandLine(ctx, sys, args, nil)
				cancel()
				if ctx.Err() == context.DeadlineExceeded {
					t.Fatalf("VibeLang timed out: layout=%s directory=%t outside=%t depth=%d", key, directory, outside, depth)
				}
				success, output = result.Status == 0, sys.output.String()
			}
			codes := []string{}
			for _, match := range sidecarLayoutCodes.FindAllStringSubmatch(output, -1) {
				codes = append(codes, match[1])
			}
			slices.Sort(codes)
			files := []string{}
			err = filepath.WalkDir(home, func(path string, entry os.DirEntry, err error) error {
				if err != nil {
					return err
				}
				suffix := ".d.ts"
				if ext == "vibe" {
					suffix = ".d.vibe.ts"
				}
				if !entry.IsDir() && strings.HasSuffix(path, suffix) {
					name, err := filepath.Rel(home, path)
					if err != nil {
						return err
					}
					name = strings.ReplaceAll(filepath.ToSlash(name), ".d.vibe.ts", ".d.ts")
					name = strings.ReplaceAll(name, "/public/", "/decl/")
					files = append(files, name)
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			slices.Sort(files)
			results = append(results, observation{success, codes, files})
		}
		if !reflect.DeepEqual(results[0], results[1]) {
			Gap(t, "FuzzSidecarOutsideRoot", fmt.Sprintf("sidecar-layout:%s:directory=%t", key, directory),
				"%s; outside=%t depth=%d: tsc5.9=%+v vibe=%+v", sidecarLayoutQuote, outside, depth, results[0], results[1])
		}
	})
}

var sidecarLayoutCodes = regexp.MustCompile(`error ((?:TS|EK)\d+):`)
