package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const retiredWithProviderQuote = "The retired `with Provider { … }` spelling is invalid syntax; it has no trailing-block migration."

func TestRetiredWithProviderSyntaxQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), retiredWithProviderQuote) {
		t.Fatalf("chapter 5 no longer says %q", retiredWithProviderQuote)
	}
}

// Use keyed, bounded provider heads to exercise native rejection without
// assigning them the trailing-block callback migration.
func FuzzRetiredWithProviderSyntax(f *testing.F) {
	startShortBudget(f)
	providers := []struct{ key, source string }{
		{"name", "Live"}, {"property", "Layer.empty"}, {"call", "makeLive()"},
		{"nested-property", "Module.Live"}, {"unicode-name", "Lîve"},
		{"array", "[Live]"}, {"tuple", "[Live, Other]"},
		{"conditional", "flag ? Live : Other"}, {"assignment", "Service = value"},
		{"nullish", "Live ?? Other"}, {"nonnull", "Live!"}, {"computed", "Layers[key]"},
	}
	for _, p := range providers {
		f.Add("key:with-provider/" + p.key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data string) {
		if !strings.Contains(SpecText("005-services.md"), retiredWithProviderQuote) {
			t.Fatal("missing syntax rule")
		}
		key, variant, _ := strings.Cut(data, "@")
		pick := byte(0)
		if len(data) > 0 {
			pick = data[len(data)-1]
		}
		item := providers[int(pick)%len(providers)]
		for _, p := range providers {
			if key == "key:with-provider/"+p.key {
				item = p
				break
			}
		}
		if variant != "" {
			pick = variant[0]
		}
		kind, space, ext := "effect function", " ", "vibe"
		if pick&1 != 0 {
			kind = "function"
			space = " /* provider */ "
			ext = "vibex"
		}
		source := "export " + kind + " probe() { with" + space + item.source + " { return 1 } }"
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"jsx":"preserve"},"files":["main.%s"]}`, ext)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main." + ext: source, "package.json": servicesPackage}, Config: config})
		if err != nil {
			Gap(t, "FuzzRetiredWithProviderSyntax", item.key, "compile: %v", err)
			return
		}
		defer r.Remove()
		native := false
		for _, d := range r.Diagnostics {
			if !IsEK(d) && d.Code() == 1005 {
				native = true
			}
			if IsEK(d) && d.Code() == 1101 {
				Gap(t, "FuzzRetiredWithProviderSyntax", item.key, "retired provider received callback migration advice: %s", d.String())
				return
			}
		}
		if !native {
			Gap(t, "FuzzRetiredWithProviderSyntax", item.key, "retired provider lost native syntax rejection: %s", source)
			return
		}
		ExpectPending(t, "FuzzRetiredWithProviderSyntax", item.key)
	})
}
