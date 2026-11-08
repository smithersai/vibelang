package vibelangfuzz

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// TypeScript's initializer reports TS5054 but exits zero when a configuration
// already exists. It must leave that configuration and all sources intact.
func TestCommandLineInitRefusal(t *testing.T) {
	if got := cliDecode([]byte("key:init-existing-config")); !slices.Equal(got, []string{"--init"}) {
		t.Fatalf("keyed initializer witness changed meaning: %v", got)
	}
	w := NewWorkspace(t)
	binary := cliBuild(t, w.Dir)
	project := Single("export const value = 1\n")
	r, err := w.Compile(t.Context(), project)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	config := filepath.Join(r.Dir, "tsconfig.json")
	before, err := os.ReadFile(config)
	if err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"--init"},
		{"--INIT", "--pretty", "false"},
		{"--init", "--unknown-init-option"},
	} {
		t.Run(cliQuote(args), func(t *testing.T) {
			gaps := &Gaps{Target: cliTarget, Input: cliQuote(args)}
			cliCheck(t, gaps, w, binary, r, project, args)
			if len(gaps.found) != 0 {
				t.Fatalf("initializer disagrees with its command-line oracle: %v", gaps.found)
			}
			run := cliExec(binary, r.Dir, args, "", project)
			printed := cliParse(run.Stdout)
			invalid := len(cliOptions(w, r.Dir, args).Errors) != 0
			if invalid {
				if run.Status == 0 || !slices.ContainsFunc(printed, func(d cliDiagnostic) bool { return d.Prefix == "TS" && d.Code == 5023 }) {
					t.Fatalf("an invalid initializer option must fail with TS5023: %+v", run)
				}
			} else if run.Status != 0 || len(printed) != 1 || printed[0].Prefix != "TS" || printed[0].Code != 5054 {
				t.Fatalf("existing-config refusal must match TypeScript's status zero and TS5054: %+v", run)
			}
			after, err := os.ReadFile(config)
			if err != nil || string(after) != string(before) {
				t.Fatalf("existing configuration changed: %v", err)
			}
		})
	}
}
