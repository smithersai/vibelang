package build_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/execute/build"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsctests"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"gotest.tools/v3/assert"
)

// Chapter 7, "Config files": -p <dir> reads the first of vibe.config.json,
// tsconfig.json and jsconfig.json. A directory named by -b, the "." a bare -b
// stands for, and a directory in `references` name a project the same way.
func vibeConfigBuildFiles(libConfig string) tsctests.FileMap {
	project := `{ "compilerOptions": { "composite": true, "noLib": true, "outDir": "dist" }, "files": ["../lib.d.ts", "index.ts"]%s }`
	files := tsctests.FileMap{
		"/project/lib.d.ts": `
interface Array<T> {}
interface Boolean {}
interface CallableFunction {}
interface Function {}
interface IArguments {}
interface NewableFunction {}
interface Number {}
interface Object {}
interface RegExp {}
interface String {}
`,
		"/project/lib/index.ts":         "export const lib = 1;",
		"/project/app/index.ts":         `import { lib } from "../lib/index"; export const app = lib;`,
		"/project/app/vibe.config.json": strings.Replace(project, "%s", `, "references": [{ "path": "../lib" }]`, 1),
	}
	files["/project/lib/"+libConfig] = strings.Replace(project, "%s", "", 1)
	return files
}

func TestBuildResolvesDirectoryToVibeConfig(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name      string
		cwd       string
		args      []string
		libConfig string
	}{
		{"bare -b in the project directory", "/project/app", nil, "vibe.config.json"},
		{"-b <dir>", "/project", []string{"app"}, "vibe.config.json"},
		{"-b <config> with a directory reference", "/project", []string{"app/vibe.config.json"}, "vibe.config.json"},
		{"reference to a tsconfig.json directory", "/project/app", nil, "tsconfig.json"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			sys := &cleanTestSystem{TestSys: tsctests.NewTscSystem(vibeConfigBuildFiles(test.libConfig), tspath.CaseSensitive, tspath.RootedDirectoryPath(test.cwd))}
			command := tsoptions.ParseBuildCommandLine(append([]string{"--build"}, test.args...), sys.FS(), sys.GetCurrentDirectory())
			orchestrator := build.NewOrchestrator(build.Options{Sys: sys, Command: command})
			result := orchestrator.Build(t.Context(), "")
			assert.Equal(t, result.Result.Status, tsc.ExitStatusSuccess, sys.output.String())
			assert.DeepEqual(t, core.Map(orchestrator.Order(), tspath.RootedFilePath.AsString), []string{
				"/project/lib/" + test.libConfig, "/project/app/vibe.config.json",
			})
			assert.Assert(t, sys.FS().FileExists("/project/lib/dist/index.js"))
			assert.Assert(t, sys.FS().FileExists("/project/app/dist/index.js"))
		})
	}
}

func TestBuildPrefersVibeConfigOverTsconfig(t *testing.T) {
	t.Parallel()
	files := vibeConfigBuildFiles("vibe.config.json")
	// A tsconfig.json beside vibe.config.json is not the project: this one cannot build.
	files["/project/lib/tsconfig.json"] = `{ "files": ["missing.ts"] }`
	files["/project/app/tsconfig.json"] = `{ "files": ["missing.ts"] }`
	sys := &cleanTestSystem{TestSys: tsctests.NewTscSystem(files, tspath.CaseSensitive, "/project")}
	command := tsoptions.ParseBuildCommandLine([]string{"--build", "app"}, sys.FS(), sys.GetCurrentDirectory())
	orchestrator := build.NewOrchestrator(build.Options{Sys: sys, Command: command})
	result := orchestrator.Build(t.Context(), "app")
	assert.Equal(t, result.Result.Status, tsc.ExitStatusSuccess, sys.output.String())
	assert.DeepEqual(t, core.Map(orchestrator.Order(), tspath.RootedFilePath.AsString), []string{
		"/project/lib/vibe.config.json", "/project/app/vibe.config.json",
	})
}

func TestBuildNamesTsconfigWhenDirectoryHasNoConfig(t *testing.T) {
	t.Parallel()
	sys := &cleanTestSystem{TestSys: tsctests.NewTscSystem(tsctests.FileMap{"/project/app/index.ts": "export {}"}, tspath.CaseSensitive, "/project")}
	command := tsoptions.ParseBuildCommandLine([]string{"--build", "app"}, sys.FS(), sys.GetCurrentDirectory())
	orchestrator := build.NewOrchestrator(build.Options{Sys: sys, Command: command})
	result := orchestrator.Build(t.Context(), "")
	assert.Assert(t, result.Result.Status != tsc.ExitStatusSuccess)
	assert.Assert(t, strings.Contains(sys.output.String(), "app/tsconfig.json"), sys.output.String())
}
