package vibelangfuzz

import (
	"testing"
	"time"
)

// TestHangLimit checks that a fuzzing worker's limit stays under Go's 60 s
// worker deadline, which would end the worker with no stack and no crasher,
// and that VIBELANG_FUZZ_HANG sets it everywhere else.
func TestHangLimit(t *testing.T) {
	worker := []string{"-test.fuzzworker", "-test.run=^$", "-test.fuzz=^FuzzCompile$"}
	for _, c := range []struct {
		env  string
		args []string
		want time.Duration
	}{
		{"", nil, 10 * time.Second},
		{"120s", nil, 120 * time.Second},
		{"120s", []string{"-test.run=^FuzzCompile$"}, 120 * time.Second},
		{"120s", worker, workerHangLimit},
		{"", worker, 10 * time.Second},
		{"20s", worker, 20 * time.Second},
		{"not a duration", nil, 10 * time.Second},
	} {
		if got := hangLimit(c.env, c.args); got != c.want {
			t.Errorf("hangLimit(%q, %q) = %v, want %v", c.env, c.args, got, c.want)
		}
	}
	if workerHangLimit >= 60*time.Second {
		t.Errorf("workerHangLimit %v is not under Go's 60 s worker deadline", workerHangLimit)
	}
}
