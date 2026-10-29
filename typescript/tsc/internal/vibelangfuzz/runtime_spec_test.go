package vibelangfuzz

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/specgen"
)

// TestRuntimeFeatureCitations binds every feature to the chapter files and
// decision registry of the specification, rather than to a copied reference.
func TestRuntimeFeatureCitations(t *testing.T) {
	chapters, err := SpecGlob("*ch*.md")
	if err != nil {
		t.Fatal(err)
	}
	available := map[int]string{}
	chapterFile := regexp.MustCompile(`ch0*(\d+)-`)
	for _, file := range chapters {
		m := chapterFile.FindStringSubmatch(filepath.Base(file))
		if m == nil {
			continue
		}
		n, _ := strconv.Atoi(m[1])
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		heading := regexp.MustCompile(`(?m)^#{1,6} ` + strconv.Itoa(n) + `\. `)
		if !heading.Match(data) {
			t.Errorf("chapter %d has no heading in %s", n, file)
		}
		available[n] = file
	}
	decisions := SpecText("529-part5-ch29-decisions.md")
	chapterRef := regexp.MustCompile(`\bCh(?:apter)? (\d+)`)
	decisionRef := regexp.MustCompile(`\bD\d+\b`)
	for _, f := range specgen.Features {
		refs := chapterRef.FindAllStringSubmatch(f.Spec, -1)
		if len(refs) == 0 {
			t.Errorf("%s cites no chapter: %s", f.Name, f.Spec)
		}
		for _, m := range refs {
			n, _ := strconv.Atoi(m[1])
			if available[n] == "" {
				t.Errorf("%s cites missing chapter %s", f.Name, m[1])
			}
		}
		for _, d := range decisionRef.FindAllString(f.Spec, -1) {
			// Chapter 29 identifies each decision in the first cell of its own row.
			if !strings.Contains(decisions, "| "+d+" |") {
				t.Errorf("%s cites missing decision %s", f.Name, d)
			}
		}
	}
}

// TestRuntimeDeclaredContracts checks all three contract channels and the
// producer ABI (Chapters 2-4, 8, 14 and Chapter 27 rules 1 and 4).
func TestRuntimeDeclaredContracts(t *testing.T) {
	declarations := specgen.DeclaredContracts(`
export declare function a(): Effect.Effect<number, E0 | E1, S0>;
export declare function b(): Effect.Effect<void>;
export declare function c(): Stream.Stream<number, E1, S1>;
export declare function d(): number;
export declare function e(): import("effect").Effect.Effect<number>;
export declare function f(): import("effect/Stream").Stream<number, E1, S1>;
export declare function g(): import("effect/Effect").Effect<number>;
`)
	for _, tc := range []struct {
		name, a       string
		plain, stream bool
	}{
		{"a", "number", false, false}, {"b", "void", false, false},
		{"c", "number", false, true}, {"d", "number", true, false},
		{"e", "number", false, false},
		{"f", "number", false, true},
		{"g", "number", false, false},
	} {
		got, ok := declarations[tc.name]
		if !ok || got.A != tc.a || got.Plain != tc.plain || got.Stream != tc.stream {
			t.Errorf("%s: %+v", tc.name, got)
		}
	}
	if !declarations["a"].E.Equal(specgen.NameSet{"E0": true, "E1": true}) || !declarations["a"].R.Equal(specgen.NameSet{"S0": true}) || !declarations["c"].R.Equal(specgen.NameSet{"S1": true}) {
		t.Fatalf("lost contract channels: %+v", declarations)
	}
}
