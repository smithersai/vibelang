class Fail { static value = (() => { throw new Error("stop") })() }
export const value=Fail
export {}
