package vibelangfuzz

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const lintOptionAdmissionQuote = "`vibelang lint` accepts the compiler’s options, including `-p`/`--project` and file arguments, with no lint-specific options"

func TestLintOptionAdmissionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), lintOptionAdmissionQuote) {
		t.Fatalf("VIP-38 lint option contract changed: %q", lintOptionAdmissionQuote)
	}
}

// VIP-38: custom config aliases must not bypass compiler option admission.
// Keyed inputs vary split/inline/missing values, configuration discovery,
// existing/missing config files and explicit requests for the old adapter.
func FuzzLintOptionAdmission(f *testing.F) {
	startShortBudget(f)
	keys := []string{"split", "inline", "missing"}
	for _, key := range keys {
		for _, variant := range []byte{0, 1, 2, 7, 15} {
			f.Add([]byte(key + "\x00" + string([]byte{variant})))
		}
	}
	if !strings.Contains(SpecText("007-tooling.md"), lintOptionAdmissionQuote) {
		f.Fatal("VIP-38 lint option contract changed")
	}
	binary := cliBuild(f, f.TempDir())
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key, variant := parts[0], byte(0)
		if key != "split" && key != "inline" && key != "missing" {
			if len(data) != 0 {
				variant = data[0]
			}
			key = keys[int(variant)%len(keys)]
		}
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		dir := t.TempDir()
		write := func(name, text string) {
			if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0644); err != nil {
				t.Fatal(err)
			}
		}
		write("main.vibe", "export const value = 1\n")
		write("tsconfig.json", `{"compilerOptions":{"types":[],"noEmit":true},"files":["main.vibe"],"vibe":{"effectGlobals":false,"effectModules":false}}`)
		name := fmt.Sprintf("custom-%d.json", variant)
		if variant&4 != 0 {
			write(name, "not a config")
		}
		switch variant % 3 {
		case 1:
			write(".oxlintrc.json", "not a config")
		case 2:
			write("oxlint.config.ts", "not a config")
		}
		args := []string{"lint"}
		if variant&8 != 0 {
			args = append(args, "-c", "missing-oxlint.json")
		}
		switch key {
		case "split":
			args = append(args, "--config", name)
		case "inline":
			args = append(args, "--config="+name)
		case "missing":
			args = append(args, "--config")
		}
		before := lintNoEmitSnapshot(t, dir)
		cmd := exec.CommandContext(t.Context(), binary, args...)
		cmd.Dir = dir
		output, err := cmd.CombinedOutput()
		if err == nil || !strings.Contains(string(output), "error TS5023: Unknown compiler option") || !strings.Contains(string(output), "--config") {
			Gap(t, "FuzzLintOptionAdmission", key, "VIP-38: %s; args=%v status=%v output=%s", lintOptionAdmissionQuote, args, err, output)
		}
		if strings.Contains(string(output), "vibelang lint:") {
			Gap(t, "FuzzLintOptionAdmission", key, "unsupported option reached Oxlint config loading: %s", output)
		}
		after := lintNoEmitSnapshot(t, dir)
		if !reflect.DeepEqual(before, after) {
			t.Fatal("rejected option changed project files")
		}
		ExpectPending(t, "FuzzLintOptionAdmission", key)
	})
}
