package tsoptions_test

import (
	"encoding/json"
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// Chapter 007 / native source extension discovery: docs/design/src/007-tooling.md#6ab03ac25ad1a0e7
func TestChapter007SourceExtensions(t *testing.T) {
	for _, name := range []string{"vibe.config.json", "tsconfig.json", "jsconfig.json"} {
		for _, shape := range []string{"files", "include", "default-exclude"} {
			t.Run(name+"/"+shape, func(t *testing.T) {
				files := map[string]string{}
				want := []tspath.RootedFilePath{}
				selected := []string{}
				for _, extension := range []string{"ts", "tsx", "vibe", "vibex"} {
					leaf := "file-" + extension + "." + extension
					files["/p/keep/"+leaf] = "export const n=1"
					files["/p/skip/"+leaf] = "export const n=1"
					want = append(want, tspath.RootedFilePath("/p/keep/"+leaf))
					selected = append(selected, "keep/"+leaf)
				}
				config := map[string]any{"compilerOptions": map[string]any{"jsx": "preserve"}}
				switch shape {
				case "files":
					config["files"] = selected
				case "include":
					config["include"] = []string{"keep/**/*"}
				case "default-exclude":
					config["exclude"] = []string{"skip"}
				}
				data, err := json.Marshal(config)
				if err != nil {
					t.Fatal(err)
				}
				files["/p/"+name] = string(data)
				fs := vfstest.FromMap(files, tspath.CaseSensitive)
				parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+name), &core.CompilerOptions{}, nil, fs, nil)
				if len(errors) != 0 || len(parsed.Errors) != 0 {
					t.Fatalf("%v %v", errors, parsed.Errors)
				}
				got := slices.Clone(parsed.FileNames())
				slices.Sort(got)
				slices.Sort(want)
				if !slices.Equal(got, want) {
					t.Fatal(fmt.Sprintf("discovered %v; want %v", got, want))
				}
			})
		}
	}
}
