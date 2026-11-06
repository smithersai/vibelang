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

const inferredMemberDocsQuote = "No other JSDoc difference is allowed"

func TestMigrationInferredMemberDocsQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", inferredMemberDocsQuote)
}

func checkInferredMemberDocs(t *testing.T, target, key string, mode uint8, keys []string) {
	t.Helper()
	TestMigrationInferredMemberDocsQuoted(t)
	if !slices.Contains(keys, key) {
		if key == "" {
			key = keys[0]
		} else {
			key = keys[int(key[0])%len(keys)]
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	script := filepath.Join(repoTestdata(), "oracles", "migration_inferred_member_docs.mjs")
	cmd := exec.CommandContext(ctx, "node", script, key, strconv.Itoa(int(mode&7)))
	cmd.Dir = Root()
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("member documentation oracle: %v; context=%v\n%s", err, ctx.Err(), output)
	}
	var result struct{ OK bool }
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("invalid member documentation result: %v\n%s", err, output)
	}
	gapKey := "docs:" + key
	if !result.OK {
		Gap(t, target, gapKey, "Chapter 1: %q; public member documentation must survive a layout or the declaration gate must reject it\n%s", inferredMemberDocsQuote, output)
	}
	ExpectPending(t, target, gapKey)
	ExpectPending(t, target, specCorpusKey(t))
}

// Each short target keeps one expensive declaration comparison. Mutations
// still cover inline and multiline comments, CRLF and documentation text.
func FuzzMigrationInferredMemberDocs(f *testing.F) {
	startShortBudget(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		checkInferredMemberDocs(t, "FuzzMigrationInferredMemberDocs", key, mode, []string{"inferred-move"})
	})
}

func FuzzMigrationInlineMemberDocs(f *testing.F) {
	startShortBudget(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		checkInferredMemberDocs(t, "FuzzMigrationInlineMemberDocs", key, mode, []string{"inferred-move"})
	})
}

func FuzzMigrationTypedMemberDocs(f *testing.F) {
	startShortBudget(f)
	f.Add("typed-move", uint8(1))
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		checkInferredMemberDocs(t, "FuzzMigrationTypedMemberDocs", key, mode, []string{"typed-move"})
	})
}

func FuzzMigrationReexportMemberDocs(f *testing.F) {
	startShortBudget(f)
	f.Add("reexport-all", uint8(1))
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		checkInferredMemberDocs(t, "FuzzMigrationReexportMemberDocs", key, mode, []string{"reexport-all"})
	})
}

func FuzzMigrationChangedMemberDocs(f *testing.F) {
	startShortBudget(f)
	f.Add("mutate-doc", uint8(1))
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		checkInferredMemberDocs(t, "FuzzMigrationChangedMemberDocs", key, mode, []string{"mutate-doc"})
	})
}

func FuzzMigrationUndocumentedMembers(f *testing.F) {
	startShortBudget(f)
	f.Add("no-doc", uint8(1))
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		checkInferredMemberDocs(t, "FuzzMigrationUndocumentedMembers", key, mode, []string{"no-doc"})
	})
}
