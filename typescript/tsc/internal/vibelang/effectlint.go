package vibelang

// Effect's type-aware lint rules (VIP-38) register their checker hooks from
// init, so every program VibeLang checks, in the CLI, the language server and
// tests, reports them when tsconfig.json's @effect/language-service plugin
// enables them.
import _ "github.com/microsoft/TypeScript/tsc/internal/effecttsgo/lint"
