package vibelang

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const editorFixtureProbe = "VIBELANG_EDITOR_FIXTURE_PACKAGE_PROBE"

// Exercise the real testing.T fatal path in a child test process. A missing
// requested package used to create a dangling link and construct a program,
// so later compiler assertions reported unrelated symptoms.
func TestEditorFixturePackageInputs(t *testing.T) {
	if mode := os.Getenv(editorFixtureProbe); mode != "" {
		probeEditorFixturePackage(t, mode)
		return
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		mode, diagnostic string
	}{
		{"missing", "is unavailable"},
		{"unicode-missing", "is unavailable"},
		{"dangling", "is unavailable"},
		{"file", "is not a directory"},
		{"directory", ""},
		{"directory-link", ""},
		{"omitted", ""},
	} {
		t.Run(test.mode, func(t *testing.T) {
			cmd := exec.CommandContext(t.Context(), executable,
				"-test.run=^TestEditorFixturePackageInputs$", "-test.count=1", "-test.v", "-test.timeout=2m")
			cmd.Env = append(os.Environ(), editorFixtureProbe+"="+test.mode)
			output, err := cmd.CombinedOutput()
			text := string(output)
			if test.diagnostic == "" {
				if err != nil || !strings.Contains(text, "fixture accepted") {
					t.Fatalf("valid fixture failed: %v\n%s", err, text)
				}
				return
			}
			if err == nil || !strings.Contains(text, `editor fixture package "fixture-probe"`) ||
				!strings.Contains(text, test.diagnostic) || !strings.Contains(text, "run sh scripts/setup.sh") ||
				strings.Contains(text, "fixture accepted") {
				t.Fatalf("missing fixture was not diagnosed before constructing a program: %v\n%s", err, text)
			}
		})
	}
}

func probeEditorFixturePackage(t *testing.T, mode string) {
	t.Helper()
	temp := t.TempDir()
	target := filepath.Join(temp, "package")
	write := func(path string) {
		t.Helper()
		if err := os.WriteFile(path, []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	switch mode {
	case "missing":
	case "unicode-missing":
		target = filepath.Join(temp, "café-漢-😀")
	case "dangling":
		if err := os.Symlink(filepath.Join(temp, "absent"), target); err != nil {
			t.Fatal(err)
		}
	case "file":
		write(target)
	case "directory", "directory-link":
		if err := os.Mkdir(target, 0o700); err != nil {
			t.Fatal(err)
		}
		if mode == "directory-link" {
			link := filepath.Join(temp, "link")
			if err := os.Symlink(target, link); err != nil {
				t.Fatal(err)
			}
			target = link
		}
	case "omitted":
	default:
		t.Fatalf("unknown fixture mode %q", mode)
	}
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(root, target)
	if err != nil {
		t.Fatal(err)
	}
	packages := map[string]string{"fixture-probe": relative}
	if mode == "omitted" {
		packages = nil
	}
	// An omitted package is deliberate and supported by the negative
	// prelude tests; an explicitly requested missing target is not.
	editorProgramWith(t, "export const main = 1\n", packages)
	t.Log("fixture accepted")
}
