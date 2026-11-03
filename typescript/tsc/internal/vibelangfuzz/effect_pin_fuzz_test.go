package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

const effectPinQuote = "any version other than `4.1.1`, including `4.1.0`, is `EK3201` in the CLI and editor"

func TestEffectPinQuoted(t *testing.T) { effectPinQuoted(t) }
func effectPinQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), effectPinQuote) {
		t.Fatalf("chapter 7 no longer says %q", effectPinQuote)
	}
}
func FuzzEffectPin(f *testing.F) {
	startShortBudget(f)
	effectPinQuoted(f)
	for _, key := range []string{"older", "previous-patch", "patch", "prerelease", "pinned", "nested"} {
		f.Add([]byte(key))
		f.Add([]byte(key + "\x00\x03"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		version, want := "4.0.3", 1
		switch key {
		case "previous-patch":
			version = "4.1.0"
		case "patch":
			version = "4.1.2"
		case "prerelease":
			version = "4.1.1-next.1"
		case "pinned":
			version, want = "4.1.1", 0
		case "nested":
			version = "4.1.1"
		}
		pkg, _ := json.Marshal(map[string]string{"name": "effect", "version": version, "types": "index.d.ts"})
		source := "export const value: number = 1\n"
		if len(parts) == 2 && len(parts[1]) > 0 && parts[1][0]&1 != 0 {
			source = "/* retained */\r\n" + source
		}

		files := map[string]string{"main.vibe": source, "package.json": servicesPackage, "node_modules/effect/package.json": string(pkg), "node_modules/effect/index.d.ts": "export {}"}
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`
		if key == "nested" {
			files["nested/main.vibe"] = "export const other: number = 2"
			nested, _ := json.Marshal(map[string]string{"name": "effect", "version": "4.0.3", "types": "index.d.ts"})
			files["nested/node_modules/effect/package.json"] = string(nested)
			files["nested/node_modules/effect/index.d.ts"] = "export {}"
			names := `["main.vibe","nested/main.vibe"]`
			if len(parts) == 2 && len(parts[1]) > 0 && parts[1][0]&2 != 0 {
				names = `["nested/main.vibe","main.vibe"]`
			}
			config = strings.Replace(config, `["main.vibe"]`, names, 1)
		}
		result, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == 3201 {
				count++
				if !strings.Contains(d.String(), func() string {
					if key == "nested" {
						return "4.0.3"
					}
					return version
				}()) || !strings.Contains(d.String(), "4.1.1") {
					t.Fatal(d.String())
				}
			} else {
				t.Fatalf("unexpected diagnostic: %s", d.String())
			}
		}
		if count != want {
			Gap(t, "FuzzEffectPin", key, "%s; %s", effectPinQuote, fmt.Sprintf("want %d, got %d", want, count))
			return
		}
		ExpectPending(t, "FuzzEffectPin", key)
		ExpectPending(t, "FuzzEffectPin", specCorpusKey(t))
	})
}
