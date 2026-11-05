/** @throws {never} */
export function holes(log:string[]){return(function*(){try{log.push("start");yield undefined;log.push("second");yield 2}finally{log.push("closed")}})()}
