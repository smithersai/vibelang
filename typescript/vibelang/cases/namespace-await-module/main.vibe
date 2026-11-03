// VIP-26: namespace wrappers are synchronous; async scopes and module await stay native.
namespace N { export const x = 42 }
export const answer = [await Promise.resolve(N.x)]
