package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

const missingRuntimeQuote = "A compilation whose emitted JavaScript imports `vibelang-runtime` and cannot resolve that package fails with one error naming it, TypeScript's `TS2307` for a missing module"
const missingRuntimeModulesQuote = "| `vibe.effectModules` | Boolean switch, default `true`, for Effect's modules in scope"
const missingRuntimeIndependentQuote = "including independent errors in embedded expressions and types."

func missingRuntimeQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{missingRuntimeQuote, missingRuntimeIndependentQuote, missingRuntimeModulesQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 7 no longer says %q", quote)
		}
	}
}
func TestMissingRuntimeQuoted(t *testing.T) { missingRuntimeQuoted(t) }

func FuzzMissingRuntimeDependency(f *testing.F) {
	startShortBudget(f)
	missingRuntimeQuoted(f)
	keys := []string{"effect", "producer", "catch", "catch-destructure", "catch-rest", "error", "value", "plain", "independent", "explicit", "independent-any", "explicit-only", "disabled-module", "foreign-explicit", "foreign-independent", "native-only"}
	for _, key := range keys {
		f.Add([]byte(key))
		f.Add([]byte(key + "\x00\x03"))
	}
	f.Add([]byte("disabled-module\x00\x02"))
	f.Add([]byte("explicit-only\x00\x0e"))
	f.Add([]byte("explicit\x00\x01"))
	f.Add([]byte("explicit\x00\x02"))
	f.Add([]byte("explicit\x00\x05"))
	f.Add([]byte("explicit\x00\x09"))
	f.Add([]byte("independent-any\x00\x04"))
	f.Add([]byte("independent-any\x00\x08"))
	f.Add([]byte("independent-any\x00\x10"))
	f.Add([]byte("independent-any\x00\x14"))
	f.Add([]byte("independent-any\x00\x18"))
	absent, present := NewWorkspace(f), NewWorkspace(f)
	absent.fs = missingRuntimeFuzzFS{absent.fs}
	// This is a test-owned copy under f.TempDir, not the checkout runtime.
	runtime := filepath.Join(absent.Dir, "node_modules", "vibelang-runtime")
	if err := os.Rename(runtime, filepath.Join(absent.Dir, "disabled-runtime")); err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		known := false
		for _, k := range keys {
			known = known || key == k
		}
		if !known {
			key = "effect"
		}
		count := 1
		if len(parts) == 2 && len(parts[1]) > 0 {
			count += int(parts[1][0]) % 3
		}
		implicitCode := int32(7006)
		innerParameter, innerArgument := "x", "0"
		if len(parts) == 2 && len(parts[1]) > 0 {
			switch (parts[1][0] >> 2) % 3 {
			case 1:
				implicitCode, innerParameter = 7019, "...xs"
			case 2:
				implicitCode, innerParameter, innerArgument = 7031, "{ n }", "{ n: 1 }"
			}
		}
		files := map[string]string{"package.json": `{"name":"missing-runtime-fuzz","type":"module"}`}
		var names []string
		for i := 0; i < count; i++ {
			name := fmt.Sprintf("source%d.vibe", i)
			source := fmt.Sprintf("export effect function value%d() { return %d }\n", i, i)
			switch key {
			case "producer":
				source = fmt.Sprintf("export effect function* value%d() { yield %d }\n", i, i)
			case "catch":
				source = fmt.Sprintf("export effect function value%d() { return Effect.fail(%d) catch (_e) => 0 }\n", i, i)
			case "catch-destructure":
				source = fmt.Sprintf("export effect function value%d() { return Effect.fail({ message: 'bad' }) catch ({ message }) => message.length }\n", i)
			case "catch-rest":
				source = fmt.Sprintf("export effect function value%d() { return Effect.fail(%d) catch (...errors) => errors.length }\n", i, i)
			case "error":
				source = fmt.Sprintf("export error Missing%d { id: string }\n", i)
			case "value":
				source = fmt.Sprintf("export const value%d = Experimental\n", i)
			case "plain":
				source = fmt.Sprintf("export function value%d(): number { return %d }\n", i, i)
			}
			if key == "disabled-module" {
				source = fmt.Sprintf("export effect function value%d() { return Effect }\n", i)
			}
			if key == "independent-any" {
				source = fmt.Sprintf("export effect function value%d() { return Effect.fail(%d) catch (_e) => { const inner = (%s): number => 1; return inner(%s) } }\n", i, i, innerParameter, innerArgument)
			}
			if key == "independent-any" && len(parts) == 2 && len(parts[1]) > 0 && parts[1][0]&16 != 0 {
				source = fmt.Sprintf("export effect function value%d() { return Effect.fail(%d) catch (_e) => { const invoke = (cb: any): number => cb(%s); return invoke((%s): number => 1) } }\n", i, i, innerArgument, innerParameter)
			}
			if key == "explicit" || key == "explicit-only" {
				if key == "explicit-only" {
					source = fmt.Sprintf("export const value%d = Existing\n", i)
				}
				module := "vibelang-runtime"
				if len(parts) == 2 && len(parts[1]) > 0 && parts[1][0]&8 != 0 {
					module += "/experimental"
				}
				prefix := ""
				if len(parts) == 2 && len(parts[1]) > 0 && parts[1][0]&4 != 0 {
					prefix = "export const before = 1\n"
				}
				source = prefix + "import * as Existing from \"" + module + "\"\n" + source
			}
			if key == "independent" && i == 0 {
				source += "export const wrong: number = 'bad'\n"
			}
			if i%2 != 0 {
				source = "/* retained */\n" + strings.ReplaceAll(source, "\n", "\r\n")
			}
			if key == "native-only" {
				name = fmt.Sprintf("source%d.ts", i)
				source = "import * as Existing from \"vibelang-runtime\"\nexport const value = Existing\n"
			}
			files[name] = source
			names = append(names, name)
			if key == "foreign-explicit" || key == "foreign-independent" {
				foreign := fmt.Sprintf("foreign%d.ts", i)
				module := "vibelang-runtime"
				if len(parts) == 2 && len(parts[1]) > 0 && parts[1][0]&8 != 0 {
					module += "/experimental"
					foreign = "nested path/" + foreign
				}
				text := "import * as Existing from \"" + module + "\"\nexport const value = Existing\n"
				if key == "foreign-independent" && i == 0 {
					text += "export const wrong: number = 'bad'\n"
				}
				files[foreign] = text
				if len(parts) == 2 && len(parts[1]) > 0 && parts[1][0]&4 != 0 {
					names = append([]string{foreign}, names...)
				} else {
					names = append(names, foreign)
				}
			}
		}
		listed, _ := json.Marshal(names)
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"types":[]},"files":%s}`, listed)
		if key == "disabled-module" {
			config = strings.TrimSuffix(config, "}") + `,"vibe":{"effectModules":false}}`
		}
		// Chapter 7's TS2307 rule holds only for a compilation whose emitted JavaScript imports vibelang-runtime. Under
		// VIP-1 an effect function lowers to effect/Effect alone, so the shape does not decide it: emit the program with
		// the runtime installed and expect the missing-runtime error only when that emit imports the package.
		// A source that writes its own import of the package (explicit, foreign, native-only) needs it whatever the emit.
		writesImport := strings.HasPrefix(key, "explicit") || strings.HasPrefix(key, "foreign") || key == "native-only"
		vibeImports := func() bool {
			r, err := present.Compile(t.Context(), Project{Files: files, Config: strings.Replace(config, `"noEmit":true`, `"noEmit":false`, 1)})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			for name, out := range r.Outputs {
				if strings.HasPrefix(filepath.Base(name), "source") && strings.Contains(out, `"vibelang-runtime`) {
					return true
				}
			}
			return false
		}()
		importsRuntime := writesImport || vibeImports
		for _, control := range []struct {
			key     string
			w       *Workspace
			missing bool
		}{{"absent", absent, true}, {"installed", present, false}} {
			r, err := control.w.Compile(t.Context(), Project{Files: files, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			want := map[int32]int{}
			if key != "plain" && control.missing && importsRuntime {
				want[2307] = 1
			}
			if key == "native-only" && control.missing {
				want[2307] = count
			}
			// Each foreign .ts file's own import reports TS2307 where it stands; only a .vibe emit that imports the
			// package makes it one error for the compilation (chapter 7), as before VIP-1 every effect function did.
			if strings.HasPrefix(key, "foreign") && control.missing && !vibeImports {
				want[2307] = count
			}
			if key == "disabled-module" {
				want[2304] = count
			}
			if key == "independent" || key == "foreign-independent" {
				want[2322] = 1
			}
			if key == "independent-any" {
				want[implicitCode] = count
			}
			got := map[int32]int{}
			var messages []string
			for _, d := range r.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				got[d.Code()]++
				messages = append(messages, d.String())
				if d.Code() == 2307 && !strings.Contains(d.String(), "vibelang-runtime") {
					t.Fatalf("wrong missing package: %s", d.String())
				}
			}
			same := len(want) == len(got)
			for code, n := range want {
				same = same && got[code] == n
			}
			gap := key + ":" + control.key
			if !same {
				Gap(t, "FuzzMissingRuntimeDependency", gap, "chapter 7: %s; want %v, got %v:\n%s", missingRuntimeQuote, want, got, strings.Join(messages, "\n"))
				return
			}
			ExpectPending(t, "FuzzMissingRuntimeDependency", gap)
		}
		ExpectPending(t, "FuzzMissingRuntimeDependency", specCorpusKey(t))
	})
}

// A missing-runtime oracle must not see installations above its workspace.
type missingRuntimeFuzzFS struct{ vfs.FS }

func missingRuntimeFuzzPath(name string) bool {
	return strings.Contains(name, "/node_modules/vibelang-runtime/") || strings.HasSuffix(name, "/node_modules/vibelang-runtime")
}
func (fs missingRuntimeFuzzFS) FileExists(name tspath.RootedFilePath) bool {
	return !missingRuntimeFuzzPath(name.AsString()) && fs.FS.FileExists(name)
}
func (fs missingRuntimeFuzzFS) ReadFile(name tspath.RootedFilePath) (string, bool) {
	if missingRuntimeFuzzPath(name.AsString()) {
		return "", false
	}
	return fs.FS.ReadFile(name)
}
func (fs missingRuntimeFuzzFS) DirectoryExists(name tspath.RootedDirectoryPath) bool {
	return !missingRuntimeFuzzPath(name.AsString()) && fs.FS.DirectoryExists(name)
}
