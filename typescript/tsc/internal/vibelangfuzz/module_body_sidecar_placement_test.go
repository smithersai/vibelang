package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/execute"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

const moduleBodyPlacementTarget = "FuzzModuleBodySidecarPlacement"

func TestModuleBodySidecarPlacementQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("../vips/0040-module-declarations.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{
		"When the file's VIP-27 sidecar",
		"is also written beside that sidecar",
		"or at the mirrored path under",
		"That copy is a compatibility declaration, an emit output as the sidecar is",
	} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("missing module body declaration rule: %s", quote)
		}
	}
	TestSidecarEmitRulesQuoted(t)
}

func checkModuleBodySidecarPlacement(t *testing.T, key string, mode uint8) {
	t.Helper()
	TestModuleBodySidecarPlacementQuoted(t)
	dir := t.TempDir()
	nested := ""
	if mode&2 != 0 {
		nested = "nested/"
	}
	ext := "vibe"
	if mode&4 != 0 {
		ext = "vibex"
	}
	name := "A." + ext
	body := key != "ordinary-control"
	data, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "smithers-module-body-sidecar-directory.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ Source string }
	var original map[string]json.RawMessage
	if err := json.Unmarshal(data, &original); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(original["src/A.vibe"], &fixture.Source); err != nil {
		t.Fatal(err)
	}
	source := "export const value = 1;\n"
	if body {
		source = fixture.Source
	}
	if mode&1 != 0 {
		source = strings.ReplaceAll(source, "\n", "\r\n")
	}
	authored := filepath.Join(dir, "src", nested+name)
	put := func(path, text string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	put(authored, source)
	options := map[string]any{"target": "ESNext", "module": "ESNext", "moduleResolution": "Bundler", "rootDir": "src", "strict": true, "types": []string{}, "skipLibCheck": true, "jsx": "preserve", "noEmit": true}
	if mode&8 != 0 {
		options["noEmit"] = false
		options["declaration"] = true
		options["emitDeclarationOnly"] = true
		options["outDir"] = "dist"
	}
	vibe := map[string]any{"effectGlobals": false, "effectModules": false}
	sidecar := "src"
	if key != "beside-control" {
		vibe["sidecarDir"] = ".vibe/declarations"
		sidecar = ".vibe/declarations"
	}
	config := map[string]any{"compilerOptions": options, "vibe": vibe, "include": []string{"src/**/*"}}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	put(filepath.Join(dir, "tsconfig.json"), string(encoded))
	sys := &sidecarLayoutSystem{&sidecarParitySystem{fs: bundled.WrapFS(osvfs.FS()), cwd: tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(dir))}}
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	result := execute.CommandLine(ctx, sys, []string{"-p", ".", "--pretty", "false"}, nil)
	cancel()
	if result.Status != 0 || ctx.Err() == context.DeadlineExceeded {
		t.Fatalf("module body project rejected: key=%s mode=%d status=%d context=%v\n%s", key, mode, result.Status, ctx.Err(), sys.output.String())
	}
	owner := filepath.Join(dir, sidecar, nested+"A.d."+ext+".ts")
	header := filepath.Join(dir, sidecar, nested+name+".throwing.d.ts")
	var misplaced []string
	if key != "beside-control" {
		err = filepath.WalkDir(filepath.Join(dir, "src"), func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !entry.IsDir() && strings.HasSuffix(path, ".d.ts") {
				rel, _ := filepath.Rel(dir, path)
				misplaced = append(misplaced, filepath.ToSlash(rel))
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if body {
		if _, err := os.Stat(header); err != nil || len(misplaced) != 0 {
			Gap(t, moduleBodyPlacementTarget, "placement:"+key, "VIP-40 writes the module body header beside the owning sidecar: header=%s missing=%v unexpected=%v\n%s", filepath.ToSlash(strings.TrimPrefix(header, dir+string(filepath.Separator))), err, misplaced, sys.output.String())
		}
	} else if len(misplaced) != 0 {
		t.Fatalf("ordinary source acquired generated source-directory declarations: %v", misplaced)
	}
	if _, err := os.Stat(owner); err != nil {
		t.Fatalf("missing owner sidecar: %v", err)
	}
	got, err := os.ReadFile(authored)
	if err != nil || string(got) != source {
		t.Fatalf("authored source changed: %v", err)
	}
	if body {
		tsc := StockTypeScript(t)
		stockCtx, stockCancel := context.WithTimeout(t.Context(), HangLimit)
		stockConfig := map[string]any{"compilerOptions": map[string]any{"noEmit": true, "strict": true, "skipLibCheck": false, "target": "ESNext", "module": "ESNext", "moduleResolution": "Bundler", "jsx": "preserve", "types": []string{}, "lib": []string{"ESNext"}}, "files": []string{owner}}
		stockJSON, err := json.Marshal(stockConfig)
		if err != nil {
			t.Fatal(err)
		}
		put(filepath.Join(dir, "tsconfig.stock.json"), string(stockJSON))
		cmd := exec.CommandContext(stockCtx, tsc, "-p", "tsconfig.stock.json", "--pretty", "false")
		cmd.Dir = dir
		output, err := cmd.CombinedOutput()
		contextErr := stockCtx.Err()
		stockCancel()
		if err != nil {
			t.Fatalf("sidecar cannot resolve its body in stock TypeScript: %v; context=%v\n%s", err, contextErr, output)
		}
	}
	ExpectPending(t, moduleBodyPlacementTarget, "placement:"+key)
	ExpectPending(t, moduleBodyPlacementTarget, specCorpusKey(t))
}

func FuzzModuleBodySidecarPlacement(f *testing.F) {
	startShortBudget(f)
	f.Add("ordinary-control", uint8(0))
	f.Add("beside-control", uint8(0))
	keys := []string{"module-body", "ordinary-control", "beside-control"}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		checkModuleBodySidecarPlacement(t, key, mode&15)
	})
}

func TestModuleBodySidecarPlacementNeighborhood(t *testing.T) {
	if testing.Short() {
		t.Skip("extended matrix runs without -short")
	}
	for _, key := range []string{"module-body", "ordinary-control", "beside-control"} {
		for mode := range 16 {
			t.Run(fmt.Sprintf("%s/%s", key, strconv.Itoa(mode)), func(t *testing.T) { checkModuleBodySidecarPlacement(t, key, uint8(mode)) })
		}
	}
}
