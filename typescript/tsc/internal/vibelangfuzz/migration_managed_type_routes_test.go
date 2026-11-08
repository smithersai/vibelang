package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

var managedTypeRouteKeys = []string{
	"restore:return-type", "rebuild:return-type", "restore:import-type", "rebuild:import-type",
	"restore:type-query", "rebuild:type-query", "restore:value-import", "rebuild:value-import",
}

func TestMigrationManagedTypeRoutesQuoted(t *testing.T) {
	r4Quoted(t, "../vips/0034-compiler-and-tooling.md", "Existing tools work.")
	r4Quoted(t, "001-functions.md", "Every rule that requires declarations to match, migration included, means this.")
	text, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), "Repeated emission retains routes; revert restores source edges.") {
		t.Fatal("the managed-route preservation contract changed")
	}
}
func managedTypeRouteCompiler(tb testing.TB) string {
	tb.Helper()
	if binary := os.Getenv("VIBELANG_BINARY"); binary != "" {
		info, err := os.Stat(binary)
		if err != nil || !info.Mode().IsRegular() {
			tb.Fatalf("selected compiler unavailable: %v", err)
		}
		return binary
	}
	return cliBuild(tb, tb.TempDir())
}
func checkManagedTypeRoutes(t *testing.T, binary, key string, mode uint8) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), max(HangLimit, workerHangLimit))
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_managed_type_routes.mjs"), key, strconv.Itoa(int(mode&15)), binary)
	cmd.Dir = Root()
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("managed route observation: %v; context=%v\n%s", err, ctx.Err(), out)
	}
	type stage struct{ Stock struct{ Codes []string } }
	var model struct{ AfterRestore, AfterRebuild stage }
	if err := json.Unmarshal(out, &model); err != nil {
		t.Fatalf("invalid route observation: %v\n%s", err, out)
	}
	phase, form, _ := strings.Cut(key, ":")
	result := model.AfterRestore
	if phase == "rebuild" {
		result = model.AfterRebuild
	}
	if len(result.Stock.Codes) != 0 {
		if form == "value-import" || !slices.Equal(result.Stock.Codes, []string{"TS2307"}) {
			t.Fatalf("unexpected routing diagnostics:\n%s", out)
		}
		Gap(t, "FuzzMigrationManagedTypeRoutes", key, "VIP-34: a managed type query loses its resolving route during %s:\n%s", phase, out)
	}
	ExpectPending(t, "FuzzMigrationManagedTypeRoutes", key)
	ExpectPending(t, "FuzzMigrationManagedTypeRoutes", specCorpusKey(t))
}
func FuzzMigrationManagedTypeRoutes(f *testing.F) {
	startShortBudget(f)
	binary := managedTypeRouteCompiler(f)
	f.Add("rebuild:return-type", uint8(0))
	f.Add("restore:value-import", uint8(0))
	if !testing.Short() {
		for _, key := range managedTypeRouteKeys {
			f.Add(key, uint8(0))
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationManagedTypeRoutesQuoted(t)
		if !slices.Contains(managedTypeRouteKeys, key) {
			if key == "" {
				key = managedTypeRouteKeys[0]
			} else {
				key = managedTypeRouteKeys[int(key[0])%len(managedTypeRouteKeys)]
			}
		}
		if testing.Short() {
			mode = 0
		}
		checkManagedTypeRoutes(t, binary, key, mode)
	})
}
func TestMigrationManagedTypeRoutesNeighborhood(t *testing.T) {
	if testing.Short() {
		t.Skip("the complete source/query/configuration matrix runs separately")
	}
	binary := managedTypeRouteCompiler(t)
	for _, key := range managedTypeRouteKeys {
		for mode := range uint8(16) {
			t.Run(key+"/"+strconv.Itoa(int(mode)), func(t *testing.T) { checkManagedTypeRoutes(t, binary, key, mode) })
		}
	}
}
