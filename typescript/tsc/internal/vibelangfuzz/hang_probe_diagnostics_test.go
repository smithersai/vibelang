package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestHangProbeDiagnosticSummary(t *testing.T) {
	t.Parallel()
	const progress = "\tcompile_fuzz_test.go:303: probe-stage start: compile\n" +
		"\tcompile_fuzz_test.go:306: probe-stage done: compile\n" +
		"\tcompile_fuzz_test.go:303: probe-stage start: recompile\n"
	const panicText = "panic: hang: recompile took longer than 15s\n"
	for _, test := range []struct {
		name    string
		timeout bool
		output  string
		cause   string
	}{
		{"completed", false, progress, "cause=exited"},
		{"outer deadline after progress", true, progress, "cause=outer-deadline"},
		{"stage watchdog", false, progress + panicText, "cause=stage-watchdog"},
		{"watchdog evidence wins a deadline race", true, progress + panicText, "cause=stage-watchdog"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := hangProbeSummary(test.timeout, test.output+"unrelated project text must stay out\n")
			for _, want := range []string{test.cause, "start:compile", "done:compile", "start:recompile"} {
				if !strings.Contains(got, want) {
					t.Fatalf("summary %q lacks %q", got, want)
				}
			}
			if strings.Contains(got, "unrelated project") {
				t.Fatalf("summary copied project output: %q", got)
			}
		})
	}
	t.Run("bounded metadata only", func(t *testing.T) {
		got := hangProbeSummary(true, strings.Repeat(progress, 20)+"compile_fuzz_test.go:303: probe-stage start: arbitrary project text\n")
		if strings.Count(got, "start:")+strings.Count(got, "done:") > 8 || len(got) > 512 {
			t.Fatalf("unbounded probe summary: %q", got)
		}
		if strings.Contains(got, "arbitrary project") {
			t.Fatalf("summary copied a non-harness stage: %q", got)
		}
	})
}
