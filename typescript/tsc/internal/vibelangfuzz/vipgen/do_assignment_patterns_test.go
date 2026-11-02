package vipgen

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// The independent reference executes as .mjs, not TypeScript. Check every
// generated shape/value/throw combination with Node before a long campaign.
func TestDoAssignmentPatternReferenceSyntax(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		if os.Getenv("VIBELANG_FUZZ_REQUIRE") == "1" {
			t.Fatal(err)
		}
		t.Skip("Node is required to parse native differential references")
	}
	for shape := range 7 {
		for present := range 3 {
			for failure := range 7 {
				t.Run(fmt.Sprintf("%d-%d-%d", shape, present, failure), func(t *testing.T) {
					g := &Gen{c: chooser{data: []byte{byte(shape), byte(present), byte(failure), 7}}, files: map[string]string{}, imports: map[string][]string{}}
					doAssignmentPattern(g, &Scope{})
					source := g.decls[0].(*Code).E
					cmd := exec.Command(node, "--input-type=module", "--check")
					cmd.Stdin = strings.NewReader(source)
					if output, err := cmd.CombinedOutput(); err != nil {
						t.Fatalf("native reference is not JavaScript: %v\n%s\n%s", err, output, source)
					}
				})
			}
		}
	}
}
