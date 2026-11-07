package tsoptions_test

import (
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions/tsoptionstest"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func checkBuildOptionPath(t *testing.T, option, value, want string, response bool) {
	t.Helper()
	files := map[string]string{}
	args := []string{"--" + option, value}
	if response {
		files["/project/config/args.txt"] = "--" + option + " \"" + value + "\""
		args = []string{"@config/args.txt"}
	}
	fs := tsoptionstest.NewVFS(files, tspath.CaseSensitive)
	result := tsoptions.ParseBuildCommandLine(args, fs, tspath.RootedDirectoryPath("/project"))
	if len(result.Errors) != 0 {
		t.Fatalf("unexpected diagnostics: %+v", result.Errors)
	}
	data, err := json.Marshal(result.CompilerOptions)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	if fields[option] != want {
		t.Fatalf("%s: got %v want %s", option, fields[option], want)
	}
	raw := result.Raw.(*collections.OrderedMap[string, any])
	if got := raw.GetOrZero(option); got != value {
		t.Fatalf("original command spelling changed: got %v want %s", got, value)
	}
}

func TestBuildCompilerPathOptions(t *testing.T) {
	for _, option := range []string{"generateCpuProfile", "generateTrace", "pprofDir"} {
		for _, response := range []bool{false, true} {
			checkBuildOptionPath(t, option, "profiles/../with space/café", "/project/with space/café", response)
			checkBuildOptionPath(t, option, "../profiles", "/profiles", response)
			checkBuildOptionPath(t, option, "/absolute/profiles", "/absolute/profiles", response)
		}
	}
}

func FuzzBuildCompilerPathOptions(f *testing.F) {
	f.Add([]byte{}, uint8(0), false)
	f.Add([]byte{1, 255}, uint8(2), true)
	f.Fuzz(func(t *testing.T, data []byte, choice uint8, response bool) {
		if len(data) > 32 {
			data = data[:32]
		}
		name := "profile-" + hex.EncodeToString(data)
		option := []string{"generateCpuProfile", "generateTrace", "pprofDir"}[choice%3]
		checkBuildOptionPath(t, option, "./profiles/unused/../"+name, "/project/profiles/"+name, response)
	})
}
