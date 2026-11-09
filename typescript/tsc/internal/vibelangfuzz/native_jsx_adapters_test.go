package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
)

const nativeJSXKindQuote = "A \x60.vibex\x60 file is a \x60.vibe\x60 file read with TypeScript's JSX language variant"
const nativeJSXOutputQuote = "A compatibility sidecar is an emit output"
const nativeJSXPreserveQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

func TestNativeJSXAdaptersQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", nativeJSXKindQuote)
	chapterSays(t, "007-tooling.md", nativeJSXOutputQuote)
	chapterSays(t, "007-tooling.md", nativeJSXPreserveQuote)
}

func nativeJSXAdapterModel(t *testing.T, area, key string, mode uint8) (bool, string, string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	script := filepath.Join(repoTestdata(), "oracles", "native_jsx_adapters.mjs")
	cmd := exec.CommandContext(ctx, "node", script, area, key, strconv.Itoa(int(mode&7)))
	cmd.Dir = Root()
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("native adapter oracle %s/%s: %v; context=%v\n%s", area, key, err, ctx.Err(), output)
	}
	var result struct {
		OK        bool
		Extension string
	}
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("invalid native adapter result: %v\n%s", err, output)
	}
	return result.OK, result.Extension, string(output)
}

func FuzzNativeBabelFiles(f *testing.F) {
	startShortBudget(f)
	keys := []string{"interface", "generic-arrow", "enum", "class-field", "jsx"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 1, 2, 7} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestNativeJSXAdaptersQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ok, extension, details := nativeJSXAdapterModel(t, "babel", key, mode)
		gapKey := "dispatch:" + key + "/" + extension
		if !ok {
			Gap(t, "FuzzNativeBabelFiles", gapKey, "VIP-39: %q; the file adapter must pass compiled JavaScript to its parser for each native source kind\n%s", nativeJSXKindQuote, details)
		}
		ExpectPending(t, "FuzzNativeBabelFiles", gapKey)
		ExpectPending(t, "FuzzNativeBabelFiles", specCorpusKey(t))
	})
}

func FuzzNativeRouterDiscovery(f *testing.F) {
	startShortBudget(f)
	dependency := filepath.Join(Root(), "packages/compiler/test/tools/node_modules/@tanstack/router-generator/package.json")
	if _, err := os.Stat(dependency); err != nil {
		message := "install adapter test dependencies: bun install --cwd packages/compiler/test/tools"
		if os.Getenv("VIBELANG_FUZZ_REQUIRE") == "1" {
			f.Fatalf("%s: %v", message, err)
		}
		f.Skip(message)
	}
	keys := []string{"vibex", "vibe", "tsx-control"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 7} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestNativeJSXAdaptersQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ok, extension, details := nativeJSXAdapterModel(t, "router", key, mode)
		gapKey := "planning:" + extension
		if !ok {
			Gap(t, "FuzzNativeRouterDiscovery", gapKey, "VIP-39: %q; Chapter 7: %q; migration must preserve authored route identities or defer the native rename with a located reason\n%s", nativeJSXKindQuote, nativeJSXPreserveQuote, details)
		}
		ExpectPending(t, "FuzzNativeRouterDiscovery", gapKey)
		ExpectPending(t, "FuzzNativeRouterDiscovery", specCorpusKey(t))
	})
}
