package vibelangfuzz

import (
	"strings"
	"testing"
)

// fixFixedPointQuote is the chapter 7 sentence FuzzFix's second-run oracle
// checks (loop round 1, OPUS-7; orchestrator ruling 2026-10-31 03:00 UTC).
const fixFixedPointQuote = "One `vibelang --fix` run applies fixes until none applies; running it again changes nothing."

// TestFixFixedPointQuoted fails when chapter 7 stops saying what FuzzFix's
// "fix:idempotence" oracle enforces, so the oracle and the spec move together.
func TestFixFixedPointQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), fixFixedPointQuote) {
		t.Fatalf("chapter 7 no longer says %q, which FuzzFix enforces", fixFixedPointQuote)
	}
}
