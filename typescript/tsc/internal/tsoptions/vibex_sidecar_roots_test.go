package tsoptions_test

import (
	"encoding/json"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"slices"
	"testing"
)

func TestVibexSidecarWildcardRoots(t *testing.T) {
	for _, ext := range []string{".vibe", ".vibex"} {
		for _, relocated := range []bool{false, true} {
			for _, explicit := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/relocated=%v/explicit=%v", ext, relocated, explicit), func(t *testing.T) {
					source := "src/App" + ext
					sidecar := "src/App.d" + ext + ".ts"
					if relocated {
						sidecar = "types/" + sidecar
					}
					config := map[string]any{"compilerOptions": map[string]any{"jsx": "preserve"}}
					if explicit {
						config["files"] = []string{source, sidecar}
					} else {
						config["include"] = []string{"**/*"}
					}
					if relocated {
						config["vibe"] = map[string]any{"sidecarDir": "types"}
					}
					text, err := json.Marshal(config)
					if err != nil {
						t.Fatal(err)
					}
					fs := vfstest.FromMap(map[string]string{
						"/project/tsconfig.json":             string(text),
						"/project/" + source:                 "export const value=1;",
						"/project/" + sidecar:                "export const value: number;",
						"/project/published.d" + ext + ".ts": "export const value: number;",
					}, tspath.CaseSensitive)
					parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
					if len(errors) != 0 {
						t.Fatal(errors)
					}
					has := slices.Contains(parsed.FileNames(), tspath.RootedFilePath("/project/"+sidecar))
					if has != explicit {
						t.Errorf("sidecar root present=%v, want %v; roots=%v", has, explicit, parsed.FileNames())
					}
					if !explicit && !slices.Contains(parsed.FileNames(), tspath.RootedFilePath("/project/published.d"+ext+".ts")) {
						t.Fatal("unpaired published declaration must stay a root")
					}
				})
			}
		}
	}
}
