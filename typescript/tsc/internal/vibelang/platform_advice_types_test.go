package vibelang

import (
	"regexp"
)

// adviceTypingPending names the advice examples whose repair is in the merge
// queue but not landed. A row here must still fail; drop its line once the
// repair lands, or the test reports it as passing unexpectedly.
var adviceTypingPending = map[string]string{}

// adviceFreeNames are the placeholders the examples use for a caller's values.
var adviceFreeNames = []string{
	"a", "app", "args", "atime", "b", "blob", "bytes", "ciphertext", "command", "data", "directory", "element",
	"body", "headers", "request", "response", "signal", "startNanos",
	"fiber", "from", "gid", "items", "key", "killSignal", "max", "message", "min", "mode", "mtime", "name",
	"nonce", "onResize", "options", "parts", "path", "pattern", "pid", "plaintext", "port", "privateKey",
	"program", "publicKey", "query", "rows", "signature", "size", "spawn", "target", "text", "to", "uid", "url",
	"value", "values",
}

var (
	adviceReceiver = regexp.MustCompile(`(?:^|[^.\w"/])([A-Z]\w*)\.`)
	adviceTry      = regexp.MustCompile(`(^|[^.\w])try\s+`)
	adviceGlobal   = regexp.MustCompile(`(^|[^.\w])([a-z]\w*)\(`)
	adviceImport   = regexp.MustCompile(`import \{ ([^}]*) \} from ("[^"]+")|import \* as (\w+) from ("[^"]+")`)
)
