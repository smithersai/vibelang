package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var nativeEffectValueKeys = []string{"interrupt", "yieldNow", "interrupt:import", "yieldNow:import", "interrupt:shadow", "yieldNow:shadow", "interrupt:disabled", "yieldNow:disabled"}

func nativeEffectValuesQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{
		"The non-function value exports are globals too",
		"A local declaration or import shadows one, as with any global",
	} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
}
func TestNativeEffectValuesQuoted(t *testing.T) { nativeEffectValuesQuoted(t) }
func FuzzNativeEffectValues(f *testing.F) {
	startShortBudget(f)
	nativeEffectValuesQuoted(f)
	for _, key := range nativeEffectValueKeys {
		f.Add([]byte(key))
	}
	present, absent := NewWorkspace(f), NewWorkspace(f)
	if err := os.Rename(filepath.Join(absent.Dir, "node_modules", "vibelang-runtime"), filepath.Join(absent.Dir, "disabled-runtime")); err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		choice := 0
		if len(data) > 0 {
			choice = int(data[0]) % len(nativeEffectValueKeys)
		}
		for i, key := range nativeEffectValueKeys {
			if string(data) == key {
				choice = i
				break
			}
		}
		key := nativeEffectValueKeys[choice]
		name, mode, _ := strings.Cut(key, ":")
		parens := 0
		if len(data) > 1 {
			parens = int(data[len(data)-1]) % 4
		}
		value := strings.Repeat("(", parens) + name + strings.Repeat(")", parens)
		source := fmt.Sprintf("import { Effect as Native } from 'effect'; export const value: typeof Native.%s = %s;", name, value)
		config := DefaultConfig
		var want int32
		switch mode {
		case "import":
			source = fmt.Sprintf("import { %s } from 'effect/Effect'; ", name) + source
		case "shadow":
			source = fmt.Sprintf("const %s = 42 as const; export const value: 42 = %s;", name, value)
		case "disabled":
			config = strings.TrimSuffix(config, "\n}") + ",\n\"vibe\":{\"effectGlobals\":false}\n}"
			want = 2304
		}
		for _, control := range []struct {
			name string
			w    *Workspace
		}{{"present", present}, {"absent", absent}} {
			r, err := control.w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": `{"name":"native-effect-values","type":"module"}`}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			count := 0
			for _, d := range r.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if want == 0 || IsEK(d) || d.Code() != want {
					Gap(t, "FuzzNativeEffectValues", key+":"+control.name, "chapter 5 native Effect values and shadowing: got %s\n%s", d.String(), source)
					return
				}
				count++
			}
			if want != 0 && count != 1 {
				Gap(t, "FuzzNativeEffectValues", key+":"+control.name, "disabled globals need one TS2304, got %d\n%s", count, source)
				return
			}
			if want == 0 {
				found := false
				for file, text := range r.Outputs {
					if !strings.HasSuffix(file, "main.js") {
						continue
					}
					found = true
					if strings.Contains(text, "vibelang-runtime") {
						Gap(t, "FuzzNativeEffectValues", key+":"+control.name, "native values acquired a runtime wrapper: %s", text)
						return
					}
					if mode != "shadow" && !strings.Contains(text, "effect/Effect") {
						Gap(t, "FuzzNativeEffectValues", key+":"+control.name, "missing pinned Effect import: %s", text)
						return
					}
				}
				if !found {
					t.Fatal("missing JavaScript output")
				}
			}
			ExpectPending(t, "FuzzNativeEffectValues", key+":"+control.name)
		}
		ExpectPending(t, "FuzzNativeEffectValues", specCorpusKey(t))
	})
}
