package vibelangfuzz

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzConfig checks the current top-level vibe configuration (VIP-30),
// severities from Appendix B, and inheritance from 007-tooling.md.
func FuzzConfig(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, seed := range ConfigSeeds() {
		f.Add(seed[0], seed[1])
	}
	f.Fuzz(func(t *testing.T, config, source string) {
		t.Parallel() // the seed corpus only; fuzzing ignores it
		CheckConfig(t, w, "FuzzConfig", config, source)
	})
}

// ConfigSeeds pair settings with sources: each acceptance case's own
// settings with its source, each adjustable and each fixed code at every
// severity with a case that reports it, and settings that are invalid.
var ConfigSeeds = sync.OnceValue(func() [][2]string {
	var seeds [][2]string
	source := "export const value = 1"
	byCode := map[int32]string{}
	for _, seed := range CaseSeeds() {
		witness := seed.Files["main.vibe"]
		if witness == "" {
			continue
		}
		for _, code := range codesIn(strings.Join(seed.Codes, " ")) {
			if byCode[code] == "" {
				byCode[code] = witness
			}
		}
	}
	for _, config := range []string{
		"{}", `{"effectGlobals":false}`, `{"effectModules":false}`,
		`{"unknown":true}`, `{"effectGlobals":"no"}`, `{"severities":[]}`,
		`{"severities":{"EK0801":1}}`, `{"severities":{"EK0801":"info"}}`,
		`{"severities":{"EK9999":"off"}}`,
		`{"severities":{"EK3833":"off"}}`, `{"severities":{"EK38108":"suggestion"}}`,
		`{"severities":{"EK3800":"off"}}`, `{"severities":{"EK38131":"off"}}`,
	} {
		seeds = append(seeds, [2]string{config, source})
	}
	for _, code := range SpecCodes() {
		// Every registered code checks adjustability, including a non-warning
		// requested at its default severity: that entry is still invalid.
		for _, severity := range Facts().Severities {
			witness := source
			if byCode[code] != "" {
				witness = byCode[code]
			}
			seeds = append(seeds, [2]string{fmt.Sprintf(`{"severities":{"EK%04d":%q}}`, code, severity), witness})
		}
	}
	return seeds
})

// The current chapter lists the decided keys exhaustively; tracing has no
// accepted VIP. Detail 268 adds the opt-in sidecar directory. Check the
// citation so changing it fails the spec gate.
const automaticTracingKeysQuote = "The decided keys (VIP-30, amended) are:\n\n| Key | Meaning |\n| --- | --- |\n| `vibe.effectGlobals` | Boolean switch, default `true`, for Effect's function globals ([VIP-6](../vips/0006-effect-globals.md)); `false` turns them off. |\n| `vibe.effectModules` | Boolean switch, default `true`, for Effect's modules in scope ([VIP-14](../vips/0014-effect-modules-in-scope.md)); `false` turns them off. |\n| `vibe.sidecarDir` | Directory, default unset, that holds every declaration sidecar at its source's path relative to TypeScript's declaration source root (explicit `rootDir`, the config directory for a composite project, or the common source directory otherwise), instead of `x.d.vibe.ts` beside `x.vibe` ([VIP-27](../vips/0027-declaration-output.md#decision), amended). Conventionally `.vibe/declarations`; pair it with virtual roots for the source root and output directory, such as `\"rootDirs\": [\".\", \".vibe/declarations\"]` with `rootDir: \".\"` so stock TypeScript resolves `./x.vibe`. A relative path resolves from the config that declares it; a leading `${configDir}` from the selected config. An empty string names the declaring directory and overrides an inherited path; only an absent entry inherits. Wrong types report `EK3007`. |\n| `vibe.severities` | Maps VibeLang's own warning codes and all imported `EK38xx` lint codes to `\"error\"`, `\"warning\"`, `\"suggestion\"` or `\"off\"` ([VIP-30](../vips/0030-config-files.md#decision), [VIP-34](../vips/0034-compiler-and-tooling.md#decision), [VIP-38](../vips/0038-effect-lint-built-in.md#decision)). |\n\n"

func TestAutomaticTracingKeysQuoted(t *testing.T) {
	chapter, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), compactAutomaticTracingKeysQuote) {
		t.Fatal("configuration key citation changed")
	}
}

// The compact chapter has the same closed key inventory; keep the historical
// quotation available to queued sidecar-model changes.
const compactAutomaticTracingKeysQuote = "Write VibeLang settings in the root `vibe` object ([VIP-30](../vips/0030-config-files.md#decision)):\n\n| Key | Meaning |\n| --- | --- |\n| `vibe.effectGlobals` | Boolean; default `true`. Put Effect's functions in scope ([VIP-6](../vips/0006-effect-globals.md)); `false` turns the function globals off. Qualified calls such as `Effect.sleep` remain available when `vibe.effectModules` is `true`. |\n| `vibe.effectModules` | Boolean; default `true`. Put Effect's modules in scope ([VIP-14](../vips/0014-effect-modules-in-scope.md)); `false` requires imports. |\n| `vibe.sidecarDir` | String; absent by default. Move compatibility declarations from beside their sources to the mirrored directory described above ([VIP-27](../vips/0027-declaration-output.md#decision)). Relative paths use the declaring config; a leading `${configDir}` uses the selected config. An empty string names the declaring directory and overrides inheritance; only absence inherits. |\n| `vibe.severities` | Object; default `{}`. Maps VibeLang's own warning codes and assigned imported `EK38xx` codes to `\"error\"`, `\"warning\"`, `\"suggestion\"` or `\"off\"` ([VIP-30](../vips/0030-config-files.md#decision), [VIP-34](../vips/0034-compiler-and-tooling.md#decision), [VIP-38](../vips/0038-effect-lint-built-in.md#decision)). |\n\n"

// A configPlacement is where a project's settings sit (D34, D275).
type configPlacement int

const (
	placeTopLevel configPlacement = iota
	placeExtended
)

const configOptions = `"target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "skipLibCheck": true, "types": [], "noEmit": true`

// configProject is main.vibe with settings at a placement; settings "" is
// the same project without them.
func configProject(source, settings string, place configPlacement) Project {
	files := map[string]string{"main.vibe": source}
	options := configOptions
	var top string
	switch {
	case settings == "":
	case place == placeTopLevel:
		top = `, "vibe": ` + settings
	case place == placeExtended:
		files["base.json"] = `{"vibe": ` + settings + `}`
		top = `, "extends": "./base.json"`
	}
	return Project{Files: files, Config: `{"compilerOptions": {` + options + `}, "files": ["main.vibe"]` + top + `}`}
}

// settingProblems reads the decided keys and their meanings from current
// tooling. "An unknown `vibe` key or a value of the wrong type is a config
// error (`EK3007`)" and the severities-entry exception are stated there.
func settingProblems(settings map[string]any) []string {
	facts := Facts()
	var problems []string
	for key, value := range settings {
		switch key {
		case "severities":
			codes, ok := value.(map[string]any)
			if !ok {
				problems = append(problems, "severities is not an object")
				continue
			}
			for code, severity := range codes {
				n := codesIn(code)
				if len(n) != 1 || code != specCodeName(n[0]) || !facts.IsAdjustable(n[0]) {
					problems = append(problems, "severities."+code+" is not adjustable")
				}
				if level, ok := severity.(string); !ok || !slices.Contains(facts.Severities, level) {
					problems = append(problems, fmt.Sprintf("severities.%s is %v", code, severity))
				}
			}
		default:
			if slices.Contains(facts.BooleanSettings, key) {
				if _, ok := value.(bool); !ok {
					problems = append(problems, key+" is not a boolean")
				}
			} else {
				problems = append(problems, "unknown setting "+key)
			}
		}
	}
	slices.Sort(problems)
	return problems
}

// duplicateKeys reports whether a JSON text repeats a key in one object,
// where Go's decoder and TypeScript's may keep different values.
func duplicateKeys(text string) bool {
	decoder := json.NewDecoder(bytes.NewReader([]byte(text)))
	type frame struct {
		keys   map[string]bool
		object bool
		key    bool
	}
	var stack []*frame
	for {
		token, err := decoder.Token()
		if err != nil {
			return false
		}
		top := func() *frame {
			if len(stack) == 0 {
				return nil
			}
			return stack[len(stack)-1]
		}
		switch v := token.(type) {
		case json.Delim:
			if v == '{' || v == '[' {
				if f := top(); f != nil && f.object {
					f.key = true
				}
				stack = append(stack, &frame{keys: map[string]bool{}, object: v == '{', key: true})
			} else {
				stack = stack[:len(stack)-1]
			}
		case string:
			if f := top(); f != nil && f.object && f.key {
				if f.keys[v] {
					return true
				}
				f.keys[v] = true
				f.key = false
				continue
			}
			if f := top(); f != nil && f.object {
				f.key = true
			}
		default:
			if f := top(); f != nil && f.object {
				f.key = true
			}
		}
	}
}

// isConfigDiagnostic reports whether a diagnostic is about a configuration
// file rather than a source.
func isConfigDiagnostic(d *ast.Diagnostic) bool {
	return d.File() == nil || strings.HasSuffix(string(d.File().FileName()), ".json")
}

type occurrence struct {
	pos, length int
	category    diagnostics.Category
}

func occurrences(ds []*ast.Diagnostic, code int32) []occurrence {
	var list []occurrence
	for _, d := range ds {
		if IsEK(d) && d.Code() == code && !isConfigDiagnostic(d) {
			list = append(list, occurrence{d.Pos(), d.Len(), d.Category()})
		}
	}
	slices.SortFunc(list, func(a, b occurrence) int {
		if a.pos != b.pos {
			return a.pos - b.pos
		}
		if a.length != b.length {
			return a.length - b.length
		}
		return int(a.category) - int(b.category)
	})
	return list
}

// CheckConfig compares the compiler with itself with and without category
// settings. Expected identities and categories come only from Appendix B.
func CheckConfig(t *testing.T, w *Workspace, target, config, source string) {
	if len(config) > 4<<10 || len(source) > 32<<10 {
		t.Skip("too large")
	}
	var settings map[string]any
	if json.Unmarshal([]byte(config), &settings) != nil || settings == nil || duplicateKeys(config) {
		t.Skip("one JSON object without repeated keys required")
	}
	if reason := ConfinedProject(Project{Files: map[string]string{"main.vibe": source, "base.json": config}}); reason != "" {
		t.Skip(reason)
	}
	g := &Gaps{Target: target}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
	}
	defer recoverCompilerPanic(t, target)
	place := configPlacement(seedHash(config, source) % 2)
	compile := func(settings string) *Compilation {
		c, err := w.CompileOrdered(t.Context(), configProject(source, settings, place), OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(c.Remove)
		return c
	}
	configured := compile(config)
	problems := settingProblems(settings)
	var configErrors []*ast.Diagnostic
	for _, diagnostic := range configured.Diagnostics {
		if isConfigDiagnostic(diagnostic) && diagnostic.Category() == diagnostics.CategoryError {
			configErrors = append(configErrors, diagnostic)
		}
	}
	if len(problems) > 0 {
		for _, problem := range problems {
			expected := Facts().ConfigValueCode
			if strings.HasPrefix(problem, "severities.") {
				expected = Facts().SeverityConfigCode
			}
			found := slices.ContainsFunc(configErrors, func(d *ast.Diagnostic) bool { return IsEK(d) && d.Code() == expected })
			if found {
				continue
			}
			problemKey := "ek:" + specCodeName(expected)
			g.Add(problemKey, "007-tooling.md: invalid vibe settings %s (%s) did not report the specified config error", config, problem)
		}
	}
	if len(problems) == 0 {
		for _, diagnostic := range configErrors {
			problemKey := "feature:config-valid-rejected"
			// A rejected valid severity entry is a gap in that assigned code,
			// not a blanket exemption for all valid configurations.
			if IsEK(diagnostic) && diagnostic.Code() == Facts().SeverityConfigCode {
				if entries, ok := settings["severities"].(map[string]any); ok {
					reported := codesIn(diagnostic.String())
					for name := range entries {
						code := codesIn(name)
						if len(entries) == 1 || len(code) == 1 && slices.Contains(reported, code[0]) {
							problemKey = "ek:" + name
							break
						}
					}
				}
			}
			g.Add(problemKey, "007-tooling.md: valid vibe settings %s rejected: %s", config, keyOf(configured.Dir, diagnostic))
		}
	}
	// Invalid entries have the specified config-error oracle above. Tooling
	// defines category changes for valid entries; it gives no preservation
	// contract for a program rejected by configuration validation.
	if len(problems) > 0 {
		g.FinishInput(t, key)
		return
	}
	// Only severities maps change categories. Global switches change name
	// resolution, so no diagnostic-preservation comparison is specified for them.
	if _, globals := settings["effectGlobals"]; globals {
		g.FinishInput(t, key)
		return
	}
	if _, modules := settings["effectModules"]; modules {
		g.FinishInput(t, key)
		return
	}
	baseline := compile("")
	facts := Facts()
	set := map[int32]string{}
	if entries, ok := settings["severities"].(map[string]any); ok {
		for name, level := range entries {
			codes := codesIn(name)
			if severity, ok := level.(string); ok && len(codes) == 1 && specCodeName(codes[0]) == name && facts.IsAdjustable(codes[0]) && slices.Contains(facts.Severities, severity) {
				set[codes[0]] = severity
			}
		}
	}
	var codes []int32
	for _, diagnostic := range slices.Concat(configured.Diagnostics, baseline.Diagnostics) {
		if IsEK(diagnostic) && !isConfigDiagnostic(diagnostic) && !slices.Contains(codes, diagnostic.Code()) {
			codes = append(codes, diagnostic.Code())
		}
	}
	slices.Sort(codes)
	for _, code := range codes {
		got, base := occurrences(configured.Diagnostics, code), occurrences(baseline.Diagnostics, code)
		name := specCodeName(code)
		problemKey := "ek:" + name
		if !facts.IsRegistered(code) {
			problemKey = "registry:" + name
		}
		severity, isSet := set[code]
		switch {
		case isSet && severity == "off":
			if len(got) > 0 {
				g.Add(problemKey, "007-tooling.md: off still reports %s: %v", name, got)
			}
		case isSet && severity == "suggestion":
			// 007-tooling.md: "A `"suggestion"` is shown by the language
			// server only". This compilation is the command line's report.
			if len(got) > 0 {
				g.Add(problemKey, "007-tooling.md: the command line reports the suggestion %s: %v", name, got)
			}
		case isSet:
			for _, occurrence := range got {
				if occurrence.category.Name() != severity {
					g.Add(problemKey, "007-tooling.md: requested %s, got %s", severity, occurrence.category.Name())
				}
			}
			// Only a default the command line shows gives a baseline: a rule
			// off or a suggestion by default reports nothing to compare.
			if d := facts.Default(code); (d == DefaultError || d == DefaultWarning) && !samePositions(got, base) {
				g.Add(problemKey, "007-tooling.md: severity changes positions of %s: %v versus %v", name, got, base)
			}
		default:
			if !slices.Equal(got, base) {
				g.Add(problemKey, "007-tooling.md: no valid severity entry changes %s: %v versus %v; settings %s\n%s", name, got, base, config, source)
			}
		}
	}
	g.FinishInput(t, key)
}

func samePositions(a, b []occurrence) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].pos != b[i].pos || a[i].length != b[i].length {
			return false
		}
	}
	return true
}
