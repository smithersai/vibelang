package vibelangfuzz

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestCampaignDurations(t *testing.T) {
	for _, test := range []struct {
		duration, target, grace, limit string
	}{
		{"30s", "FuzzParse", "15m", "930.000000000s"},
		{"5m", "FuzzParse", "15m", "1200.000000000s"},
		{"20m", "FuzzParse", "15m", "2100.000000000s"},
		{"1h", "FuzzParse", "15m", "4500.000000000s"},
		{"1h30m", "FuzzParse", "15m", "6300.000000000s"},
		{"30s", "FuzzParse=1h30m12.5s", "500ms", "5413.000000000s"},
		{"1s", "FuzzParse", "0", "1.000000000s"},
	} {
		t.Run(test.duration+"/"+test.target, func(t *testing.T) {
			dir := t.TempDir()
			// The fake timeout records its deadline without starting a campaign.
			for name, script := range map[string]string{
				"go":      "#!/bin/sh\nexit 0\n",
				"timeout": "#!/bin/sh\nprintf '%s\\n' \"$*\" > \"$CAMPAIGN_OUT/timeout.txt\"\nexit 124\n",
			} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0o700); err != nil {
					t.Fatal(err)
				}
			}
			cmd := exec.Command("sh", "campaign.sh", test.duration, test.target)
			cmd.Env = append(os.Environ(), "PATH="+dir+string(os.PathListSeparator)+os.Getenv("PATH"), "CAMPAIGN_OUT="+dir, "CAMPAIGN_GRACE="+test.grace)
			out, err := cmd.CombinedOutput()
			if err == nil || cmd.ProcessState.ExitCode() != 1 {
				t.Fatalf("campaign did not report a failed target: %v\n%s", err, out)
			}
			args, err := os.ReadFile(filepath.Join(dir, "timeout.txt"))
			if err != nil {
				t.Fatal(err)
			}
			if want := "-s QUIT -k 60 " + test.limit + " go test "; !strings.HasPrefix(string(args), want) {
				t.Fatalf("timeout arguments %q, want prefix %q", args, want)
			}
			if !strings.Contains(string(out), "FuzzParse  ") || !strings.Contains(string(out), "timed out (exit 124;") {
				t.Fatalf("campaign summary omitted timeout:\n%s", out)
			}
		})
	}
	for _, duration := range []string{"", "5", "5minutes", "1h30", "-1s"} {
		t.Run("invalid/"+duration, func(t *testing.T) {
			cmd := exec.Command("sh", "campaign.sh", "1s", "FuzzParse="+duration)
			out, err := cmd.CombinedOutput()
			if err == nil || cmd.ProcessState.ExitCode() != 2 || !strings.Contains(string(out), "cannot parse Go duration") {
				t.Fatalf("invalid duration was not rejected: %v\n%s", err, out)
			}
		})
	}
}

func TestCampaignBudgetReport(t *testing.T) {
	dir := t.TempDir()
	for name, script := range map[string]string{
		"timeout": "#!/bin/sh\nexit 0\n",
		"go":      "#!/bin/sh\ncase \" $* \" in *\" -short \"*) [ -z \"$VIBELANG_FUZZ_SEEDS\" ] || exit 2; echo \"FuzzParse: short seed CPU above 120s budget: 2m10s\";; esac\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	cmd := exec.Command("sh", "campaign.sh", "1s", "FuzzParse")
	cmd.Env = append(os.Environ(), "PATH="+dir+string(os.PathListSeparator)+os.Getenv("PATH"), "CAMPAIGN_OUT="+dir, "VIBELANG_FUZZ_SEEDS=all")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	summary, err := os.ReadFile(filepath.Join(dir, "summary.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(summary), "FuzzParse: short seed CPU above 120s budget: 2m10s") {
		t.Fatalf("nightly omitted budget violation: %s", summary)
	}
}
