package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const vibexTrailingContainerTarget = "FuzzVibexTrailingContainer"
const vibexTrailingContainerQuote = "Every JSX production, and its scanning, checking and emit, is exactly " + "`.tsx`'s."

func TestVibexTrailingContainerQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0039-vibex.md"), vibexTrailingContainerQuote) {
		t.Fatalf("VIP-39 no longer says %q", vibexTrailingContainerQuote)
	}
}

func vibexTrailingContainerSource(key string, data []byte) string {
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	heads := []string{"render", "obj.render", "render()", "obj.render(1)", "render(1,)"}
	spaces := []string{" ", "\t", " /* keep */ ", "\n", "\r\n"}
	head := heads[int(pick(0))%len(heads)]
	space := spaces[int(pick(1))%len(spaces)]
	// Bytes mutate the head, trivia, return value and outer JSX nesting.
	expr := fmt.Sprintf("%s%s{return %d}", head, space, pick(2))
	switch key {
	case "attribute":
		expr = "<p value={" + expr + "} />"
	case "spread":
		expr = "<p {..." + expr + "} />"
	case "conditional":
		expr = "<p>{true ? " + expr + " : null}</p>"
	case "argument":
		expr = "<p>{use(" + expr + ")}</p>"
	case "array":
		expr = "<p>{[" + expr + "]}</p>"
	case "fragment":
		expr = "<>{" + expr + "}</>"
	default:
		expr = "<p>{" + expr + "}</p>"
	}
	if pick(3)%2 != 0 {
		expr = "<div>" + expr + "</div>"
	}
	return "const x=" + expr + ";\n"
}

func vibexTrailingContainerDiagnostics(t *testing.T, w *Workspace, source, extension string) []string {
	t.Helper()
	file := "main." + extension
	result, err := w.Compile(t.Context(), Project{
		Files:  map[string]string{file: source},
		Config: fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"ESNext","jsx":"preserve","noEmit":true,"types":[]},"files":[%q]}`, file),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	keys := []string{}
	for _, d := range result.Program.GetSyntacticDiagnostics(t.Context(), nil) {
		prefix := "TS"
		if IsEK(d) {
			prefix = "EK"
		}
		keys = append(keys, fmt.Sprintf("%s%d:%d:%d", prefix, d.Code(), d.Pos(), d.End()))
	}
	slices.Sort(keys)
	return keys
}

func checkVibexTrailingContainer(t *testing.T, w *Workspace, key, source string) {
	t.Helper()
	native := vibexTrailingContainerDiagnostics(t, w, source, "tsx")
	vibe := vibexTrailingContainerDiagnostics(t, w, source, "vibex")
	if !slices.Equal(native, vibe) {
		Gap(t, vibexTrailingContainerTarget, key, "VIP-39: %s; native=%v vibex=%v\n%s", vibexTrailingContainerQuote, native, vibe, source)
	}
}

// The exact census witness and neighbours compare full diagnostic codes/ranges.
// The ordinary TypeScript reading is the oracle, never legacy callback recovery.
func TestVibexTrailingContainerNativeDiagnostics(t *testing.T) {
	TestVibexTrailingContainerQuoted(t)
	w := NewWorkspace(t)
	checkVibexTrailingContainer(t, w, "minimal", "const x=<p>{render {return 1}}</p>")
	for _, key := range []string{"child", "attribute", "spread", "conditional", "argument", "array", "fragment"} {
		t.Run(key, func(t *testing.T) {
			checkVibexTrailingContainer(t, w, key, vibexTrailingContainerSource(key, nil))
		})
	}
	// A real denied block elsewhere must not cause migration diagnostics from
	// a JSX container to leak into that file's combined diagnostics.
	source := "render() {}; const x=<p>{render {return 1}}</p>"
	got := vibexTrailingContainerDiagnostics(t, w, source, "vibex")
	count := 0
	for _, key := range got {
		if strings.HasPrefix(key, "EK1101:") {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("mixed file: want one non-JSX EK1101, got %v", got)
	}
	for _, source := range []string{
		"const x=<p>{() => { render() {} }}</p>",
		"const x=<p>{function () { render() {} }}</p>",
		"const x=<p>{effect { render() {} }}</p>",
		"const x=<p>{do { render() {} }}</p>",
	} {
		got := vibexTrailingContainerDiagnostics(t, w, source, "vibex")
		count := 0
		for _, key := range got {
			if strings.HasPrefix(key, "EK1101:") {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("written block must retain EK1101: %v; %s", got, source)
		}
	}
}

func FuzzVibexTrailingContainer(f *testing.F) {
	startShortBudget(f)
	keys := []string{"child", "attribute", "spread", "conditional", "argument", "array", "fragment"}
	for _, key := range keys {
		f.Add(key, []byte{0, 0, 1, 0})
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		TestVibexTrailingContainerQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		source := vibexTrailingContainerSource(key, data)
		checkVibexTrailingContainer(t, w, key, source)
		ExpectPending(t, vibexTrailingContainerTarget, specCorpusKey(t))
	})
}
