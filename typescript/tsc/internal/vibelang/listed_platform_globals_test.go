package vibelang

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// A listed platform global follows the value rules that unlisted host globals
// follow (host_global_declarations_test.go): a shorthand property reads it, a
// type query is TypeScript's and erased, and a local or a property of the same
// name is not it. Each context is one program holding every listed name the
// default libraries declare, one statement per line, so the oracle covers the
// whole table: a name EK4402 reports as a direct value must be reported as a
// shorthand, and never in the other contexts.
func TestListedPlatformGlobalsFollowValueRules(t *testing.T) {
	identifier := regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)
	var names []string
	for name := range platformGlobals {
		if identifier.MatchString(name) && name != "globalThis" {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	// reported returns, per name, how many EK4402 diagnostics fall on its line.
	reported := func(t *testing.T, context string, statement func(i int, name string) string) map[string]int {
		t.Helper()
		lines := make([]string, len(names))
		for i, name := range names {
			lines[i] = statement(i, name)
		}
		source := strings.Join(lines, "\n") + "\n"
		p, file, _, _ := editorProgram(t, source)
		counts := map[string]int{}
		for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
			if d.Source() != diagnosticSource || d.Code() != EK4402.Code {
				continue
			}
			line := strings.Count(source[:d.Pos()], "\n")
			if line >= len(names) {
				t.Fatalf("%s: diagnostic past the last statement: %s", context, d.String())
			}
			counts[names[line]]++
		}
		return counts
	}
	direct := reported(t, "direct", func(i int, name string) string { return fmt.Sprintf("export const v%d = %s", i, name) })
	contexts := []struct {
		name      string
		want      int
		statement func(i int, name string) string
	}{
		{"shorthand", 1, func(i int, name string) string { return fmt.Sprintf("export const v%d = { %s }", i, name) }},
		{"type query", 0, func(i int, name string) string { return fmt.Sprintf("export type T%d = typeof %s", i, name) }},
		{"local shadow", 0, func(i int, name string) string {
			return fmt.Sprintf("export function f%d(%s: number) { return { %s } }", i, name, name)
		}},
		{"unrelated property", 0, func(i int, name string) string {
			return fmt.Sprintf("const own%d = { %s: 1 }; export const v%d = own%d.%s", i, name, i, i, name)
		}},
	}
	covered := 0
	for _, name := range names {
		if direct[name] == 1 {
			covered++
		}
	}
	// The default libraries declare most browser globals; the oracle must cover them.
	if covered < 20 {
		t.Fatalf("only %d listed names resolve as host values; the oracle covers too little", covered)
	}
	for _, context := range contexts {
		t.Run(context.name, func(t *testing.T) {
			got := reported(t, context.name, context.statement)
			for _, name := range names {
				if direct[name] != 1 {
					continue // not a host value in this program: no oracle
				}
				if got[name] != context.want {
					t.Errorf("%s as %s: %d EK4402, want %d", name, context.name, got[name], context.want)
				}
			}
		})
	}
}
