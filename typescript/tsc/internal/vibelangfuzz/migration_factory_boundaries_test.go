package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const migrationHomeTarget = "FuzzMigrationThrowCallHome"
const migrationContainerTarget = "FuzzMigrationEffectContainers"
const migrationHomeQuote = "The migration preserves eager factory calls, argument evaluation and closure state shared by repeated runs"
const migrationPlainQuote = "an unmarked callable is plain, and returning an Effect leaves it unrun."
const migrationBodyQuote = "No VibeLang rule runs on it, except the three below."

func TestMigrationFactoryBoundariesQuoted(t *testing.T) {
	r4Quoted(t, "007-tooling.md", migrationHomeQuote)
	r4Quoted(t, "001-functions.md", migrationPlainQuote, migrationBodyQuote)
	r4Quoted(t, "003-failures.md", migrationTrackedThrowQuote)
}

func migrationFactoryModel(t *testing.T, area, key string, mode uint8) (bool, string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	script := filepath.Join(repoTestdata(), "oracles", "migration_factory_boundaries.mjs")
	encodedMode := mode & 1
	if strings.HasPrefix(key, "traced-") {
		encodedMode = mode & 7
	}
	cmd := exec.CommandContext(ctx, "node", script, area, key, strconv.Itoa(int(encodedMode)))
	cmd.Dir = Root()
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("static migration model %s/%s/%d: %v; context=%v\n%s", area, key, encodedMode, err, ctx.Err(), output)
	}
	var record struct {
		OK bool `json:"ok"`
	}
	if err := json.Unmarshal(output, &record); err != nil {
		t.Fatalf("invalid migration oracle result: %v\n%s", err, output)
	}
	return record.OK, strings.TrimSpace(string(output))
}

func FuzzMigrationThrowCallHome(f *testing.F) {
	startShortBudget(f)
	keys := []string{"direct", "block", "literal", "shadow", "deferred", "generator"}
	for _, key := range keys {
		for mode := uint8(0); mode < 2; mode++ {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationFactoryBoundariesQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		gapKey := fmt.Sprintf("home:%s/%d", key, mode&1)
		if ok, details := migrationFactoryModel(t, "home", key, mode); !ok {
			Gap(t, migrationHomeTarget, gapKey, "Chapter 7: %q; Chapter 1: %q; Chapter 3: %q\n%s", migrationHomeQuote, migrationBodyQuote, migrationTrackedThrowQuote, details)
		}
		ExpectPending(t, migrationHomeTarget, gapKey)
		ExpectPending(t, migrationHomeTarget, specCorpusKey(t))
	})
}

func FuzzMigrationEffectContainers(f *testing.F) {
	startShortBudget(f)
	keys := []string{"object", "nested", "array", "identity", "class", "drop-array", "traced-object", "traced-nested", "traced-direct", "traced-drop-direct"}
	for _, key := range keys {
		modes := []uint8{0, 1}
		if strings.HasPrefix(key, "traced-") {
			modes = []uint8{0, 1, 2, 5}
		}
		for _, mode := range modes {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationFactoryBoundariesQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		gapKey := fmt.Sprintf("container:%s/%d", key, mode&1)
		if ok, details := migrationFactoryModel(t, "container", key, mode); !ok {
			Gap(t, migrationContainerTarget, gapKey, "Chapter 1: %q; a returned container is distinct from the programs its methods construct; the direct dropped Effect wrapper remains a negative control\n%s", migrationPlainQuote, details)
		}
		ExpectPending(t, migrationContainerTarget, gapKey)
		ExpectPending(t, migrationContainerTarget, specCorpusKey(t))
	})
}
