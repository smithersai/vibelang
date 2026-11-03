// VIP-26: namespace wrappers are synchronous; async scopes and module await stay native.
namespace N {
  export async function load(): Promise<number> { return await Promise.resolve(42) }
  export const arrow = async (): Promise<number> => await Promise.resolve(7)
}
export const answer = [await N.load(), await N.arrow(), await Promise.resolve(1)]
