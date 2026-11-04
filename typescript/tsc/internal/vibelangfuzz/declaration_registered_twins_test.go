package vibelangfuzz

import (
	"maps"
	"os"
	"strings"
	"sync"
	"testing"
)

const registeredDeclarationTwinQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func TestDeclarationIdentityRegisteredTwinsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), registeredDeclarationTwinQuote) {
		t.Fatal(registeredDeclarationTwinQuote)
	}
}

// These are the existing acceptance harness's declared API-identity pairs.
// Keys mirror parityInputs byte for byte; no seed selection, corpus, comparator
// or admission threshold changes. Unknown/mutated archives keep raw renaming.
var registeredDeclarationIdentityTwins = sync.OnceValue(func() map[string]Project {
	twins := map[string]Project{}
	for _, seed := range CaseSeeds() {
		if seed.Pending != "" {
			continue
		}
		if _, ok := seed.Files["typescript/tsconfig.json"]; !ok {
			continue
		}
		tsFiles, vibeFiles := map[string]string{}, map[string]string{}
		hasVibe := false
		for name, text := range seed.Files {
			if rest, ok := strings.CutPrefix(name, "typescript/"); ok {
				if isTypeScript(rest) || strings.HasSuffix(rest, ".json") {
					tsFiles[rest] = withoutVibe(text)
					if rest == "tsconfig.json" {
						tsFiles[rest] = withEmitters(tsFiles[rest])
					}
				}
			} else {
				vibeFiles[name] = text
				hasVibe = hasVibe || strings.HasSuffix(name, ".vibe")
			}
		}
		if !hasVibe {
			continue
		}
		paired := ProjectFromArchive(Archive(vibeFiles))
		if Admissible(paired) != "" {
			continue
		}
		key := Archive(tsFiles)
		// Same first-case rule as parityInputs' deterministic deduplication.
		if _, exists := twins[key]; !exists {
			twins[key] = paired
		}
	}
	return twins
})

func registeredDeclarationIdentityTwin(archive string) (Project, bool) {
	paired, ok := registeredDeclarationIdentityTwins()[archive]
	if !ok {
		return Project{}, false
	}
	return Project{Files: maps.Clone(paired.Files), Config: paired.Config}, true
}

func declarationIdentityRegisteredFixture(t testing.TB, name string) (string, Seed) {
	t.Helper()
	var fixture Seed
	for _, seed := range CaseSeeds() {
		if seed.Name == name {
			fixture = seed
			break
		}
	}
	if fixture.Files == nil {
		t.Fatalf("missing registered declaration fixture %s", name)
	}
	for _, seed := range parityInputs() {
		if seed.Name == name+" typescript/" {
			return Archive(seed.Files), fixture
		}
	}
	t.Fatalf("missing registered TypeScript twin %s", name)
	return "", Seed{}
}

func TestDeclarationIdentityRegisteredTwins(t *testing.T) {
	TestDeclarationIdentityRegisteredTwinsQuoted(t)
	for _, name := range []string{"vip1-coverage-overloads", "vip5-coverage-execution", "allsettled-construction-order"} {
		t.Run(name, func(t *testing.T) {
			archive, fixture := declarationIdentityRegisteredFixture(t, name)
			stock, vibe, reason := declarationIdentityProjects(archive)
			if reason != "" {
				t.Fatal(reason)
			}
			if vibe.Files["main.vibe"] != fixture.Files["main.vibe"] {
				t.Fatal("registered pair was replaced by a raw TypeScript rename")
			}
			if stock.Files["main.ts"] != Unarchive(archive)["main.ts"] {
				t.Fatal("changed the stock TypeScript reference")
			}
			// A consumer cannot mutate the cached counterpart for the next call.
			vibe.Files["main.vibe"] = "changed"
			_, again, reason := declarationIdentityProjects(archive)
			if reason != "" || again.Files["main.vibe"] != fixture.Files["main.vibe"] {
				t.Fatal("mutated cached counterpart")
			}
			files := Unarchive(archive)
			files["main.ts"] = "// independent native mutation\n" + files["main.ts"]
			mutated := Archive(files)
			_, raw, reason := declarationIdentityProjects(mutated)
			if reason != "" || raw.Files["main.vibe"] != files["main.ts"] {
				t.Fatal("unregistered mutation did not retain raw rename semantics")
			}
		})
	}
}

func TestDeclarationIdentityRegisteredTwinAPI(t *testing.T) {
	archive, _ := declarationIdentityRegisteredFixture(t, "vip1-coverage-overloads")
	stock, vibe, reason := declarationIdentityProjects(archive)
	if reason != "" {
		t.Fatal(reason)
	}
	w := NewWorkspace(t)
	c, err := w.CompileOrdered(t.Context(), vibe, OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	if c.Program == nil || HasError(c.Diagnostics) {
		t.Fatalf("registered VibeLang counterpart must compile: %v", SortedKeys(Keys(c.Dir, c.Diagnostics)))
	}
	dir := emitDeclarationIdentityStock(t, w, StockTypeScript(t), stock)
	defer os.RemoveAll(dir)
	emitted := t.TempDir()
	for file, text := range c.Outputs {
		if isDeclaration(file) {
			if err := writeInside(emitted, file, text); err != nil {
				t.Fatal(err)
			}
		}
	}
	if diff := compareDeclarationTrees(t, dir, emitted); diff != "" {
		t.Fatal(diff)
	}
}
