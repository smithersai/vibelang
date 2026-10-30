package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
)

// normalizeSpace collapses runs of white space, so a quote matches a row
// whatever its line breaks.
func normalizeSpace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// TestSpecRuleFacts checks the shared current registry facts even though
// the historical injection targets remain retired.
func TestSpecRuleFacts(t *testing.T) { TestSpecFacts(t) }

func names(codes []int32) []string {
	var out []string
	for _, code := range codes {
		out = append(out, specCodeName(code))
	}
	return out
}

// TestSpecRuleTable checks the injection table against the specification:
// each injection names a registry code and quotes the clause of its row
// that it violates, and each allowed form quotes the text that allows it.
func TestSpecRuleTable(t *testing.T) {
	seen := map[string]bool{}
	allSlots := []string{slotTop, slotEffect, slotPlain, slotMember, slotHatch, slotAsyncHatch, slotModule, slotTS, slotFile, slotNoEffect}
	for _, inj := range ruleInjections {
		if seen[inj.Key()] {
			t.Errorf("%s: two injections share the key", inj.Key())
		}
		seen[inj.Key()] = true
		row, ok := SpecRows()[inj.Code]
		if _, imported := Facts().Imported[inj.Code]; !ok && !imported {
			t.Errorf("%s: the current registry has no row for the code", inj.Key())
			continue
		}
		if !strings.Contains(normalizeSpace(currentSpecText(inj.Chapter)), normalizeSpace(inj.Quote)) {
			t.Errorf("%s: the registry row no longer says %q; review the injection against the row:\n%s", inj.Key(), inj.Quote, row.Reports)
		}
		if SpecRetired(inj.Code) {
			t.Errorf("%s: the specification retires the code", inj.Key())
		}
		if inj.Category != "" && !strings.Contains(inj.Quote, inj.Category) {
			t.Errorf("%s: a category other than the default must come from the quoted clause", inj.Key())
		}
		for _, slot := range inj.Slots {
			if !slices.Contains(allSlots, slot) {
				t.Errorf("%s: unknown slot %q", inj.Key(), slot)
			}
		}
		if strings.Count(inj.Text, spanOpen) > 1 || strings.Count(inj.Text, spanOpen) != strings.Count(inj.Text, spanClose) {
			t.Errorf("%s: mark at most one span", inj.Key())
		}
	}
	for _, a := range allowedForms {
		if !strings.Contains(normalizeSpace(currentSpecText(a.Chapter)), normalizeSpace(a.Quote)) {
			t.Errorf("allowed %s: %s no longer says %q", a.Name, a.Chapter, a.Quote)
		}
	}
}

// TestSpecRuleCoverage is retained for the retired injection target: each
// current registry code would need an injection, is pending in
// testdata/pending/rules.txt as "ek:EKnnnn", or is one the specification
// keeps unused. It fails when the specification adds a code that nothing
// here checks.
func TestSpecRuleCoverage(t *testing.T) {
	SkipRetired(t, rulesTarget)
	injected := map[int32][]*ruleInjection{}
	for _, inj := range ruleInjections {
		injected[inj.Code] = append(injected[inj.Code], inj)
	}
	var passing, partial, pending, retired []string
	for _, code := range append(slices.Clone(SpecCodes()), SpecListedCodes()...) {
		name := specCodeName(code)
		_, whole := Pending(rulesTarget, "ek:"+name)
		switch {
		case SpecRetired(code):
			retired = append(retired, name)
		case len(injected[code]) == 0 && !whole:
			t.Errorf("%s: no injection, and testdata/pending/rules.txt does not list ek:%s with a reason", name, name)
		case whole || len(injected[code]) == 0:
			pending = append(pending, name)
		default:
			n := 0
			for _, inj := range injected[code] {
				if _, ok := Pending(rulesTarget, inj.Key()); ok {
					n++
				}
			}
			if n > 0 {
				partial = append(partial, fmt.Sprintf("%s(%d/%d)", name, n, len(injected[code])))
			} else {
				passing = append(passing, name)
			}
		}
	}
	t.Logf("%d codes in the table and %d listed after it: %d injected and passing, %d with some injections pending, %d pending, %d retired or unused", len(SpecCodes()), len(SpecListedCodes()), len(passing), len(partial), len(pending), len(retired))
	t.Logf("partly pending: %v", partial)
	t.Logf("pending: %v", pending)
	t.Logf("retired: %v", retired)
}

// TestSpecRuleHosts checks that every host compiles with no error when no
// injection is in it: a host that does not is a host bug or a gap.
func TestSpecRuleHosts(t *testing.T) {
	SkipRetired(t, rulesTarget)
	rc := newRuleCompiler(t)
	// Every template, and a sample of the case hosts; all of them with
	// VIBELANG_FUZZ_RULES_HOSTS=all, which takes about a minute.
	hosts := append(slices.Clone(templateHosts), sample(caseHosts(), 12)...)
	if os.Getenv("VIBELANG_FUZZ_RULES_HOSTS") == "all" {
		hosts = allRuleHosts()
	}
	for _, host := range hosts {
		t.Run(host.Name, func(t *testing.T) {
			slots := host.slots()
			c := ruleChoice{Host: host, Slot: slots[0], Suffix: suffixes[0]}
			for _, slot := range slots {
				c.Slot = slot
				p := render(c, 0, "", "", nil, false).Project
				for _, d := range rc.compile(t, p, true) {
					if d.Category() == 1 { // error
						t.Errorf("host %s (slot %s) reports %s\n%s", host.Name, slot, describe(d), Archive(p.Files))
					}
				}
			}
		})
	}
}

// sample returns every k-th item, n in all.
func sample[T any](items []T, n int) []T {
	if len(items) <= n {
		return items
	}
	var out []T
	for i := 0; i < len(items); i += len(items) / n {
		out = append(out, items[i])
	}
	return out
}

// TestSpecRules runs every injection in every slot it lists after the
// first, in the first template host that offers the slot, with no
// variation; FuzzSpecRules' seeds run each in its first slot.
func TestSpecRules(t *testing.T) {
	SkipRetired(t, rulesTarget)
	if testing.Short() {
		t.Skip("FuzzSpecRules' seeds run every injection in its first slot")
	}
	rc := newRuleCompiler(t)
	for _, inj := range ruleInjections {
		for _, slot := range inj.Slots[1:] {
			t.Run(inj.Key()+"@"+slot, func(t *testing.T) {
				defer recoverCrash(t, rulesTarget)
				checkRule(t, rc, inj, firstChoice(slot, inj.DOM))
			})
		}
	}
}

// firstChoice is the first template host that offers slot, with no
// variation.
func firstChoice(slot string, dom bool) ruleChoice {
	for _, h := range templateHosts {
		if slices.Contains(h.slots(), slot) && (h.DOM || !dom) {
			return ruleChoice{Host: h, Slot: slot, Suffix: suffixes[0]}
		}
	}
	panic("no template host offers slot " + slot)
}

// TestSpecRuleSettings belongs to the retired injection target: for an
// adjustable code, each setting gives the category it names, and for any
// other code no comment or wildcard changes it.
func TestSpecRuleSettings(t *testing.T) {
	SkipRetired(t, rulesTarget)
	rc := newRuleCompiler(t)
	done := map[int32]bool{}
	for n, inj := range ruleInjections {
		if done[inj.Code] {
			continue
		}
		done[inj.Code] = true
		var settings []ruleSetting
		if SpecAdjustable(inj.Code) {
			// Each kind of setting once per code, the levels rotating from
			// code to code, so that every kind meets every level across the
			// codes, and each code changes to a level other than its default.
			kinds := []string{"vibelang", "compilerOptions"}
			if SpecCommentAdjustable(inj.Code) {
				// Two comment kinds per code, rotating over the four.
				comments := []string{"comment", "next-line", "wildcard", "wildcard-named"}
				kinds = append(kinds, comments[n%4], comments[(n+1)%4])
			}
			for k, kind := range kinds {
				level := settingLevels[(n+k)%len(settingLevels)]
				settings = append(settings, ruleSetting{Kind: kind, Level: level, Other: settingLevels[(n+k+1)%len(settingLevels)]})
			}
		} else {
			// One comment per code that no comment may change, rotating.
			fixed := []ruleSetting{{Kind: "comment", Level: CategoryOff}, {Kind: "wildcard", Level: CategoryOff}, {Kind: "next-line", Level: CategoryWarning}}
			settings = []ruleSetting{fixed[n%len(fixed)]}
		}
		if testing.Short() && len(settings) > 2 {
			settings = settings[:2]
		}
		for _, s := range settings {
			t.Run(fmt.Sprintf("%s@%s:%s", inj.Key(), s.Kind, s.Level), func(t *testing.T) {
				defer recoverCrash(t, rulesTarget)
				c := firstChoice(inj.Slots[0], inj.DOM)
				c.Setting = s
				checkRule(t, rc, inj, c)
			})
		}
	}
}

// TestSpecAllowed runs every allowed form in every slot it lists after the
// first; FuzzSpecAllowed's seeds run each item in its first slot.
func TestSpecAllowed(t *testing.T) {
	SkipRetired(t, allowedTarget)
	if testing.Short() {
		t.Skip("FuzzSpecAllowed's seeds run every item in its first slot")
	}
	rc := newRuleCompiler(t)
	for _, item := range allowedItems() {
		for _, slot := range item.Slots[1:] {
			t.Run(item.Name+"@"+slot, func(t *testing.T) {
				defer recoverCrash(t, allowedTarget)
				c := firstChoice(slot, item.DOM)
				if item.OnlyEK {
					c.Setting = ruleSetting{Kind: "all", Level: CategoryError}
				}
				checkAllowed(t, rc, item.Name, item.Key, item.Decls, item.Text, item.Files, c, item.OnlyEK, item.Why)
			})
		}
	}
}
