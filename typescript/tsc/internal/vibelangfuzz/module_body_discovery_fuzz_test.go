package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const moduleBodyDiscoveryTarget = "FuzzModuleBodyDiscoveryParity"

var moduleBodyDiscoveryKeys = []string{
	"include/present", "include/deleted", "default/present",
	"default/deleted", "files/present", "files/deleted",
}

func TestModuleBodyDiscoveryQuoted(t *testing.T) { moduleBodyDiscoveryQuoted(t) }

func moduleBodyDiscoveryQuoted(t testing.TB) {
	const discovery = "Discovery through `include` or default globs selects the source and omits its compatibility declaration, as native `.ts`/`.d.ts` discovery does."
	const explicit = "A declaration explicitly selected in `files` remains an input: an attempted compatibility write over it reports `TS5055`"
	for _, quote := range []string{discovery, explicit} {
		if !strings.Contains(SpecText("../vips/0027-declaration-output.md"), quote) {
			t.Fatalf("VIP-27 no longer says %q", quote)
		}
	}
	const twin = "changes no diagnostic, type, emitted statement, declaration or run-time observation."
	if !strings.Contains(SpecText("../vips/0040-module-declarations.md"), twin) {
		t.Fatalf("VIP-40 no longer says %q", twin)
	}
}

func moduleBodyDiscoveryKey(key string, variant uint8) string {
	if slices.Contains(moduleBodyDiscoveryKeys, key) {
		return key
	}
	return moduleBodyDiscoveryKeys[int(variant)%len(moduleBodyDiscoveryKeys)]
}

type moduleBodyDiscoveryInput struct {
	config      string
	files       map[string]string
	declaration string
}

func moduleBodyDiscoveryProject(key string, variant uint8, native bool) moduleBodyDiscoveryInput {
	parts := strings.Split(key, "/")
	present := parts[1] == "present"
	prefix := []string{"src/", "src/deep/", "src/pkg.vibe/"}[int(variant)%3]
	name := []string{"parse", "codec", "api_v2"}[int(variant>>4)%3]
	suffix, tsSuffix := "vibe", "ts"
	if variant&8 != 0 {
		suffix, tsSuffix = "vibex", "tsx"
	}
	main := prefix + "main." + suffix
	child := prefix + "main." + suffix + "." + name + "." + tsSuffix
	declaration := prefix + "main." + suffix + "." + name + ".d.ts"
	files := map[string]string{declaration: "export declare const value: 7\n"}
	source := "export const outer = 1\n"
	if present {
		source = "module " + name + " { export const value: 7 = 7 }\nexport {value} from " + name + "\n"
	}
	selected := []string{main}
	if native {
		main = prefix + "main." + tsSuffix
		selected = []string{main}
		source = "export const outer = 1\n"
		if present {
			source = "export {value} from './main." + suffix + "." + name + ".js'\n"
			files[child] = "export const value: 7 = 7\n"
			selected = append(selected, child)
		}
	}
	files[main] = source
	config := map[string]any{
		"compilerOptions": map[string]any{"noLib": true, "types": []string{}, "target": "ESNext", "module": "ESNext", "moduleResolution": "Bundler", "declaration": true, "jsx": "preserve"},
		"vibe":            map[string]any{"effectGlobals": false, "effectModules": false},
	}
	switch parts[0] {
	case "include":
		config["include"] = []string{"src"}
	case "files":
		config["files"] = append(selected, declaration)
	}
	data, err := json.Marshal(config)
	if err != nil {
		panic(err)
	}
	return moduleBodyDiscoveryInput{string(data), files, declaration}
}

func moduleBodyDiscoveryObserve(t *testing.T, input moduleBodyDiscoveryInput) (bool, bool) {
	t.Helper()
	const root = "/case/"
	files := map[string]any{root + "tsconfig.json": input.config}
	for name, text := range input.files {
		files[root+name] = text
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
	config, ds := tsoptions.GetParsedCommandLineOfConfigFile(root+"tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(ds) != 0 || config == nil {
		t.Fatalf("invalid discovery fixture: %v", ds)
	}
	found := false
	for _, name := range config.FileNames() {
		if string(name) == root+input.declaration {
			found = true
		}
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	blocked := false
	for _, diagnostic := range program.GetProgramDiagnostics() {
		if diagnostic.Code() == 5055 {
			blocked = true
		}
	}
	return found, blocked
}

// Compare two inputs the VIP-40 copy rule makes equivalent. Bodies export a
// value, so this does not overlap R29 ASTRA-1's no-export module classification.
// Keep deleted bodies: an orphan declaration is an ordinary input, just as
// after deleting its native sibling. Explicit files keep overwrite protection.
func checkModuleBodyDiscovery(t *testing.T, key string, variant uint8) {
	t.Helper()
	native := moduleBodyDiscoveryProject(key, variant, true)
	want, blocked := moduleBodyDiscoveryObserve(t, native)
	expected := strings.HasPrefix(key, "files/") || strings.HasSuffix(key, "/deleted")
	expectedBlocked := key == "files/present"
	if want != expected || blocked != expectedBlocked {
		t.Fatalf("native control %s/%d: discovery=%t overwrite=%t, expected %t/%t", key, variant, want, blocked, expected, expectedBlocked)
	}
	got, gotBlocked := moduleBodyDiscoveryObserve(t, moduleBodyDiscoveryProject(key, variant, false))
	gap := fmt.Sprintf("%s/%d", key, variant%48)
	if got != want || gotBlocked != blocked {
		Gap(t, moduleBodyDiscoveryTarget, gap, "VIP-40 sibling/native parity: declaration selected=%t/%t, TS5055=%t/%t (Vibe/native)", got, want, gotBlocked, blocked)
	}
	ExpectPending(t, moduleBodyDiscoveryTarget, gap)
	ExpectPending(t, moduleBodyDiscoveryTarget, specCorpusKey(t))
}

func FuzzModuleBodyDiscoveryParity(f *testing.F) {
	startShortBudget(f)
	moduleBodyDiscoveryQuoted(f)
	for i, key := range moduleBodyDiscoveryKeys {
		f.Add(key, uint8(i%3*17))
		f.Add(key, uint8(i%3*17+8))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		checkModuleBodyDiscovery(t, moduleBodyDiscoveryKey(key, variant), variant)
	})
}

func TestModuleBodyDiscoveryParity(t *testing.T) {
	moduleBodyDiscoveryQuoted(t)
	for _, key := range moduleBodyDiscoveryKeys {
		for _, variant := range []uint8{0, 17, 34, 8, 25, 42} {
			t.Run(fmt.Sprintf("%s/%d", key, variant), func(t *testing.T) { checkModuleBodyDiscovery(t, key, variant) })
		}
	}
}

// Independent stock tsc validates both the native discovery formula and the
// input list which the in-memory comparison uses, with no compiler internals.
func TestModuleBodyDiscoveryStockControls(t *testing.T) {
	stock := StockTypeScript(t)
	for _, key := range moduleBodyDiscoveryKeys {
		for _, variant := range []uint8{0, 8} {
			t.Run(fmt.Sprintf("%s/%d", key, variant), func(t *testing.T) {
				input := moduleBodyDiscoveryProject(key, variant, true)
				dir := t.TempDir()
				for name, text := range input.files {
					path := filepath.Join(dir, filepath.FromSlash(name))
					if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(path, []byte(text), 0600); err != nil {
						t.Fatal(err)
					}
				}
				if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(input.config), 0600); err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
				defer cancel()
				cmd := exec.CommandContext(ctx, stock, "-p", "tsconfig.json", "--listFilesOnly", "--pretty", "false")
				cmd.Dir = dir
				output, err := cmd.CombinedOutput()
				if key == "files/present" {
					exit, ok := err.(*exec.ExitError)
					if !ok || exit.ExitCode() != 1 || strings.Count(string(output), "error TS5055:") != 1 {
						t.Fatalf("explicit native input must report TS5055/exit1: %v\n%s", err, output)
					}
					for _, line := range strings.Split(string(output), "\n") {
						if strings.Contains(line, "error TS") && !strings.Contains(line, "error TS5055:") {
							t.Fatalf("unrelated native error: %s", line)
						}
					}
				} else if err != nil {
					t.Fatalf("native stock discovery: %v\n%s", err, output)
				}
				found := slices.Contains(strings.Fields(strings.ReplaceAll(string(output), "\\", "/")), filepath.ToSlash(filepath.Join(dir, input.declaration)))
				expected := strings.HasPrefix(key, "files/") || strings.HasSuffix(key, "/deleted")
				if found != expected {
					t.Fatalf("stock discovery %s: selected=%t expected=%t\n%s", key, found, expected, output)
				}
			})
		}
	}
}
