import { ada, type User } from "./User.vibe"

declare module "./User.vibe" {
  interface User {
    nick?: string
  }
}

export const nick = (user: User) => user.nick ?? user.name
export const label = nick(ada)
