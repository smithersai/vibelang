package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const platformSpellingOriginTarget = "FuzzPlatformSpellingOrigin"
const platformSpellingOriginQuote = "and a project's own `declare var fetch` is not a host declaration."
const platformSpellingNativeQuote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."

func TestPlatformSpellingOriginQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", platformSpellingOriginQuote)
	chapterSays(t, "007-tooling.md", platformSpellingNativeQuote)
}

// A project-owned binding must give the same native spelling suggestion in
// VibeLang and its ordinary TypeScript twin. Only the genuine host-global
// control deliberately differs, because that value is banned in VibeLang.
func FuzzPlatformSpellingOrigin(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "005-services.md", platformSpellingOriginQuote)
	chapterSays(f, "007-tooling.md", platformSpellingNativeQuote)
	names := []struct{ name, typo string }{{"process", "proces"}, {"fetch", "fetcn"}, {"Buffer", "Bffer"}, {"document", "documen"}}
	origins := []string{"project", "host", "local", "typescript"}
	keys := []string{}
	for _, name := range names {
		for _, origin := range origins {
			key := name.name + "-" + origin
			keys = append(keys, key)
			for mode := byte(0); mode < 4; mode++ {
				f.Add([]byte(key + "\x00" + string([]byte{mode})))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		index := slices.Index(keys, parts[0])
		if index < 0 {
			index = len(data) % len(keys)
		}
		key := keys[index]
		name := names[index/len(origins)]
		origin := origins[index%len(origins)]
		mode := byte(0)
		if len(parts) > 1 && len(parts[1]) > 0 {
			mode = parts[1][0]
		}
		file := "main.vibe"
		if mode&1 != 0 {
			file = "main.vibex"
		}
		if origin == "typescript" {
			file = "main.ts"
		}
		source := "export const value = " + name.typo
		declFile := "globals.d.ts"
		declaration := fmt.Sprintf("declare var %s: { readonly value: number }", name.name)
		files := map[string]string{"package.json": `{"type":"module"}`}
		if origin == "host" {
			declFile = "node_modules/@types/node/index.d.ts"
			files["node_modules/@types/node/package.json"] = `{"name":"@types/node","types":"index.d.ts"}`
		}
		if origin == "local" {
			source = fmt.Sprintf("const %s = {value:1}; %s", name.name, source)
			declaration = "export {}"
		}
		if mode&2 != 0 {
			source = "// retained é\r\n" + strings.ReplaceAll(source, " = ", " /* binding */ = ")
		}
		files[file] = source
		files["control.ts"] = source
		files[declFile] = declaration
		config, err := json.Marshal(map[string]any{"compilerOptions": map[string]any{"strict": true, "target": "ESNext", "lib": []string{"ESNext"}, "module": "NodeNext", "types": []string{}, "noEmit": true, "skipLibCheck": true, "jsx": "preserve"}, "files": []string{file, "control.ts", declFile}})
		if err != nil {
			t.Fatal(err)
		}
		result, err := w.Compile(t.Context(), Project{Config: string(config), Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		counts := map[string]int{}
		for _, d := range result.Diagnostics {
			if d.File() == nil {
				t.Fatalf("invalid fixture %s: %s", key, d.String())
			}
			base := filepath.Base(d.File().FileName().AsString())
			want := int32(2552)
			if base == file && origin == "host" {
				want = 2304
			}
			if base != file && base != "control.ts" {
				t.Fatalf("invalid fixture %s: %s", key, d.String())
			}
			counts[base]++
			if d.Source() != "" || d.Code() != want {
				Gap(t, platformSpellingOriginTarget, key, "%s; %s wants native TS%d, got %s", platformSpellingOriginQuote, base, want, d.String())
				return
			}
		}
		if counts[file] != 1 || counts["control.ts"] != 1 {
			Gap(t, platformSpellingOriginTarget, key, "want one diagnostic per twin, got %v", counts)
			return
		}
		ExpectPending(t, platformSpellingOriginTarget, key)
		ExpectPending(t, platformSpellingOriginTarget, specCorpusKey(t))
	})
}
