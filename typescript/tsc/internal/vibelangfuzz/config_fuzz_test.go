package vibelangfuzz

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzConfig fuzzes a project's VibeLang settings, the `vibelang` object a
// tsconfig holds at its top level, in compilerOptions, or through extends
// (D34, D275), against one main.vibe. Chapter 28's options table is the
// oracle: no setting crashes the compiler; an invalid one is a configuration
// diagnostic; a valid severity gives an adjustable code that category, or
// none for "off"; a code the chapter does not let a setting change, such as
// EK4838, EK4813 or EK9100, is never changed by one; and tracing changes no
// diagnostic (D104).
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
	seen := map[[2]string]bool{}
	add := func(config, source string) {
		if s := [2]string{config, source}; !seen[s] {
			seen[s] = true
			seeds = append(seeds, s)
		}
	}
	mainSource := func(seed Seed) string {
		var names []string
		for name := range seed.Files {
			if strings.HasSuffix(name, ".vibe") && !strings.Contains(name, "/") {
				names = append(names, name)
			}
		}
		slices.Sort(names)
		for _, name := range names {
			if strings.HasPrefix(seed.Files[name], "// expect:") {
				return seed.Files[name]
			}
		}
		if text, ok := seed.Files["main.vibe"]; ok {
			return text
		}
		if len(names) > 0 {
			return seed.Files[names[0]]
		}
		return ""
	}
	facts := Facts()
	bySource := map[int32][]string{}
	for _, seed := range CaseSeeds() {
		source := mainSource(seed)
		if source == "" {
			continue
		}
		var config map[string]any
		if json.Unmarshal([]byte(seed.Files["tsconfig.json"]), &config) == nil {
			settings, ok := config["vibelang"]
			if options, isMap := config["compilerOptions"].(map[string]any); !ok && isMap {
				settings, ok = options["vibelang"]
			}
			if ok {
				data, _ := json.Marshal(settings)
				add(string(data), source)
			}
		}
		for _, code := range codesIn(strings.Join(seed.Codes, " ")) {
			if len(bySource[code]) < 2 {
				bySource[code] = append(bySource[code], source)
			}
		}
	}
	// A returned block-owned fiber is EK4838 (Chapter 7), which no case
	// lists because the compiler does not yet report it as an error.
	bySource[4838] = append(bySource[4838], "export function main() {\n  const f = fork sleep(\"1 second\")\n  return f\n}\n")
	fixed := []int32{4838, 4813, 9100, 9201, 4401, 1009}
	for _, code := range append(slices.Clone(facts.Adjustable), fixed...) {
		for _, source := range bySource[code] {
			for _, severity := range append(slices.Clone(facts.Severities), "info") {
				add(fmt.Sprintf(`{"diagnostics":{"EK%04d":%q}}`, code, severity), source)
			}
		}
		if len(bySource[code]) == 0 {
			add(fmt.Sprintf(`{"diagnostics":{"EK%04d":"off"}}`, code), "export function main() { return 1 }\n")
		}
	}
	snippet := "export function main() {\n  Console.log(\"hello\")\n}\n"
	if snippets := SnippetSeeds(); len(snippets) > 0 {
		snippet = snippets[0].Files["main.vibe"]
	}
	for _, config := range []string{
		`{}`, `{"tracing":"none"}`, `{"tracing":"exported"}`, `{"tracing":"all"}`, `{"tracing":"sometimes"}`, `{"tracing":1}`,
		`{"trustedPackages":["@scope/*"]}`, `{"trustedPackages":"@scope/*"}`, `{"trustedPackages":[1]}`, `{"trustedPackages":[]}`,
		`{"diagnostics":{"*":"off"}}`, `{"diagnostics":[]}`, `{"diagnostics":{"EK9204":null}}`, `{"diagnostics":{"ek2004":"off"}}`,
		`{"unknown":true}`, `{"diagnostics":{"EK4801":"off"},"tracing":"all","trustedPackages":["effect"]}`,
	} {
		add(config, snippet)
	}
	return seeds
})

// A configPlacement is where a project's settings sit (D34, D275).
type configPlacement int

const (
	placeTopLevel configPlacement = iota
	placeCompilerOptions
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
		top = `, "vibelang": ` + settings
	case place == placeCompilerOptions:
		options += `, "vibelang": ` + settings
	case place == placeExtended:
		files["base.json"] = `{"vibelang": ` + settings + `}`
		top = `, "extends": "./base.json"`
	}
	return Project{Files: files, Config: `{"compilerOptions": {` + options + `}, "files": ["main.vibe"]` + top + `}`}
}

// configCodeAdjustable applies accepted VIPs to the frozen options table.
// VIP-26 makes main an ordinary function. Its removed entry warning EK1016
// is an unknown setting, while the table still governs every other code.
func configCodeAdjustable(code int32) bool {
	return code != 1016 && Facts().IsAdjustable(code)
}

// settingProblems returns why settings are invalid by Chapter 28's options
// table and D261, which adds trustedPackages: package-name globs.
func settingProblems(settings map[string]any) []string {
	facts := Facts()
	var problems []string
	for key, value := range settings {
		switch key {
		case "diagnostics":
			codes, ok := value.(map[string]any)
			if !ok {
				problems = append(problems, "diagnostics is not an object")
				continue
			}
			for code, severity := range codes {
				n := codesIn(code)
				if !regexp.MustCompile(`^EK\d{4}$`).MatchString(code) || len(n) != 1 || !configCodeAdjustable(n[0]) {
					problems = append(problems, "diagnostics."+code+" is not adjustable")
				}
				if s, ok := severity.(string); !ok || !slices.Contains(facts.Severities, s) {
					problems = append(problems, fmt.Sprintf("diagnostics.%s is %v", code, severity))
				}
			}
		case "tracing":
			if s, ok := value.(string); !ok || !slices.Contains(facts.Tracing, s) {
				problems = append(problems, fmt.Sprintf("tracing is %v", value))
			}
		case "trustedPackages":
			entries, ok := value.([]any)
			if !ok {
				problems = append(problems, "trustedPackages is not an array")
				continue
			}
			for _, entry := range entries {
				if _, ok := entry.(string); !ok {
					problems = append(problems, fmt.Sprintf("trustedPackages holds %v", entry))
				}
			}
		default:
			problems = append(problems, "unknown setting "+key)
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

// CheckConfig runs FuzzConfig's oracles on one input.
func CheckConfig(t *testing.T, w *Workspace, target, config, source string) {
	if len(config) > 4<<10 || len(source) > 32<<10 {
		t.Skip("too large")
	}
	var settings map[string]any
	if err := json.Unmarshal([]byte(config), &settings); err != nil || settings == nil || duplicateKeys(config) {
		t.Skip("settings that are not one JSON object without repeated keys")
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
	place := configPlacement(seedHash(config, source) % 3)
	ctx := t.Context()
	compile := func(stage string, project Project) *Compilation {
		var c *Compilation
		var err error
		within(t, stage, func() { c, err = w.CompileOrdered(ctx, project, OrderTsc, true) })
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(c.Remove)
		return c
	}
	configured := compile("compile", configProject(source, config, place))
	// This is a metamorphic comparison, not a source of expected categories.
	// Chapter 28 limits diagnostics settings to category changes, and D104
	// limits tracing to spans: removing either must preserve occurrences
	// except for the semantic policy settings handled below. Facts() supplies
	// the categories and adjustable codes independently from the spec text.
	baseline := compile("baseline", configProject(source, "", place))
	where := [...]string{"at the top level", "in compilerOptions", "in an extended config"}[place]

	// The settings are checked as the options table and D261 define them,
	// wherever they sit (D275: "with the same validation").
	problems := settingProblems(settings)
	var configErrors []*ast.Diagnostic
	for _, d := range configured.Diagnostics {
		if isConfigDiagnostic(d) && d.Category() == diagnostics.CategoryError {
			configErrors = append(configErrors, d)
		}
	}
	for _, problem := range problems {
		if len(configErrors) == 0 {
			key := "feature:config-invalid"
			if codes := codesIn(problem); len(codes) == 1 && strings.Contains(problem, "not adjustable") {
				key = fmt.Sprintf("ek:EK%d", codes[0])
			}
			g.Add(key, "Chapter 28: settings %s %s are invalid (%s), and the compiler reports nothing about them", config, where, problem)
		}
	}
	globs := false
	if packages, ok := settings["trustedPackages"].([]any); ok {
		for _, p := range packages {
			if s, ok := p.(string); ok && strings.ContainsAny(s, `[]\`) {
				globs = true // whether a malformed glob is invalid, Chapter 28 does not say
			}
			if s, ok := p.(string); ok {
				if _, err := path.Match(s, ""); err != nil {
					globs = true
				}
			}
		}
	}
	if len(problems) == 0 && len(configErrors) != 0 && !globs {
		key := "feature:config-valid-rejected"
		if text := configErrors[0].MessageText(); strings.Contains(text, "is not adjustable") {
			if codes := codesIn(text); len(codes) == 1 {
				key = fmt.Sprintf("ek:EK%d", codes[0]) // a code Chapter 28 makes adjustable that the compiler does not
			}
		}
		g.Add(key, "Chapter 28: settings %s %s are valid, but: %s", config, where, keyOf(configured.Dir, configErrors[0]))
	}

	facts := Facts()
	set := map[int32]string{}
	if codes, ok := settings["diagnostics"].(map[string]any); ok {
		for code, severity := range codes {
			n := codesIn(code)
			if s, ok := severity.(string); ok && len(n) == 1 && "EK"+fmt.Sprint(n[0]) == code && configCodeAdjustable(n[0]) && slices.Contains(facts.Severities, s) {
				set[n[0]] = s
			}
		}
	}
	// An EK4403 read allowed by a setting compiles as a trusted sync call,
	// an EK4409 call allowed returns the unrun program (Chapter 28), and a
	// trusted package's calls are trusted (D261): those settings may change
	// what else the program reports.
	semantic := set[4403] != "" && set[4403] != "error" || set[4409] != "" && set[4409] != "error"
	if packages, ok := settings["trustedPackages"].([]any); ok && len(packages) > 0 {
		semantic = true
	}
	directives := strings.Contains(source, "@vibelang-diagnostics")

	var codes []int32
	for _, d := range slices.Concat(configured.Diagnostics, baseline.Diagnostics) {
		if IsEK(d) && !slices.Contains(codes, d.Code()) {
			codes = append(codes, d.Code())
		}
	}
	slices.Sort(codes)
	for _, code := range codes {
		name := fmt.Sprintf("EK%04d", code)
		got, base := occurrences(configured.Diagnostics, code), occurrences(baseline.Diagnostics, code)
		severity, isSet := set[code]
		switch {
		case !configCodeAdjustable(code):
			// Chapter 28 and VIP-26: only existing listed codes are adjustable; EK9100 and
			// EK4838 are errors "that no setting lowers", and EK4813 stands in
			// for TypeScript's TS2339.
			if !semantic && !slices.Equal(got, base) {
				g.Add("ek:"+name, "Chapter 28: %s is not adjustable, but settings %s %s change it from %v to %v", name, config, where, base, got)
			}
			// Under a setting that changes what the program means, the code
			// may be reported elsewhere, never in another category.
			for _, o := range got {
				want := facts.Default(code)
				if want == DefaultError && o.category != diagnostics.CategoryError || want == DefaultWarning && o.category != diagnostics.CategoryWarning {
					g.Add("ek:"+name, "Chapter 28: %s is not adjustable, but settings %s %s report it as %s", name, config, where, o.category.Name())
					break
				}
			}
		case directives:
			// A comment changes an adjustable code's category from its line
			// (D241); which of a comment and a setting wins, the chapter does
			// not say.
		case isSet && severity == "off":
			if len(got) != 0 {
				g.Add("ek:"+name, "Chapter 28: settings %s %s turn %s off, but it is reported %d times", config, where, name, len(got))
			}
		case isSet:
			for _, o := range got {
				if o.category.Name() != severity {
					g.Add("ek:"+name, "Chapter 28: settings %s %s make %s %s, but it is reported as %s", config, where, name, severity, o.category.Name())
					break
				}
			}
			if !semantic && facts.Default(code) != DefaultOff && !samePositions(got, base) {
				g.Add("ek:"+name, "Chapter 28: settings %s %s change where %s is reported: %v, without them %v", config, where, name, got, base)
			}
		default:
			if !semantic && !slices.Equal(got, base) {
				g.Add("ek:"+name, "Chapter 28: settings %s %s do not set %s, but change it from %v to %v", config, where, name, base, got)
			}
		}
	}
	// Tracing selects which functions get spans (D104); it changes no
	// contract and so no diagnostic.
	if _, traced := settings["tracing"]; traced && len(set) == 0 && !semantic && len(problems) == 0 {
		var a, b []DiagnosticKey
		for _, d := range configured.Diagnostics {
			if !isConfigDiagnostic(d) {
				a = append(a, keyOf(configured.Dir, d))
			}
		}
		for _, d := range baseline.Diagnostics {
			if !isConfigDiagnostic(d) {
				b = append(b, keyOf(baseline.Dir, d))
			}
		}
		if diff := DiffKeys(SortedKeys(a), SortedKeys(b)); diff != "" {
			g.Add("feature:tracing-diagnostics", "D104: tracing %v %s changes the diagnostics:\n%s", settings["tracing"], where, diff)
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
