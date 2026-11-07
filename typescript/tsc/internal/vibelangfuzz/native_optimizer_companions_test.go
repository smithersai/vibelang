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

const nativeOptimizerTarget = "FuzzNativeOptimizerCompanions"
const nativeOptimizerOutputQuote = "Bundler plugins use the same names"
const nativeOptimizerStemQuote = "JavaScript, declarations, maps and loader requests share that stem"

func TestNativeOptimizerCompanionsQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", nativeOptimizerOutputQuote)
	chapterSays(t, "001-functions.md", nativeOptimizerStemQuote)
}

func FuzzNativeOptimizerCompanions(f *testing.F) {
	startShortBudget(f)
	keys := []string{"jsx-companion", "js-companion", "source-jsx", "missing-owner", "physical-output", "foreign-source", "resource-query"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 31} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestNativeOptimizerCompanionsQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "native_optimizer_companions.mjs"), key, strconv.Itoa(int(mode&31)))
		cmd.Dir = Root()
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("optimizer companion hooks: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid optimizer companion receipt: %v\n%s", err, output)
		}
		gapKey := "scanner:" + key
		if !result.OK {
			Gap(t, nativeOptimizerTarget, gapKey, "Chapter 7: %q; Chapter 1: %q; dependency scanner filters and dispatch must retain generated companion ownership\n%s", nativeOptimizerOutputQuote, nativeOptimizerStemQuote, output)
		}
		ExpectPending(t, nativeOptimizerTarget, gapKey)
		ExpectPending(t, nativeOptimizerTarget, specCorpusKey(t))
	})
}
