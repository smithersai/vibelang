package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions/tsoptionstest"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VIP-30 retains native TypeScript configuration behavior. These are static
// path-resolution controls, not an Effect runtime comparison.
const configPathBaseQuote = "Ordinary relative paths, including relative `extends` entries, resolve from the config that declares them. A leading `${configDir}` in a supported path field instead expands from the selected project config’s directory, even when that field is inherited."

func TestConfigPathBasesQuoted(t *testing.T) { requireConfigPathBasesQuote(t) }

func requireConfigPathBasesQuote(t testing.TB) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), configPathBaseQuote) {
		t.Fatalf("007-config-configDir-inheritance: chapter 007 omits the native path-base rule %q", configPathBaseQuote)
	}
}

var configPathBaseKeys = []string{
	"relative", "template", "child-relative", "child-template", "array-relative", "array-template",
}

func TestConfigPathBases(t *testing.T) {
	for _, key := range configPathBaseKeys {
		for mode := uint8(0); mode < 6; mode++ {
			t.Run(fmt.Sprintf("%s/%d", key, mode), func(t *testing.T) {
				checkConfigPathBases(t, key, mode, mode)
			})
		}
	}
}

// Keyed inputs preserve each neighborhood when the seed list changes. Depth,
// config filename, files versus include/exclude, and normalized path spelling
// vary independently. No build, node process or package install is needed.
func FuzzConfigPathBases(f *testing.F) {
	startShortBudget(f)
	for _, key := range configPathBaseKeys {
		f.Add(key, uint8(1), uint8(0))
	}
	requireConfigPathBasesQuote(f)
	f.Fuzz(func(t *testing.T, key string, depth, mode uint8) {
		if !slices.Contains(configPathBaseKeys, key) {
			key = "template" // legacy/unkeyed mutation; named corpus stays stable
		}
		checkConfigPathBases(t, key, depth, mode)
	})
}

func checkConfigPathBases(t testing.TB, key string, depth, mode uint8) {
	t.Helper()
	depth %= 4
	childDir := "/project/app" + strings.Repeat("/nested", int(depth))
	configName := []string{"tsconfig.json", "jsconfig.json", "vibe.config.json"}[mode%3]
	filename := childDir + "/" + configName
	template := strings.HasSuffix(key, "template")
	owner := "/project/shared"
	if strings.HasPrefix(key, "child-") {
		owner = childDir
	}
	if strings.HasPrefix(key, "array-") {
		owner = "/project/late"
	}
	expectedBase := owner
	if template {
		expectedBase = childDir
	}
	prefix := "./"
	if template {
		prefix = "${configDir}/"
	}
	if mode&4 != 0 {
		prefix += "unused/../"
	}
	makeConfig := func(p string) map[string]any {
		c := map[string]any{
			"compilerOptions": map[string]any{
				"outDir": p + "dist", "rootDir": p + "input",
				"declarationDir": p + "types", "tsBuildInfoFile": p + "build/state.tsbuildinfo",
				"rootDirs":  []any{p + "input", p + "generated"},
				"typeRoots": []any{p + "custom-types", p + "node_modules/@types"},
				"paths":     map[string]any{"alias/*": []any{p + "lib/*", p + "fallback/*"}},
			},
		}
		if mode&1 == 0 {
			c["include"] = []any{p + "input/**/*.ts"}
			c["exclude"] = []any{p + "input/skip.ts"}
		} else {
			c["files"] = []any{p + "input/main.ts"}
		}
		return c
	}
	encode := func(v any) string {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	files := map[string]string{
		"/project/shared/base.json": encode(makeConfig(prefix)),
		"/project/chain/mid.json":   `{"extends":"../shared/base.json"}`,
	}
	up := strings.Repeat("../", int(depth)+1)
	child := map[string]any{"extends": up + "chain/mid.json"}
	if strings.HasPrefix(key, "child-") {
		child = makeConfig(prefix)
		child["extends"] = up + "chain/mid.json"
	}
	if strings.HasPrefix(key, "array-") {
		// The first base deliberately has a different root; the later one wins.
		files["/project/shared/base.json"] = encode(makeConfig("./first/"))
		files["/project/late/base.json"] = encode(makeConfig(prefix))
		child["extends"] = []any{up + "chain/mid.json", up + "late/base.json"}
	}
	for _, base := range []string{"/project/shared", "/project/late", childDir} {
		for _, stem := range []string{"", "/first"} {
			files[base+stem+"/input/main.ts"] = "export const value = 1"
			files[base+stem+"/input/skip.ts"] = "export const skip = 2"
		}
	}
	files[filename] = encode(child)
	fs := tsoptionstest.NewVFS(files, tspath.CaseSensitive)
	parsed := tsoptions.ParseJsonConfigFileContent(child, fs, tspath.RootedDirectoryPath(childDir), nil, tspath.RootedFilePath(filename), nil, nil)
	if len(parsed.Errors) != 0 {
		Gap(t, "FuzzConfigPathBases", key+":diagnostics", "unexpected config diagnostics: %v", parsed.Errors)
	}
	options := parsed.CompilerOptions()
	scalars := map[string]string{
		"dist": string(options.OutDir), "input": string(options.RootDir),
		"types": string(options.DeclarationDir), "build/state.tsbuildinfo": string(options.TsBuildInfoFile),
	}
	for suffix, got := range scalars {
		if want := path.Join(expectedBase, suffix); got != want {
			Gap(t, "FuzzConfigPathBases", key+":"+suffix, "got %q, want %q", got, want)
		}
	}
	for index, suffix := range []string{"input", "generated"} {
		if len(options.RootDirs) != 2 || string(options.RootDirs[index]) != path.Join(expectedBase, suffix) {
			Gap(t, "FuzzConfigPathBases", key+":rootDirs", "got %v", options.RootDirs)
		}
	}
	for index, suffix := range []string{"custom-types", "node_modules/@types"} {
		if len(options.TypeRoots) != 2 || string(options.TypeRoots[index]) != path.Join(expectedBase, suffix) {
			Gap(t, "FuzzConfigPathBases", key+":typeRoots", "got %v", options.TypeRoots)
		}
	}
	paths := options.Paths.GetOrZero("alias/*")
	for index, suffix := range []string{"lib/*", "fallback/*"} {
		if len(paths) != 2 {
			Gap(t, "FuzzConfigPathBases", key+":paths", "got %v", paths)
		}
		got := paths[index]
		if !path.IsAbs(got) {
			got = path.Join(string(options.GetPathsBasePath(tspath.RootedDirectoryPath(childDir))), got)
		}
		if got != path.Join(expectedBase, suffix) {
			Gap(t, "FuzzConfigPathBases", key+":paths", "got %q, want %q", got, path.Join(expectedBase, suffix))
		}
	}
	expectedFile := tspath.RootedFilePath(path.Join(expectedBase, "input/main.ts"))
	if !slices.Equal(parsed.FileNames(), []tspath.RootedFilePath{expectedFile}) {
		Gap(t, "FuzzConfigPathBases", key+":files", "files/include/exclude: got %v, want [%s]", parsed.FileNames(), expectedFile)
	}
	for _, field := range []string{"diagnostics", "dist", "input", "types", "build/state.tsbuildinfo", "rootDirs", "typeRoots", "paths", "files"} {
		ExpectPending(t, "FuzzConfigPathBases", key+":"+field)
	}
}
