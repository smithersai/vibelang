/** @throws {never} */
export function numbers(log:string[],badClose=false):Generator<number> {
 return (function*(){try{log.push("start");yield 1;yield 2}finally{log.push("closed");if(badClose)throw new Error("close")}})()
}
