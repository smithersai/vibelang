package vibelangfuzz

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The rule targets check Chapter 28's registry by fault injection
// (Hephaestus, Chaliasos et al., PLDI 2022; Thalia, 2023): from a host that
// compiles cleanly, inject one violation of one rule and require exactly the
// diagnostic the specification assigns it, at the injected text, in the
// code's category, and no other error; inject a form the specification
// allows and require no diagnostic at all.

const (
	rulesTarget   = "FuzzSpecRules"
	allowedTarget = "FuzzSpecAllowed"
)

// A ruleSetting changes a code's category for one compilation, by the
// tsconfig.json setting (D34, D275) or by a comment (D241).
type ruleSetting struct {
	Kind  string // "", "vibelang", "compilerOptions", "comment", "next-line", "wildcard", "wildcard-named"
	Level string // "error", "warning", or "off"
	Other string // the wildcard's level, for "wildcard-named"
}

var settingKinds = []string{"", "", "", "vibelang", "compilerOptions", "comment", "next-line", "wildcard", "wildcard-named"}
var settingLevels = []string{CategoryError, CategoryWarning, CategoryOff}
var suffixes = []string{"Fz", "Q1", "_x", "Zz9", "Dup"}

// A ruleChoice is where and how an injection goes into a host.
type ruleChoice struct {
	Host          *ruleHost
	Slot          string
	Suffix        string
	Nest          []int
	Before, After []int
	Setting       ruleSetting
}

func (c ruleChoice) String() string {
	return fmt.Sprintf("host=%s slot=%s suffix=%s nest=%v before=%v after=%v setting=%+v", c.Host.Name, c.Slot, c.Suffix, c.Nest, c.Before, c.After, c.Setting)
}

// choiceReader turns fuzz bytes into choices; past the end every choice is
// the first.
type choiceReader struct{ data []byte }

func (r *choiceReader) int(n int) int {
	if n <= 0 {
		return 0
	}
	if len(r.data) == 0 {
		return 0
	}
	b := int(r.data[0])
	r.data = r.data[1:]
	return b % n
}

// splitRuleInput splits an input into an item name, a host name, and choice
// bytes: "name\x00host\x00bytes". An input without two NULs is all choices.
func splitRuleInput(data []byte) (string, string, []byte) {
	parts := bytes.SplitN(data, []byte{0}, 3)
	if len(parts) == 3 {
		return string(parts[0]), string(parts[1]), parts[2]
	}
	return "", "", data
}

func ruleInput(name, host string, choices ...byte) []byte {
	return append([]byte(name+"\x00"+host+"\x00"), choices...)
}

// pick returns the index of name among names, a hash of a name that is
// none of them, or the next two choice bytes when name is empty.
func pick(name string, names []string, r *choiceReader) int {
	if i := slices.Index(names, name); i >= 0 {
		return i
	}
	if name != "" {
		h := fnv.New32a()
		h.Write([]byte(name))
		return int(h.Sum32() % uint32(len(names)))
	}
	return (r.int(256)*256 + r.int(256)) % len(names)
}

// decodeChoice chooses a host that offers one of slots, and the variation.
func decodeChoice(hostName string, slots []string, dom bool, r *choiceReader) ruleChoice {
	hosts := allRuleHosts()
	names := make([]string, len(hosts))
	for i, h := range hosts {
		names[i] = h.Name
	}
	host := hosts[pick(hostName, names, r)]
	offered := func(h *ruleHost) []string {
		if dom && !h.DOM {
			return nil
		}
		return slices.DeleteFunc(slices.Clone(h.slots()), func(s string) bool { return !slices.Contains(slots, s) })
	}
	usable := offered(host)
	if len(usable) == 0 {
		// The host offers none of the slots: use the first template that
		// offers the slot the next byte chooses.
		want := slots[r.int(len(slots))]
		for _, h := range templateHosts {
			if slices.Contains(offered(h), want) {
				host, usable = h, []string{want}
				break
			}
		}
	}
	// Every count is read whether or not the slot uses it, so a byte
	// stands for the same choice in every slot.
	c := ruleChoice{Host: host, Slot: usable[r.int(len(usable))], Suffix: suffixes[r.int(len(suffixes))]}
	for range r.int(3) {
		if nesting := r.int(len(nestings)); slices.Contains(statementSlots, c.Slot) {
			c.Nest = append(c.Nest, nesting)
		}
	}
	for _, list := range []*[]int{&c.Before, &c.After} {
		for range r.int(3) {
			if i := r.int(len(benign[c.Slot])); len(benign[c.Slot]) > 0 {
				*list = append(*list, i)
			}
		}
	}
	c.Setting.Kind = settingKinds[r.int(len(settingKinds))]
	c.Setting.Level = settingLevels[r.int(len(settingLevels))]
	c.Setting.Other = settingLevels[r.int(len(settingLevels))]
	return c
}

// A rendered program and where its injected text stands.
type rendered struct {
	Project        Project
	SpanFile       string
	SpanStart, End int
	Text           string // the injected text without markers, for messages
}

const (
	spanOpen  = "⟦"
	spanClose = "⟧"
)

// render writes an injection into a host. With include false it writes the
// host alone, with the same nesting, benign statements and settings, which is
// the program the oracle compares against.
func render(c ruleChoice, code int32, decls, text string, files map[string]string, include bool) rendered {
	sub := func(s string) string { return strings.ReplaceAll(s, "$$", c.Suffix) }
	if !include {
		decls, text, files = "", "", nil
	} else if !strings.Contains(text, spanOpen) {
		text = spanOpen + text + spanClose
	}
	decls, text = sub(decls), sub(text)
	indent := func(lines []string, by string) []string {
		var out []string
		for _, line := range lines {
			for l := range strings.SplitSeq(line, "\n") {
				out = append(out, by+l)
			}
		}
		return out
	}
	// Each benign statement's names get the occurrence's number too, so a
	// statement chosen twice declares two sets of names.
	occurrence := 0
	benignText := func(i int) string {
		occurrence++
		return strings.ReplaceAll(benign[c.Slot][i], "$$", c.Suffix+"B"+strconv.Itoa(occurrence))
	}
	var body []string
	for _, i := range c.Before {
		body = append(body, benignText(i))
	}
	var opens, closes []string
	for depth, i := range c.Nest {
		pad := strings.Repeat("  ", depth)
		opens = append(opens, pad+sub(nestings[i][0]))
		closes = append([]string{pad + nestings[i][1]}, closes...)
	}
	body = append(body, opens...)
	inner := []string{}
	single := !strings.Contains(strings.TrimSpace(text), "\n")
	if c.Setting.Kind == "next-line" && single {
		inner = append(inner, fmt.Sprintf("// @vibelang-diagnostics-next-line %s:%s", specCodeName(code), c.Setting.Level))
	}
	if text != "" {
		inner = append(inner, text)
	}
	body = append(body, indent(inner, strings.Repeat("  ", len(c.Nest)))...)
	body = append(body, closes...)
	for _, i := range c.After {
		body = append(body, benignText(i))
	}
	insertion := strings.Join(body, "\n")

	project := Project{Files: map[string]string{}}
	for name, content := range c.Host.Files {
		project.Files[name] = content
	}
	target := ""
	switch c.Slot {
	case slotFile:
		target = sub("inj$$.vibe")
		project.Files[target] = "⟪file⟫\n"
	default:
		for name, content := range project.Files {
			if strings.Contains(content, "⟪"+c.Slot+"⟫") {
				target = name
			}
		}
	}
	switch c.Slot {
	case slotTop, slotNoEffect:
		project.Files[target] = strings.Replace(project.Files[target], "⟪"+c.Slot+"⟫", decls+"\n"+insertion, 1)
	case slotFile, slotTS:
		project.Files[target] = strings.Replace(project.Files[target], "⟪"+c.Slot+"⟫", decls+"\n"+insertion, 1)
	default:
		project.Files[target] = strings.Replace(project.Files[target], "⟪"+c.Slot+"⟫", insertion, 1)
		project.Files[c.Host.Main] = strings.Replace(project.Files[c.Host.Main], "⟪top⟫", decls, 1)
	}
	for name, content := range project.Files {
		for _, slot := range []string{slotTop, slotEffect, slotPlain, slotMember, slotHatch, slotAsyncHatch, slotModule, slotTS, slotFile, slotNoEffect} {
			content = strings.ReplaceAll(content, "⟪"+slot+"⟫", "")
		}
		project.Files[name] = content
	}
	for name, content := range files {
		project.Files[sub(name)] = sub(content)
	}
	// A comment setting stands at the top of the file the injection goes in.
	if comment := settingComment(c.Setting, code); comment != "" && !(c.Setting.Kind == "next-line" && single) {
		project.Files[target] = comment + "\n" + project.Files[target]
	}
	r := rendered{Project: project}
	for name, content := range project.Files {
		start := strings.Index(content, spanOpen)
		if start < 0 {
			continue
		}
		end := strings.Index(content, spanClose)
		r.SpanFile, r.SpanStart, r.End = name, start, end-len(spanOpen)
		project.Files[name] = strings.Replace(strings.Replace(content, spanOpen, "", 1), spanClose, "", 1)
		r.Text = project.Files[name][r.SpanStart:r.End]
	}
	project.Config = renderConfig(c, project.Files, code)
	r.Project = project
	return r
}

// settingComment is the file-wide comment of a comment setting.
func settingComment(s ruleSetting, code int32) string {
	switch s.Kind {
	case "comment", "next-line":
		return fmt.Sprintf("// @vibelang-diagnostics %s:%s", specCodeName(code), s.Level)
	case "wildcard":
		return "// @vibelang-diagnostics *:" + s.Level
	case "wildcard-named":
		return fmt.Sprintf("// @vibelang-diagnostics *:%s %s:%s", s.Other, specCodeName(code), s.Level)
	case "all":
		return "// @vibelang-diagnostics *:" + s.Level
	}
	return ""
}

// renderConfig writes the project's tsconfig.json: the host's, or
// DefaultConfig listing every source, with a tsconfig setting's diagnostics.
func renderConfig(c ruleChoice, files map[string]string, code int32) string {
	var config map[string]any
	if c.Host.Config != "" {
		if json.Unmarshal([]byte(c.Host.Config), &config) != nil {
			return c.Host.Config
		}
	} else {
		_ = json.Unmarshal([]byte(DefaultConfig), &config)
		var names []string
		for name := range files {
			if isSource(name) {
				names = append(names, name)
			}
		}
		slices.Sort(names)
		config["files"] = names
	}
	setting := map[string]any{"diagnostics": map[string]string{specCodeName(code): c.Setting.Level}}
	switch c.Setting.Kind {
	case "all":
		every := map[string]string{}
		for _, code := range SpecAdjustableCodes() {
			every[specCodeName(code)] = c.Setting.Level
		}
		config["vibelang"] = map[string]any{"diagnostics": every}
	case "vibelang":
		config["vibelang"] = setting
	case "compilerOptions":
		options, _ := config["compilerOptions"].(map[string]any)
		if options == nil {
			options = map[string]any{}
			config["compilerOptions"] = options
		}
		options["vibelang"] = setting
	}
	data, _ := json.MarshalIndent(config, "", "  ")
	return string(data)
}

// expectedCategory is the category the specification gives code under a
// setting: a setting changes only an adjustable code (Chapter 28, D34, D241,
// D275), and within one comment a named code overrides the wildcard.
func expectedCategory(code int32, fallback string, s ruleSetting) string {
	byConfig := SpecAdjustable(code)
	byComment := SpecCommentAdjustable(code)
	switch s.Kind {
	case "vibelang", "compilerOptions":
		if byConfig {
			return s.Level
		}
	case "comment", "next-line", "wildcard", "wildcard-named":
		if byComment {
			return s.Level
		}
	}
	return fallback
}

// normalizeSetting drops a comment setting the specification does not
// define: an adjustable code before EK4801 is set in tsconfig.json only. A
// next-line comment covers one line, so it stands for a file-wide comment
// where the row names no site for the diagnostic.
func normalizeSetting(inj *ruleInjection, s ruleSetting) ruleSetting {
	if strings.Contains(s.Kind, "comment") || strings.HasPrefix(s.Kind, "wildcard") || s.Kind == "next-line" {
		if SpecAdjustable(inj.Code) && !SpecCommentAdjustable(inj.Code) {
			s.Kind = "vibelang"
		}
	}
	if s.Kind == "next-line" && inj.Site == "file" {
		s.Kind = "comment"
	}
	return s
}

func categoryName(c diagnostics.Category) string {
	switch c {
	case diagnostics.CategoryError:
		return CategoryError
	case diagnostics.CategoryWarning:
		return CategoryWarning
	}
	return strings.ToLower(c.Name())
}

func diagnosticKey(d *ast.Diagnostic) string {
	if d.Source() == "EK" {
		return fmt.Sprintf("EK%04d", d.Code())
	}
	return fmt.Sprintf("TS%d", d.Code())
}

func describe(d *ast.Diagnostic) string {
	where := "(global)"
	if d.File() != nil {
		where = fmt.Sprintf("%s@%d-%d", filepath.Base(string(d.File().FileName())), d.Pos(), d.End())
	}
	return fmt.Sprintf("%s %s %s: %s", categoryName(d.Category()), diagnosticKey(d), where, d.String())
}

// ruleCompiler compiles programs in one workspace and keeps the diagnostics
// of each host program it has seen, which many injections share.
type ruleCompiler struct {
	w     *Workspace
	mu    sync.Mutex
	bases map[string][]*ast.Diagnostic
}

func newRuleCompiler(tb testing.TB) *ruleCompiler {
	return &ruleCompiler{w: NewWorkspace(tb), bases: map[string][]*ast.Diagnostic{}}
}

func (rc *ruleCompiler) compile(t testing.TB, p Project, cache bool) []*ast.Diagnostic {
	t.Helper()
	key := ""
	if cache {
		key = p.Config + "\x00" + Archive(p.Files)
		rc.mu.Lock()
		diags, ok := rc.bases[key]
		rc.mu.Unlock()
		if ok {
			return diags
		}
	}
	var result *Result
	var err error
	Within("compile", func() { result, err = rc.w.Compile(context.Background(), p) })
	if err != nil {
		t.Fatal(err)
	}
	result.Remove()
	if cache {
		rc.mu.Lock()
		rc.bases[key] = result.Diagnostics
		rc.mu.Unlock()
	}
	return result.Diagnostics
}

// recoverCrash turns a compiler panic into a gap for the input's corpus file:
// a crash is always a bug (the brief's rule 3), recorded with its stack.
func recoverCrash(t *testing.T, target string) {
	if r := recover(); r != nil {
		stack := debug.Stack()
		Gap(t, target, "crash:"+toolsPanicFrame(stack), "compiler panic: %v\n%s", r, stack)
	}
}

// gapKey returns the pending key of an injection's gap: the code's own when
// the pending file lists it, so that a code the compiler does not check yet
// needs one line, else the injection's.
func gapKey(target string, inj *ruleInjection) string {
	if _, ok := Pending(target, "ek:"+specCodeName(inj.Code)); ok {
		return "ek:" + specCodeName(inj.Code)
	}
	return inj.Key()
}

func inFile(d *ast.Diagnostic, name string) bool {
	return d.File() != nil && strings.HasSuffix(filepath.ToSlash(string(d.File().FileName())), "/"+name)
}

// checkRule is the oracle of FuzzSpecRules (Chapter 28): the injected program
// reports the injection's code exactly once, inside its text, in the
// category the specification gives it under the setting, and no error the
// host alone does not report. A code whose category is "off" reports nothing.
func checkRule(t *testing.T, rc *ruleCompiler, inj *ruleInjection, c ruleChoice) {
	t.Helper()
	c.Setting = normalizeSetting(inj, c.Setting)
	fallback := SpecDefaultCategory(inj.Code)
	if inj.Category != "" {
		fallback = inj.Category
	}
	want := expectedCategory(inj.Code, fallback, c.Setting)
	base := render(c, inj.Code, inj.Decls, inj.Text, inj.Files, false)
	injected := render(c, inj.Code, inj.Decls, inj.Text, inj.Files, true)
	baseDiags := rc.compile(t, base.Project, true)
	diags := rc.compile(t, injected.Project, false)
	report := func() string {
		var b strings.Builder
		fmt.Fprintf(&b, "injection %s in %s\nexpected %s %s at %s@%d-%d %q\n", inj.Key(), c, want, specCodeName(inj.Code), injected.SpanFile, injected.SpanStart, injected.End, injected.Text)
		for _, d := range diags {
			fmt.Fprintf(&b, "  %s\n", describe(d))
		}
		fmt.Fprintf(&b, "--- program\n%s", Archive(injected.Project.Files))
		return b.String()
	}
	code := specCodeName(inj.Code)
	count := func(ds []*ast.Diagnostic, key string, category string) int {
		n := 0
		for _, d := range ds {
			if inj.Site == "file" && key == code && !inFile(d, injected.SpanFile) {
				continue // a row with no site says nothing of the other files
			}
			if diagnosticKey(d) == key && (category == "" || categoryName(d.Category()) == category) {
				n++
			}
		}
		return n
	}
	var inSpan []*ast.Diagnostic
	for _, d := range diags {
		if diagnosticKey(d) == code && inFile(d, injected.SpanFile) && (inj.Site == "file" || d.Pos() >= injected.SpanStart && d.End() <= injected.End) {
			inSpan = append(inSpan, d)
		}
	}
	key := gapKey(rulesTarget, inj)
	switch {
	case want == CategoryOff && len(inSpan) > 0:
		Gap(t, rulesTarget, key, "%s is off under the setting (Chapter 28, D241) but was reported\n%s", code, report())
	case want == CategoryOff && count(diags, code, "") > count(baseDiags, code, ""):
		Gap(t, rulesTarget, key, "%s is off under the setting (Chapter 28, D241) but was reported elsewhere\n%s", code, report())
	case want != CategoryOff && len(inSpan) == 0 && count(diags, code, "") > count(baseDiags, code, ""):
		Gap(t, rulesTarget, key, "%s was reported outside the injected text (Chapter 28)\n%s", code, report())
	case want != CategoryOff && len(inSpan) == 0:
		Gap(t, rulesTarget, key, "%s was not reported (Chapter 28: %q)\n%s", code, inj.Quote, report())
	case want != CategoryOff && count(diags, code, "")-count(baseDiags, code, "") > max(inj.MaxReports, 1):
		Gap(t, rulesTarget, key, "%s was reported %d times for one violation\n%s", code, count(diags, code, "")-count(baseDiags, code, ""), report())
	case want != CategoryOff && categoryName(inSpan[0].Category()) != want:
		Gap(t, rulesTarget, key, "%s is %s by Chapter 28 under %+v but was reported as %s\n%s", code, want, c.Setting, categoryName(inSpan[0].Category()), report())
	}
	// No other error: the violation of one rule draws that rule's diagnostic
	// alone (Chapter 28: an error marks code with no meaning; the codes that
	// replace a TypeScript error, such as EK2127 and EK4813, cover it).
	// A wildcard turns every adjustable code on, and those lint rules may
	// hold of the injected text too, as EK4816 holds of any provide outside
	// main; only the injection's own code is the oracle's then.
	wildcard := strings.HasPrefix(c.Setting.Kind, "wildcard") || c.Setting.Kind == "all"
	seen := map[string]bool{}
	for _, d := range diags {
		k := diagnosticKey(d)
		if k == code || d.Category() != diagnostics.CategoryError || seen[k] {
			continue
		}
		if wildcard && d.Source() == "EK" && SpecAdjustable(d.Code()) {
			continue
		}
		seen[k] = true
		if count(diags, k, CategoryError) > count(baseDiags, k, CategoryError) {
			Gap(t, rulesTarget, key, "injecting %s also reports error %s\n%s", code, k, report())
		}
	}
}

// checkAllowed is the oracle of FuzzSpecAllowed: an allowed form adds no
// diagnostic of any category to its host.
func checkAllowed(t *testing.T, rc *ruleCompiler, name, key string, decls, text string, files map[string]string, c ruleChoice, onlyEK bool, why string) {
	t.Helper()
	base := render(c, 0, decls, text, files, false)
	injected := render(c, 0, decls, text, files, true)
	baseDiags := rc.compile(t, base.Project, true)
	diags := rc.compile(t, injected.Project, false)
	counts := map[string]int{}
	for _, d := range baseDiags {
		counts[categoryName(d.Category())+" "+diagnosticKey(d)]++
	}
	for _, d := range diags {
		k := categoryName(d.Category()) + " " + diagnosticKey(d)
		if counts[k] > 0 {
			counts[k]--
			continue
		}
		if d.Category() != diagnostics.CategoryError && d.Category() != diagnostics.CategoryWarning {
			continue
		}
		if onlyEK && (d.Source() != "EK" || d.File() == nil || strings.HasSuffix(string(d.File().FileName()), ".vibe")) {
			continue // D266 speaks of EK diagnostics in TypeScript files
		}
		var b strings.Builder
		for _, d := range diags {
			fmt.Fprintf(&b, "  %s\n", describe(d))
		}
		Gap(t, allowedTarget, key, "%s (%s) adds %s in %s\n%s--- program\n%s", name, why, describe(d), c, b.String(), Archive(injected.Project.Files))
	}
}

// traceInput appends a line per input, with its time, to the file
// $VIBELANG_FUZZ_RULES_TRACE-<pid> when that is set: the fuzzer's own count
// leaves out the inputs its workers run while they minimize, so a campaign
// counts its inputs and sees which injections it chose from these files.
func traceInput(name string, c ruleChoice) func() {
	trace := os.Getenv("VIBELANG_FUZZ_RULES_TRACE")
	if trace == "" {
		return func() {}
	}
	start := time.Now()
	return func() {
		fh, err := os.OpenFile(fmt.Sprintf("%s-%d", trace, os.Getpid()), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			return
		}
		fmt.Fprintf(fh, "%s %s %v\n", name, c.Host.Name, time.Since(start).Round(time.Millisecond))
		fh.Close()
	}
}

// pickInjection decodes an input of FuzzSpecRules.
func pickInjection(data []byte) (*ruleInjection, ruleChoice) {
	name, host, rest := splitRuleInput(data)
	r := &choiceReader{data: rest}
	names := make([]string, len(ruleInjections))
	for i, inj := range ruleInjections {
		names[i] = inj.Key()
	}
	inj := ruleInjections[pick(name, names, r)]
	return inj, decodeChoice(host, inj.Slots, inj.DOM, r)
}

// FuzzSpecRules injects one violation of one of Chapter 28's rules into a
// host and requires the diagnostic the specification assigns (checkRule).
// Its input is "<injection key>\x00<host>\x00<choices>"; the choices pick
// the slot, the names' suffix, the nesting, the benign statements around the
// injection, and a category setting.
func FuzzSpecRules(f *testing.F) {
	startShortBudget(f)
	SkipRetired(f, rulesTarget)
	// Every injection runs at least once, -short or not: the smoke run's
	// seeds are the gate that each registered rule is checked.
	for _, inj := range ruleInjections {
		f.Add(ruleInput(inj.Key(), "template:minimal"))
		if SpecDefaultCategory(inj.Code) == CategoryOff {
			// Turn an off code on as an error with the tsconfig setting:
			// slot, suffix, no nesting, no benign statements, then kind 3
			// ("vibelang") and level 0 ("error").
			f.Add(ruleInput(inj.Key(), "template:services", 0, 0, 0, 0, 0, 3, 0))
		}
	}
	rc := newRuleCompiler(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		defer recoverCrash(t, rulesTarget)
		inj, c := pickInjection(data)
		defer traceInput(inj.Key(), c)()
		checkRule(t, rc, inj, c)
		ExpectPending(t, rulesTarget, "corpus:"+filepath.Base(t.Name()))
	})
}

// An allowed item of FuzzSpecAllowed: an allowed form, or a violating
// injection placed where the specification allows it.
type allowedItem struct {
	Name, Key, Why string
	Slots          []string
	Decls, Text    string
	Files          map[string]string
	DOM, OnlyEK    bool
}

var allowedItems = sync.OnceValue(func() []allowedItem {
	var items []allowedItem
	for _, a := range allowedForms {
		items = append(items, allowedItem{Name: a.Name, Key: "allowed:" + a.Name, Why: fmt.Sprintf("%s: %q", a.Chapter, a.Quote), Slots: a.Slots, Decls: a.Decls, Text: a.Text, Files: a.Files, DOM: a.DOM})
	}
	// D266: a .ts file draws no EK diagnostic, whatever it holds and whatever
	// the settings say; TypeScript's own diagnostics stay.
	for _, inj := range ruleInjections {
		text := strings.NewReplacer(spanOpen, "", spanClose, "").Replace(inj.Text)
		items = append(items, allowedItem{Name: "ts:" + inj.Key(), Key: "ts:" + inj.Key(), Why: "D266: EK diagnostics belong to .vibe files", Slots: []string{slotTS}, Decls: inj.Decls, Text: text, Files: inj.Files, OnlyEK: true})
	}
	return items
})

// FuzzSpecAllowed injects a form the specification allows and requires that
// it add no diagnostic (checkAllowed): the allowed forms of Chapters 7, 10, 11
// and 28, and every violating injection's text in a .ts file (D266), where
// only TypeScript's diagnostics may appear. Its input has FuzzSpecRules'
// shape, naming an allowed item.
func FuzzSpecAllowed(f *testing.F) {
	startShortBudget(f)
	SkipRetired(f, allowedTarget)
	for _, item := range allowedItems() {
		f.Add(ruleInput(item.Name, "template:minimal"))
	}
	rc := newRuleCompiler(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		defer recoverCrash(t, allowedTarget)
		item, c := pickAllowed(data)
		defer traceInput(item.Name, c)()
		checkAllowed(t, rc, item.Name, item.Key, item.Decls, item.Text, item.Files, c, item.OnlyEK, item.Why)
		ExpectPending(t, allowedTarget, "corpus:"+filepath.Base(t.Name()))
	})
}

func pickAllowed(data []byte) (allowedItem, ruleChoice) {
	name, host, rest := splitRuleInput(data)
	r := &choiceReader{data: rest}
	items := allowedItems()
	names := make([]string, len(items))
	for i, item := range items {
		names[i] = item.Name
	}
	item := items[pick(name, names, r)]
	c := decodeChoice(host, item.Slots, item.DOM, r)
	if item.OnlyEK {
		// The settings of D266's dual turn every adjustable code on, as an
		// error, in tsconfig.json and in a comment of the .ts file.
		c.Setting = ruleSetting{Kind: "all", Level: CategoryError}
	} else {
		c.Setting = ruleSetting{}
	}
	return item, c
}
