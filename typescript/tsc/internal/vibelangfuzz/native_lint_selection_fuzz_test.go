package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const nativeLintSelectionQuote = "Compiler builds, the language server and \x60vibelang lint\x60 use the same activation and selection:"

func TestNativeLintSelectionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), nativeLintSelectionQuote) {
		t.Fatal(nativeLintSelectionQuote)
	}
}

var nativeLintSelectionKeys = []string{"none", "oxlint-json", "oxlint-invalid", "oxlint-typescript"}

func FuzzNativeLintSelection(f *testing.F) {
	startShortBudget(f)
	f.Add("oxlint-json", false, false)
	f.Add("oxlint-invalid", false, true)
	f.Add("oxlint-typescript", true, false)
	f.Add("none", false, true)
	binary := cliBuild(f, f.TempDir())
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, valid, asVibe bool) {
		TestNativeLintSelectionQuoted(t)
		if !slices.Contains(nativeLintSelectionKeys, key) {
			n := byte(0)
			if len(key) > 0 {
				n = key[0]
			}
			key = nativeLintSelectionKeys[int(n)%len(nativeLintSelectionKeys)]
		}
		name := "main.ts"
		if asVibe {
			name = "main.vibe"
		}
		value := "1"
		if valid {
			value = `"ok"`
		}
		files := map[string]string{name: "export const value: string = " + value + ";\n", "package.json": servicesPackage}
		switch key {
		case "oxlint-json":
			files[".oxlintrc.json"] = `{"rules":{}}`
		case "oxlint-invalid":
			files[".oxlintrc.json"] = `this is not JSON`
		case "oxlint-typescript":
			files["oxlint.config.ts"] = `export default { rules: {} };`
		}
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"incremental":true,"tsBuildInfoFile":"build.tsbuildinfo","plugins":[{"name":"@effect/language-service","diagnostics":false}]},"files":[%q]}`, name)
		dir, err := w.writeProject(Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(dir)
		run := func(args ...string) (int, string) {
			ctx, cancel := context.WithTimeout(t.Context(), cliDeadline)
			defer cancel()
			cmd := exec.CommandContext(ctx, binary, args...)
			cmd.Dir = dir
			cliIsolate(cmd)
			out, err := cmd.CombinedOutput()
			if ctx.Err() != nil {
				t.Fatalf("native lint probe deadline: %v", ctx.Err())
			}
			if err == nil {
				return 0, string(out)
			}
			if exit, ok := err.(*exec.ExitError); ok {
				return exit.ExitCode(), string(out)
			}
			t.Fatalf("native lint process: %v", err)
			return 0, ""
		}
		// Probe lint before the compiler control: ordinary --noEmit may still
		// refresh compatibility sidecars, whereas lint must create no files.
		lintStatus, lintOutput := run("lint", "-p", dir, "--pretty", "false", "--strict")
		for _, output := range []string{"main.js", "main.d.ts", "main.d.vibe.ts", "build.tsbuildinfo"} {
			if _, err := os.Stat(filepath.Join(dir, output)); !os.IsNotExist(err) {
				t.Fatalf("analysis emitted %s: %v", output, err)
			}
		}
		compilerStatus, compilerOutput := run("-p", dir, "--noEmit", "--pretty", "false", "--strict")
		compilerDiags, lintDiags := cliParse(compilerOutput), cliParse(lintOutput)
		if !slices.Equal(compilerDiags, lintDiags) || (compilerStatus == 0) != (lintStatus == 0) {
			t.Fatalf("VIP38 native selection key=%s valid=%t file=%s: compiler status=%d diagnostics=%v; lint status=%d diagnostics=%v\ncompiler:\n%s\nlint:\n%s", key, valid, name, compilerStatus, compilerDiags, lintStatus, lintDiags, compilerOutput, lintOutput)
		}
		if valid && (compilerStatus != 0 || len(compilerDiags) != 0) {
			t.Fatalf("valid native control failed: %s", compilerOutput)
		}
		if !valid && (compilerStatus == 0 || !slices.ContainsFunc(compilerDiags, func(d cliDiagnostic) bool { return d.Prefix == "TS" && d.Code == 2322 })) {
			t.Fatalf("invalid native control must report TS2322: %s", compilerOutput)
		}

	})
}
