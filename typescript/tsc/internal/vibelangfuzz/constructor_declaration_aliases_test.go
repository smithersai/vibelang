package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const constructorDeclarationAliasesTarget = "FuzzConstructorDeclarationAliases"
const constructorDeclarationAliasesQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func TestConstructorDeclarationAliasesQuoted(t *testing.T) {
	r4Quoted(t, "001-functions.md", constructorDeclarationAliasesQuote)
	requireLegacyJavaScriptQuotes(t)
}

// Repeated writes keep their ordinary TypeScript meaning. The existing output
// oracle independently type-checks emitted declarations with native and stock
// consumers; the access-policy neighborhood alone does not exercise this emit.
func FuzzConstructorDeclarationAliases(f *testing.F) {
	startShortBudget(f)
	keys := []string{"dot-bracket", "bracket-dot", "dot-dot", "bracket-bracket", "dot", "bracket", "ordinary-member", "empty"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 7} {
			f.Add(key, mode)
		}
	}
	raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "constructor-declaration-mixed-writes.vibe"))
	if err != nil {
		f.Fatal(err)
	}
	template := string(raw)
	const mixed = "f.constructor = g;\nf[\"constructor\"] = g;"
	if !strings.Contains(template, mixed) {
		f.Fatal("constructor corpus no longer contains its mixed writes")
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		t.Parallel()
		TestConstructorDeclarationAliasesQuoted(t)
		key = strings.TrimPrefix(key, "key:")
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		dot, bracket := "f.constructor = g;", "f[\"constructor\"] = g;"
		writes := mixed
		switch key {
		case "bracket-dot":
			writes = bracket + "\n" + dot
		case "dot-dot":
			writes = dot + "\n" + dot
		case "bracket-bracket":
			writes = bracket + "\n" + bracket
		case "dot":
			writes = dot
		case "bracket":
			writes = bracket
		case "ordinary-member":
			writes = "f.label = g;\nf.other = g;"
		case "empty":
			writes = ""
		}
		source := strings.Replace(template, mixed, writes, 1)
		if mode&4 != 0 {
			source = strings.NewReplacer("function f(", "function taskΔ(", "f.", "taskΔ.", "f[", "taskΔ[", "f()", "taskΔ()", "function g(", "function valueΛ(", " = g;", " = valueΛ;").Replace(source)
		}
		if mode&1 != 0 {
			source = "// expando declaration\n" + source
		}
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		t.Logf("constructor declaration key=%s mode=%d", key, mode&7)
		project := Single(source)
		c, err := w.CompileOrdered(t.Context(), project, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		if c.Program == nil || HasError(c.Diagnostics) {
			t.Fatalf("valid constructor-write source did not compile: %v\n%s", SortedKeys(Keys(c.Dir, c.Diagnostics)), source)
		}
		gaps := &Gaps{Target: constructorDeclarationAliasesTarget, Input: key}
		(&OutputChecker{W: w, G: gaps, Ctx: t.Context(), Logf: t.Logf}).Check(c)
		for i := range gaps.found {
			gaps.found[i].key = fmt.Sprintf("declaration:%s:%s", key, gaps.found[i].key)
		}
		gaps.FinishInput(t, specCorpusKey(t))
		ExpectPending(t, constructorDeclarationAliasesTarget, "declaration:"+key+":feature:declaration-consumer-TS2300")
	})
}
