package pseudochecker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// ReturnTypeInferenceHook reports whether a signature's annotation asks for
// body inference. Such an annotation has no reusable TypeScript spelling.
type ReturnTypeInferenceHook func(node *ast.Node) bool

var returnTypeInferenceHooks []ReturnTypeInferenceHook

// RegisterReturnTypeInferenceHook adds a hook during package initialization.
// Registration is not synchronized.
func RegisterReturnTypeInferenceHook(hook ReturnTypeInferenceHook) {
	returnTypeInferenceHooks = append(returnTypeInferenceHooks, hook)
}

func infersReturnType(node *ast.Node) bool {
	for _, hook := range returnTypeInferenceHooks {
		if hook(node) {
			return true
		}
	}
	return false
}
