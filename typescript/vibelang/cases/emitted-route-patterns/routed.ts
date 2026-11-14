export { value as repeated } from "#vibelang/emitted/repeated/user"
export { value as server } from "#vibelang/emitted/user.server"
export const load = () => import("#vibelang/emitted/repeated/user")
export type Server = typeof import("#vibelang/emitted/user.server")
