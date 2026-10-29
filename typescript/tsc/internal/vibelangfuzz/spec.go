package vibelangfuzz

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"sync"
)

// The specification is the oracle. These facts are read from
// docs/design/src at test time, never copied into Go, so a specification
// change reaches every target without an edit here. The VIPs replace the old
// chapters, which move to docs/design/history/src: a chapter not yet rewritten
// from the VIPs is read there until its replacement lands.

// specDirs are where a chapter is looked for, the current specification
// first.
var specDirs = []string{"docs/design/src", "docs/design/history/src"}

// SpecPath returns the path of a specification chapter, such as
// "428-part4-ch28-tooling.md": in docs/design/src, or else in
// docs/design/history/src.
func SpecPath(chapter string) string {
	for _, dir := range specDirs {
		path := filepath.Join(Root(), dir, chapter)
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return filepath.Join(Root(), specDirs[0], chapter)
}

// SpecGlob returns the chapters whose names match pattern, each from the
// first directory of specDirs that has it.
func SpecGlob(pattern string) ([]string, error) {
	var paths []string
	seen := map[string]bool{}
	for _, dir := range specDirs {
		matches, err := filepath.Glob(filepath.Join(Root(), dir, pattern))
		if err != nil {
			return nil, err
		}
		for _, path := range matches {
			if name := filepath.Base(path); !seen[name] {
				seen[name] = true
				paths = append(paths, path)
			}
		}
	}
	return paths, nil
}

// SpecText returns a chapter's text. It panics when the chapter is missing:
// a target without its oracle must not pass.
func SpecText(chapter string) string {
	data, err := os.ReadFile(SpecPath(chapter))
	if err != nil {
		panic(err)
	}
	return string(data)
}

// SpecCodes returns every EK code in Chapter 28's registry table, in order.
var SpecCodes = sync.OnceValue(func() []int32 {
	return specCodes(`(?m)^\| EK(\d{4}) \|`)
})

// SpecListedCodes returns the codes Chapter 28 lists after its table, in
// order: "These codes are rules of the language as the table's are", then
// the codes accepted VIPs add before the specification is rewritten from
// them (vipCodes).
var SpecListedCodes = sync.OnceValue(func() []int32 {
	return append(specCodes(`(?m)^- \*\*EK(\d{4})\*\*`), vipCodes...)
})

// vipCodes are the codes the accepted VIPs (docs/design/vips) add, which
// override Chapter 28 until it is rewritten from them: VIP-5's EK4615,
// EK4616, and EK4617. vipRetiredCodes are those they retire: EK4404, with
// the try hatch.
var (
	vipCodes        = []int32{4615, 4616, 4617}
	vipRetiredCodes = []int32{4404}
)

func specCodes(pattern string) []int32 {
	var codes []int32
	for _, m := range regexp.MustCompile(pattern).FindAllStringSubmatch(SpecText("428-part4-ch28-tooling.md"), -1) {
		code, _ := strconv.Atoi(m[1])
		if !slices.Contains(codes, int32(code)) {
			codes = append(codes, int32(code))
		}
	}
	return codes
}

// SpecHasCode reports whether Chapter 28 registers the code, in its table or
// in the list after it.
func SpecHasCode(code int32) bool {
	return slices.Contains(SpecCodes(), code) || slices.Contains(SpecListedCodes(), code)
}
