package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
)

const nativeCompanionTarget = "FuzzNativeModuleCompanions"
const nativeCompanionOutputQuote = "Bundler plugins use the same names"
const nativeCompanionStemQuote = "JavaScript, declarations, maps and loader requests share that stem"

func TestNativeModuleCompanionsQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", nativeCompanionOutputQuote)
	chapterSays(t, "001-functions.md", nativeCompanionStemQuote)
}

func FuzzNativeModuleCompanions(f *testing.F) {
	startShortBudget(f)
	keys := []string{"vibe-js", "vibex-js", "vibex-jsx", "missing-owner", "physical-output", "foreign-source"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 7} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestNativeModuleCompanionsQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", "--no-warnings", "--experimental-vm-modules", filepath.Join(repoTestdata(), "oracles", "native_module_companions.mjs"), key, strconv.Itoa(int(mode&31)))
		cmd.Dir = Root()
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("module companion hooks: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid module companion receipt: %v\n%s", err, output)
		}
		gapKey := "companion:" + key
		if !result.OK {
			Gap(t, nativeCompanionTarget, gapKey, "Chapter 7: %q; Chapter 1: %q; compiled module outputs must keep their source owner through bundler resolution and load selection\n%s", nativeCompanionOutputQuote, nativeCompanionStemQuote, output)
		}
		ExpectPending(t, nativeCompanionTarget, gapKey)
		ExpectPending(t, nativeCompanionTarget, specCorpusKey(t))
	})
}
