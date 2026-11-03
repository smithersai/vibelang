package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const schemaOwnRepairQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func schemaOwnTypeRepairQuotes(t testing.TB) {
	if !strings.Contains(SpecText("007-tooling.md"), schemaOwnRepairQuote) {
		t.Fatal("chapter 007 lost schema repair preservation rule")
	}
}

func TestSchemaOwnTypeRepairQuoted(t *testing.T) { schemaOwnTypeRepairQuotes(t) }

// This is a static eligibility oracle: a custom helper cannot be deleted as
// an own type. Runtime equivalence remains in FuzzVIPDifferential.
func FuzzSchemaOwnTypeRepair(f *testing.F) {
	startShortBudget(f)
	schemaOwnTypeRepairQuotes(f)
	keys := []string{"custom-literal", "custom-object", "custom-interface", "renamed-custom", "real-alias", "real-interface", "own-query"}
	for _, key := range keys {
		f.Add(key, false)
		f.Add(key, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, declared bool) {
		found := false
		for _, k := range keys {
			if key == k {
				found = true
			}
		}
		if !found {
			key = keys[len(key)%len(keys)]
		}
		custom := strings.Contains(key, "custom")
		helper := "Schema"
		if key == "renamed-custom" {
			helper = "Other"
		}
		own := "export type User = " + helper + ".Schema.Type<typeof User>;"
		if strings.Contains(key, "interface") {
			own = "export interface User extends " + helper + ".Schema.Type<typeof User> {}"
		}
		files := map[string]string{}
		prefix := "import * as Schema from 'effect/Schema';"
		if custom {
			prefix = "import type * as " + helper + " from './custom.js';"
			result := "\"sentinel\""
			if key == "custom-object" || key == "custom-interface" {
				result = "{readonly brand:'custom'}"
			}
			files["custom.ts"] = "export namespace Schema { export type Type<T> = " + result + " }"
		}
		if key == "own-query" {
			prefix = ""
			own = "export type User = typeof User.Type;"
		}
		files["main.vibe"] = "import {Schema as S} from 'effect';\n" + prefix + "\nexport const User=S.Struct({});\n" + own + "\n"
		config := fmt.Sprintf("{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"declaration\":%t,\"outDir\":\"out\"},\"files\":[\"main.vibe\"]}", declared)
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		if !toolsErrorFree(r) {
			t.Fatalf("invalid fixture: %v", r.Diagnostics)
		}
		want := !custom && (!declared || key == "own-query")
		warned := false
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 4832 {
				warned = true
				if !want && toolsOffersQuickFix(t, w, r, "main.vibe", d) {
					Gap(t, "FuzzSchemaOwnTypeRepair", "own-type:"+key, "schema repair would erase an unrelated associated type (declaration=%v)", declared)
				}
			}
		}
		if warned != want {
			Gap(t, "FuzzSchemaOwnTypeRepair", "own-type:"+key, "EK4832 offered=%v, want %v (declaration=%v)", warned, want, declared)
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, r.Dir), vibelang.FixOptions{})
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		count := 0
		for _, file := range fixed.Files {
			count += file.Counts[4832]
		}
		if (count > 0) != want {
			Gap(t, "FuzzSchemaOwnTypeRepair", "own-type:"+key, "CLI schema repairs=%d, want eligibility %v", count, want)
		}
		ExpectPending(t, "FuzzSchemaOwnTypeRepair", "own-type:"+key)
	})
}
