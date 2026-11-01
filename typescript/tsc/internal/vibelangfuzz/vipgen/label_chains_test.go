package vipgen

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// The corpus names promise all 40 combinations. Check the generated source,
// not just the input bytes: a chooser can omit a byte for a one-way choice.
func TestLabelChainCorpusCoversTargets(t *testing.T) {
	loop := regexp.MustCompile("(label[0-9]+: (?:label[0-9]+: )*)for \\(const (\\[?item[0-9]+\\]?) of")
	jumpPattern := regexp.MustCompile("(continue|break) (label[0-9]+)")
	for count := 1; count <= 4; count++ {
		for target := 0; target < count; target++ {
			for _, jump := range []string{"continue", "break"} {
				for _, destructure := range []bool{false, true} {
					name := fmt.Sprintf("for-of-label-chain-%d-%d-%s", count, target, jump)
					if destructure {
						name += "-destructure"
					}
					t.Run(name, func(t *testing.T) {
						path := filepath.Join("..", "testdata/fuzz/FuzzVIPDifferential", name)
						data, err := os.ReadFile(path)
						if err != nil {
							t.Fatal(err)
						}
						lines := strings.SplitN(strings.TrimSpace(string(data)), "\n", 2)
						if len(lines) != 2 {
							t.Fatal("invalid fuzz corpus header")
						}
						literal := strings.TrimSuffix(strings.TrimPrefix(lines[1], "[]byte("), ")")
						input, err := strconv.Unquote(literal)
						if err != nil {
							t.Fatal(err)
						}
						program := Generate([]byte(input), nil)
						if program == nil {
							t.Fatal("corpus no longer selects a construct")
						}
						source := PrintVibe(program)
						shape, branch := loop.FindStringSubmatch(source), jumpPattern.FindStringSubmatch(source)
						if len(shape) != 3 || len(branch) != 3 {
							t.Fatalf("missing native labeled loop: %s", source)
						}
						labels := strings.Split(strings.TrimSuffix(shape[1], ": "), ": ")
						if len(labels) != count || branch[1] != jump || branch[2] != labels[target] || strings.HasPrefix(shape[2], "[") != destructure {
							t.Fatalf("corpus name does not match generated loop: %s", source)
						}
					})
				}
			}
		}
	}
}
