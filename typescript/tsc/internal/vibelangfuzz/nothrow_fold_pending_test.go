package vibelangfuzz

import (
	"strings"
	"sync"
)

// nothrowFoldPending reports that the introduction's principle 4 still lists
// `throw` among TypeScript's meanings. Main's chapter 3 states Will's no-throw
// rule; lane fold-details folds the rest of nothrow-impl's spec text
// (fold-inputs/nothrow-impl.patch): principle 4, rest positions and `do`
// expressions. Until then a check of that text stays pending; it runs again by
// itself once the text lands, and this file goes then.
var nothrowFoldPending = sync.OnceValue(func() bool {
	return strings.Contains(SpecText("000-intro.md"), "Plain functions, `async` functions, `await`, `throw`, `using`")
})
