package vipgen

import "testing"

func TestVipgenRegistrationAndErrorPathsWithoutPanic(t *testing.T) {
	t.Parallel()
	if len(registrationErrors) != 0 {
		t.Fatalf("unexpected construct registration errors: %v", registrationErrors)
	}
	if _, err := SeedChecked("definitely-no-such-construct"); err == nil {
		t.Fatal("SeedChecked on unknown key should return error")
	}
	g := &Gen{
		files:   map[string]string{},
		imports: map[string][]string{},
	}
	if err := g.AddFileChecked("../escape.ts", "export const x = 1"); err == nil {
		t.Fatal("AddFileChecked should reject parent-relative path")
	}
	if err := g.AddFileChecked("helper.ts", "export const x = 1", "x"); err != nil {
		t.Fatalf("AddFileChecked valid module failed: %v", err)
	}
	if err := g.AddFileChecked("helper.ts", "export const x = 2", "x"); err == nil {
		t.Fatal("AddFileChecked should reject conflicting duplicate module source")
	}
	if got := escapeTemplateLiteral("a`b\\c${d}"); got != "a\\`b\\\\c\\${d}" {
		t.Fatalf("unexpected escaped template literal: %q", got)
	}
}
