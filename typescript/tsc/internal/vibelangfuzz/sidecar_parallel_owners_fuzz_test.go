package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// Several owning projects with different layouts are imported in parallel by
// one program, so their layouts are probed and cached side by side. The rule
// (sidecarParallelQuote, 007-tooling.md) holds for each owner on its own: an
// owned relocated sidecar joins its source, and an unowned output stays a
// declaration. The key names the owners' layouts in order, such as
// "inferred,unowned,explicit".
func FuzzRelocatedSidecarParallelOwners(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"inferred,inferred", "inferred,explicit", "composite,inferred,unowned", "unowned,inferred,explicit"} {
		f.Add(key, []byte{0, 0})
		f.Add(key, []byte{14, 2})
	}
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		TestParallelSidecarLayoutSpecQuoted(t)
		at := func(i int) byte {
			if i < len(data) {
				return data[i]
			}
			return 0
		}
		layouts := []string{"inferred", "explicit", "composite", "unowned"}
		modes := []string{}
		for _, mode := range strings.Split(key, ",") {
			for _, layout := range layouts {
				if mode == layout {
					modes = append(modes, mode)
				}
			}
		}
		if len(modes) == 0 || len(modes) > 3 || len(modes) != strings.Count(key, ",")+1 {
			modes = modes[:0]
			for i := range 1 + int(at(0)%3) {
				modes = append(modes, layouts[int(at(2+i))%len(layouts)])
			}
		}
		key = strings.Join(modes, ",")
		importers := 2 + int(at(1)%15)
		options := func() map[string]any {
			return map[string]any{"noLib": true, "noEmit": true, "module": "nodenext", "allowArbitraryExtensions": true, "allowImportingTsExtensions": true}
		}
		files := map[string]any{"/app/package.json": `{"type":"module"}`}
		targets := []string{}
		for i, mode := range modes {
			name := fmt.Sprintf("lib%d", i)
			owner := options()
			suffix := "value.d.vibe.ts"
			switch mode {
			case "explicit":
				owner["rootDir"] = "src"
			case "composite":
				owner["composite"] = true
				suffix = "src/" + suffix
			}
			target := "types/" + suffix
			if mode == "unowned" {
				target = "unowned/" + suffix
			}
			targets = append(targets, target)
			config, err := json.Marshal(map[string]any{"compilerOptions": owner, "vibe": map[string]any{"effectGlobals": false, "effectModules": false, "sidecarDir": "types"}, "files": []string{"src/value.vibe"}})
			if err != nil {
				t.Fatal(err)
			}
			files["/app/node_modules/"+name] = vfstest.Symlink("/" + name)
			files["/"+name+"/package.json"] = fmt.Sprintf(`{"name":%q,"type":"module","types":%q}`, name, "./"+target)
			files["/"+name+"/tsconfig.json"] = string(config)
			files["/"+name+"/src/value.vibe"] = fmt.Sprintf("export const value = %d;", i)
			files["/"+name+"/"+target] = fmt.Sprintf("export declare const value: %d;", i)
		}
		roots := []string{}
		for i := range importers {
			file := fmt.Sprintf("p%d/main.ts", i)
			roots = append(roots, file)
			lines := []string{}
			for j := range modes {
				lines = append(lines, fmt.Sprintf("export { value as v%d } from \"lib%d\";", j, j))
			}
			files["/app/"+file] = strings.Join(lines, "\n")
		}
		main, err := json.Marshal(map[string]any{"compilerOptions": options(), "vibe": map[string]any{"effectGlobals": false, "effectModules": false}, "files": roots})
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
		for i, mode := range modes {
			name := fmt.Sprintf("/lib%d/", i)
			source := p.GetSourceFile(tspath.RootedFilePath(name+"src/value.vibe")) != nil
			declaration := p.GetSourceFile(tspath.RootedFilePathFromNormalized(name+targets[i])) != nil
			if source != (mode != "unowned") || declaration != (mode == "unowned") {
				Gap(t, "FuzzRelocatedSidecarParallelOwners", fmt.Sprintf("%s:%d:source-identity", key, i), "source=%t declaration=%t owner %d of %s", source, declaration, i, key)
			}
		}
	})
}
