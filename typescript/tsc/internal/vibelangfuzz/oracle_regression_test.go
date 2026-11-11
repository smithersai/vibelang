package vibelangfuzz

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Exercise the harness entry points, including TestMain, so bookkeeping
// checks cannot pass while the actual oracles remain disabled.
func TestOracleIsolationRegression(t *testing.T) {
	t.Run("declaration identity", func(t *testing.T) {
		if _, ok := Pending("FuzzDeclarationIdentity", "feature:declaration-identity"); ok {
			t.Fatal("every declaration difference is pending under the target's only comparison key")
		}
	})
	t.Run("pending XPASS", func(t *testing.T) {
		exe, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(exe, "-test.run=^FuzzPendingAuditProbe$", "-test.short")
		cmd.Env = append(os.Environ(), "VIBELANG_FUZZ_REQUIRE=1", "VIBELANG_ORACLE_AUDIT_PROBE=1")
		out, err := cmd.CombinedOutput()
		if err == nil || !strings.Contains(string(out), "XPASS FuzzPendingAuditProbe contract:fixed") {
			t.Fatalf("a passing oracle with a pending contract must fail as XPASS: exit %v\n%s", err, out)
		}
	})
	t.Run("consumer beside pending gap", func(t *testing.T) {
		w := NewWorkspace(t)
		c, err := w.CompileOrdered(t.Context(), Single("export function f(n: number) { return n }\n"), OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		g := &Gaps{Target: "FuzzCompile"}
		g.Add("feature:order:emit-first:+TS2304", "another oracle's pending gap")
		(&OutputChecker{W: w, G: g, Ctx: t.Context(), Logf: t.Logf}).Check(c)
		if _, err := os.Stat(filepath.Join(c.Dir, "__declarations", "__consumer.mts")); err != nil {
			t.Fatalf("a pending gap suppressed the declaration consumer: %v", err)
		}
	})
	t.Run("every native consumer error", func(t *testing.T) {
		w := NewWorkspace(t)
		c, err := w.CompileOrdered(t.Context(), Single("export const n = 1\n"), OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		c.Outputs["out/main.d.ts"] = "export declare const first: Absent1;\nexport declare const second: Absent2;\n"
		g := &Gaps{}
		(&OutputChecker{W: w, G: g, Ctx: t.Context(), Logf: t.Logf}).checkConsumer(c, []string{"out/main.d.ts"})
		for _, want := range []string{"feature:declaration-consumer-TS2304:first", "feature:declaration-consumer-TS2304:second"} {
			if !slices.ContainsFunc(g.found, func(f gap) bool { return f.key == want }) {
				t.Errorf("missing %s: %v", want, g.found)
			}
		}
	})
	t.Run("layer prose", func(t *testing.T) {
		got := any(toolsLeftOut("FuzzEditor", map[string]string{"main.vibe": "// the layer is a separate value\nexport const n = 1\n"}))
		if got != false && got != "" {
			t.Fatalf("prose suppressed the editor oracle: %v", got)
		}
	})
	t.Run("registered categories", func(t *testing.T) {
		if SpecHasCode(4618) {
			t.Error("retired EK4618 is registered")
		}
		for _, c := range []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion, diagnostics.CategoryMessage} {
			if CategoryMatches(DefaultUnknown, c) {
				t.Errorf("an unknown default accepted %s", c.Name())
			}
		}
	})
	t.Run("stock package path in message", func(t *testing.T) {
		w := NewWorkspace(t)
		c, err := w.CompileOrdered(t.Context(), Single("export const n = 1\n"), OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		dir := filepath.Join(c.Dir, "__stock_regression")
		for name, text := range map[string]string{
			"out/main.d.ts":  "import * as Effect from \"effect/Effect\";\nexport type Bad = Effect.DefinitelyMissing;\n",
			"__consumer.mts": "export * from \"./out/main.js\";\n",
			"tsconfig.json":  "{\"files\":[\"__consumer.mts\",\"out/main.d.ts\"]}",
		} {
			if err := writeInside(dir, name, text); err != nil {
				t.Fatal(err)
			}
		}
		g := &Gaps{}
		(&OutputChecker{W: w, G: g, Ctx: t.Context(), Logf: t.Logf}).checkStockConsumer(dir, nil)
		if !slices.ContainsFunc(g.found, func(f gap) bool { return strings.HasPrefix(f.key, "feature:declaration-consumer-TS2694") }) {
			t.Fatalf("stock error naming an installed module was dropped: %v", g.found)
		}
	})
}

func FuzzPendingAuditProbe(f *testing.F) {
	startShortBudget(f)
	if os.Getenv("VIBELANG_ORACLE_AUDIT_PROBE") != "1" {
		f.Skip("subprocess control")
	}
	pendingEntries = func() ([]PendingEntry, error) {
		return []PendingEntry{{Target: "FuzzPendingAuditProbe", Key: "contract:fixed", Owner: "compiler", Reason: "the contract now holds"}}, nil
	}
	f.Add([]byte("fixed"))
	f.Fuzz(func(t *testing.T, data []byte) {
		// Reading or listing a key is not evidence that its oracle failed.
		Pending("FuzzPendingAuditProbe", "contract:fixed")
		PendingFeatures("FuzzPendingAuditProbe")
	})
}
