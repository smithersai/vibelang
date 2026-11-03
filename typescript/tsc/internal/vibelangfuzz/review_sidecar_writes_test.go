package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const reviewSidecarWritesTarget = "FuzzReviewSidecarWrites"

var reviewSidecarWriteQuotes = []string{
	"Listing both the source and its sidecar explicitly in `files` keeps the sidecar as an input: emit reports `TS5055`, exits `1`, and leaves its bytes untouched.",
	"an explicit `files` input keeps native overwrite protection (`TS5055`)",
	"A compatibility sidecar is an emit output",
	"The required sidecar write is independent of `noEmit` and `declaration: false`",
}

func requireReviewSidecarWriteQuotes(t testing.TB) {
	t.Helper()
	chapter := SpecText("007-tooling.md")
	for _, quote := range reviewSidecarWriteQuotes {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Chapter 7 no longer says %q", quote)
		}
	}
}

func TestReviewSidecarWritesQuoted(t *testing.T) { requireReviewSidecarWriteQuotes(t) }

// R9 OPUS-1/ASTRA-1: the selection rule and the write trigger are separate.
// Run real processes because compatibility writes happen after library emit.
// Stock TypeScript is the selection/overwrite control; Chapter 7 explicitly
// makes VibeLang's required compatibility output independent of noEmit and
// declaration:false, so its no-write result is deliberately not copied.
// Chapter 007 / explicit sidecar overwrite and required output under noEmit or declaration false: docs/design/src/007-tooling.md#814102f8570dcd4e
// Chapter 007 / explicit sidecar overwrite and required output under noEmit or declaration false: docs/design/src/007-tooling.md#520298eaa196e373
func FuzzReviewSidecarWrites(f *testing.F) {
	startShortBudget(f)
	requireReviewSidecarWriteQuotes(f)
	binary := cliBuild(f, f.TempDir())
	stock := StockTypeScript(f)
	keys := []string{"files:emit", "files:noEmit", "files:noDeclaration", "include:emit", "include:noEmit", "include:noDeclaration"}
	for _, key := range keys {
		f.Add([]byte(key + "|"))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		t.Parallel()
		key, tail, keyed := strings.Cut(string(data), "|")
		if !keyed {
			key = keys[int(reviewSidecarByte(data, 0))%len(keys)]
			tail = string(data)
		}
		selection, mode, ok := strings.Cut(key, ":")
		if !ok || (selection != "files" && selection != "include") || (mode != "emit" && mode != "noEmit" && mode != "noDeclaration") {
			return
		}
		variant := []byte(tail)
		name := []string{"main", "file space", "nested/main"}[reviewSidecarByte(variant, 0)%3]
		value := int(reviewSidecarByte(variant, 1))
		source := fmt.Sprintf("export const value = %d\n", value)
		before := "// explicit-input sentinel\nexport declare const value: string;\n"
		type outcome struct {
			status int
			text   string
			after  string
		}
		run := func(executable, extension string) outcome {
			dir := t.TempDir()
			declaration := name + ".d.ts"
			if extension == ".vibe" {
				declaration = name + ".d.vibe.ts"
			}
			config := map[string]any{
				"compilerOptions": map[string]any{
					"target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
					"strict": true, "skipLibCheck": true, "types": []string{},
					"declaration": mode != "noDeclaration", "noEmit": mode == "noEmit",
				},
				selection: []string{name + extension, declaration},
			}
			if extension == ".vibe" {
				config["vibe"] = map[string]bool{"effectGlobals": false, "effectModules": false}
			}
			configBytes, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			for file, contents := range map[string]string{
				name + extension: source, declaration: before,
				"package.json": `{"type":"module"}`, "tsconfig.json": string(configBytes),
			} {
				target := filepath.Join(dir, filepath.FromSlash(file))
				if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(target, []byte(contents), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			result := cliExec(executable, dir, []string{"-p", "tsconfig.json", "--pretty", "false"}, "", Project{})
			if result.Hung != "" {
				t.Fatalf("%s %s: %s", key, extension, result.Hung)
			}
			after, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(declaration)))
			if err != nil {
				t.Fatal(err)
			}
			retained, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name+extension)))
			if err != nil || string(retained) != source {
				t.Fatalf("source changed: %v\n%s", err, retained)
			}
			return outcome{result.Status, result.Stdout + result.Stderr, string(after)}
		}
		native := run(stock, ".ts")
		wantNativeError := selection == "files" && mode == "emit"
		if (native.status == 1 && strings.Contains(native.text, "TS5055")) != wantNativeError ||
			(!wantNativeError && native.status != 0) {
			t.Fatalf("stock TypeScript selection control %s: status %d\n%s", key, native.status, native.text)
		}
		nativeWrites := selection == "include" && mode == "emit"
		if (native.after != before) != nativeWrites {
			t.Fatalf("stock TypeScript write control %s: %q", key, native.after)
		}
		vibe := run(binary, ".vibe")
		gaps := &Gaps{Target: reviewSidecarWritesTarget, Input: string(data)}
		if selection == "files" {
			if vibe.status != 1 || !strings.Contains(vibe.text, "TS5055") || vibe.after != before {
				gaps.Add(key, "Chapter 7: %s; %s. Expected exit1/TS5055/unchanged sidecar; got status%d, unchanged%t:\n%s", reviewSidecarWriteQuotes[1], reviewSidecarWriteQuotes[3], vibe.status, vibe.after == before, vibe.text)
			}
		} else if vibe.status != 0 || !strings.Contains(vibe.after, fmt.Sprintf("value = %d;", value)) || strings.Contains(vibe.after, "explicit-input sentinel") {
			t.Fatalf("discovered sidecar must regenerate in %s: status%d %q\n%s", key, vibe.status, vibe.after, vibe.text)
		}
		corpus := ""
		candidate := strings.TrimPrefix(t.Name(), reviewSidecarWritesTarget+"/")
		if _, err := os.Stat(filepath.Join(repoTestdata(), "fuzz", reviewSidecarWritesTarget, candidate)); err == nil {
			corpus = "corpus:" + candidate
		}
		gaps.FinishInput(t, corpus)
	})
}

func reviewSidecarByte(data []byte, index int) byte {
	if index < len(data) {
		return data[index]
	}
	return 0
}
