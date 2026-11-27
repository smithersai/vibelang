package vibelangfuzz

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadFactsAndErrorPathsWithoutPanic(t *testing.T) {
	t.Parallel()
	facts, err := LoadFacts()
	if err != nil {
		t.Fatalf("LoadFacts() failed: %v", err)
	}
	if len(facts.Rows) == 0 {
		t.Fatal("LoadFacts() returned empty Rows")
	}

	if _, err := ReadSpecText("does-not-exist-chapter.md"); err == nil {
		t.Fatal("ReadSpecText on missing file should return error")
	}
	if _, err := currentSpecTextChecked("../vips/0001-effect-and-async-functions.md"); err == nil {
		t.Fatal("currentSpecText on retired/outside path should return error")
	}
	if err := requireQuote("hello", "missing"); err == nil {
		t.Fatal("requireQuote on missing quote should return error")
	}
	if _, err := reusedCodes("`EK2005` to `EK2001`"); err == nil {
		t.Fatal("reusedCodes on reversed range should return error")
	}
	if _, err := loadCaseSeedsChecked(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("loadCaseSeedsChecked on missing dir should return error")
	}
	if _, err := readParityOutputsChecked(filepath.Join(t.TempDir(), "missing"), nil); err == nil {
		t.Fatal("readParityOutputsChecked on missing dir should return error")
	}
	if got := toolsScan("const x = 1"); len(got) == 0 {
		t.Fatal("toolsScan returned no tokens for valid input")
	}
}

func TestWithinHangProbeSummaryPattern(t *testing.T) {
	t.Parallel()
	msg := "panic: hang: compile took longer than 10s\ngoroutine 1 [running]:\n"
	got := hangProbeSummary(false, msg)
	if !strings.Contains(got, "cause=stage-watchdog") {
		t.Fatalf("expected stage-watchdog summary, got %q", got)
	}
}
