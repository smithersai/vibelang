package vibelangfmt_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// TestFormatIsSurrogateWraps formats Kanban's wrapped is call through hosts
// that break the line before or after the relational surrogate, as dprint
// does with operatorPosition nextLine or sameLine. Both sides of is must
// rejoin its line (foldkit-57, ')' expected).
func TestFormatIsSurrogateWraps(t *testing.T) {
	source, err := os.ReadFile("testdata/foldkit-is-line/foldkit-kanban-is-call-wrap.vibe")
	if err != nil {
		t.Fatal(err)
	}
	for name, wrapped := range map[string]string{
		"before":  "\n      >= ",
		"after":   " >=\n      ",
		"both":    "\n      >=\n      ",
		"comment": " >=\n      ",
	} {
		t.Run(name, func(t *testing.T) {
			input := string(source)
			if name == "comment" {
				input = strings.Replace(input, " is ", " /* kept */ is ", 1)
			}
			host := func(text string) (string, error) {
				after := strings.Replace(text, " >= ", wrapped, 1)
				if after == text {
					t.Fatal("the host did not see the is surrogate")
				}
				if err := vibelangfmt.SameProgram(text, after); err != nil {
					t.Fatalf("invalid host rewrite: %v", err)
				}
				return after, nil
			}
			once, err := vibelangfmt.Format("kanban.vibe", input, host)
			if err != nil {
				t.Fatal(err)
			}
			line, ok := lineContaining(once, "is Option.Some(let draggedId)")
			if !ok || !strings.Contains(line, "maybeDraggedItemId(model.dragAndDrop)") {
				t.Fatalf("is left the line of its subject or pattern:\n%s", once)
			}
			if name == "comment" && strings.Count(once, "/* kept */") != 1 {
				t.Fatalf("comment changed:\n%s", once)
			}
			twice, err := vibelangfmt.Format("kanban.vibe", once, host)
			if err != nil || once != twice {
				t.Fatalf("not idempotent: %v\nonce:\n%s\ntwice:\n%s", err, once, twice)
			}
		})
	}
}

// lineContaining returns the line of text that contains needle.
func lineContaining(text, needle string) (string, bool) {
	for _, line := range strings.Split(text, "\n") {
		if strings.Contains(line, needle) {
			return line, true
		}
	}
	return "", false
}

// TestFormatFoldkitIsLineWidths formats Foldkit's native Option control and
// is-line fixtures through dprint at several widths and operator positions.
// Kanban's wrapped is call once failed with ')' expected (foldkit-57).
func TestFormatFoldkitIsLineWidths(t *testing.T) {
	for _, width := range []int{40, 80, 120} {
		for _, position := range []string{"nextLine", "sameLine", "maintain"} {
			t.Run(fmt.Sprintf("%d/%s", width, position), func(t *testing.T) {
				host := isLineDprintFormatter(t, width, position)
				for _, root := range []string{"testdata/foldkit-native-option-control", "testdata/foldkit-is-line"} {
					err := filepath.WalkDir(root, func(name string, entry os.DirEntry, err error) error {
						if err != nil {
							return err
						}
						if entry.IsDir() {
							return nil
						}
						t.Run(name, func(t *testing.T) {
							source, err := os.ReadFile(name)
							if err != nil {
								t.Fatal(err)
							}
							once, err := vibelangfmt.Format(name, string(source), host)
							if err != nil {
								t.Fatal(err)
							}
							twice, err := vibelangfmt.Format(name, once, host)
							if err != nil || once != twice {
								t.Fatalf("not idempotent: %v\nonce:\n%s\ntwice:\n%s", err, once, twice)
							}
						})
						return nil
					})
					if err != nil {
						t.Fatal(err)
					}
				}
			})
		}
	}
}

func isLineDprintFormatter(t *testing.T, width int, position string) vibelangfmt.TypeScriptFormatter {
	t.Helper()
	binary := os.Getenv("VIBELANG_DPRINT")
	if binary == "" {
		t.Skip("set VIBELANG_DPRINT to run dprint width regressions")
	}
	data, err := os.ReadFile("testdata/dprint.json")
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	config["lineWidth"] = width
	ts := config["typescript"].(map[string]any)
	ts["operatorPosition"] = position
	ts["quoteStyle"] = "preferSingle"
	delete(ts, "trailingCommas") // Match the shipped formatSource defaults.
	path := filepath.Join(t.TempDir(), "dprint.json")
	data, err = json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return func(text string) (string, error) {
		cmd := exec.Command(binary, "fmt", "--config", path, "--stdin", "file.ts")
		cmd.Stdin = strings.NewReader(text)
		var out, stderr bytes.Buffer
		cmd.Stdout, cmd.Stderr = &out, &stderr
		if err := cmd.Run(); err != nil {
			return "", fmt.Errorf("%w: %s", err, stderr.String())
		}
		return out.String(), nil
	}
}
