package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

const effectPinQuote = "any version outside the stable `^4.1.0` range (`>=4.1.0 <5.0.0`), including `4.0.x`, `5.x`, and prereleases such as `4.1.6-next.1`, is `EK3201` in the CLI and editor"

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

func effectPinCase(key string) (version string, want int) {
	switch key {
	case "min-range":
		return "4.1.0", 0
	case "previous-patch", "pinned":
		return "4.1.1", 0
	case "patch":
		return "4.1.4", 0
	case "baseline":
		return "4.1.6", 0
	case "minor":
		return "4.2.0", 0
	case "major":
		return "5.0.0", 1
	case "prerelease":
		return "4.1.6-next.1", 1
	case "nested":
		return "4.1.6", 1
	default:
		return "4.0.3", 1
	}
}

func FuzzEffectPin(f *testing.F) {
	startShortBudget(f)
	effectPinQuoted(f)
	for _, key := range []string{"older", "min-range", "previous-patch", "patch", "baseline", "minor", "major", "prerelease", "nested"} {
		f.Add([]byte(key))
		f.Add([]byte(key + "\x00\x03"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		version, want := effectPinCase(key)
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
				wantVer := version
				if key == "nested" {
					wantVer = "4.0.3"
				}
				if !strings.Contains(d.String(), wantVer) || !strings.Contains(d.String(), "^4.1.0") {
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
