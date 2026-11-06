package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const sidecarParallelQuote = "Workspace package imports use the owning config to keep a relocated sidecar and its source as one module; published packages retain declarations."

func TestParallelSidecarLayoutSpecQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), sidecarParallelQuote) {
		t.Fatal(sidecarParallelQuote)
	}
}

// Different importing directories exercise independent resolution-cache keys.
// The owning source identity still follows the project's declaration layout,
// while an output outside that layout remains a declaration.
func FuzzRelocatedSidecarParallelImports(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"inferred", "explicit", "composite", "unowned"} {
		f.Add(key, []byte{0, 0})
		f.Add(key, []byte{14, 2})
	}
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		at := func(i int) byte {
			if i < len(data) {
				return data[i]
			}
			return 0
		}
		keys := []string{"inferred", "explicit", "composite", "unowned"}
		known := false
		for _, k := range keys {
			known = known || key == k
		}
		if !known {
			key = keys[len(key)%len(keys)]
		}
		count := 2 + int(at(0)%15)
		mirror := "types/" + strings.Repeat("nested/", int(at(1)%3))
		suffix := "value.d.vibe.ts"
		options := map[string]any{"noLib": true, "noEmit": true, "module": "nodenext", "allowArbitraryExtensions": true, "allowImportingTsExtensions": true}
		if key == "explicit" {
			options["rootDir"] = "src"
		}
		if key == "composite" {
			options["composite"] = true
			suffix = "src/" + suffix
		}
		target := mirror + suffix
		if key == "unowned" {
			target = "unowned/" + suffix
		}
		cfg := map[string]any{"compilerOptions": options, "vibe": map[string]any{"effectGlobals": false, "effectModules": false, "sidecarDir": mirror}, "files": []string{"src/value.vibe"}}
		rawCfg, err := json.Marshal(cfg)
		if err != nil {
			t.Fatal(err)
		}
		files := map[string]any{
			"/app/package.json":     `{"type":"module"}`,
			"/app/node_modules/lib": vfstest.Symlink("/lib"),
			"/lib/package.json":     fmt.Sprintf(`{"name":"lib","type":"module","types":%q}`, "./"+target),
			"/lib/tsconfig.json":    string(rawCfg),
			"/lib/src/value.vibe":   `export const value = 1;`,
			"/lib/" + target:        `export declare const value: 1;`,
		}
		roots := []string{}
		for i := range count {
			name := fmt.Sprintf("p%d/main.ts", i)
			roots = append(roots, name)
			files["/app/"+name] = `import {value} from "lib"; export const copy = value;`
		}
		main, err := json.Marshal(map[string]any{"compilerOptions": map[string]any{"noLib": true, "noEmit": true, "module": "nodenext", "allowArbitraryExtensions": true, "allowImportingTsExtensions": true}, "vibe": map[string]any{"effectGlobals": false, "effectModules": false}, "files": roots})
		if err != nil {
			t.Fatal(err)
		}
		files["/app/tsconfig.json"] = string(main)
		fs := vfstest.FromMap(files, tspath.CaseSensitive)
		parsed, ds := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(ds) > 0 || len(parsed.Errors) > 0 {
			t.Fatalf("config: %v %v", ds, parsed.Errors)
		}
		p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, "/", nil, nil, nil)})
		source := p.GetSourceFile("/lib/src/value.vibe") != nil
		declaration := p.GetSourceFile(tspath.RootedFilePathFromNormalized("/lib/"+target)) != nil
		if source != (key != "unowned") || declaration != (key == "unowned") {
			Gap(t, "FuzzRelocatedSidecarParallelImports", key+":source-identity", "source=%t declaration=%t mode=%s", source, declaration, key)
		}
	})
}
