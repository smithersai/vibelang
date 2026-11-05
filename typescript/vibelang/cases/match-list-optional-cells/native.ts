/** @throws {never} */
export function optionalRead(read:()=>unknown){try{const value=read();return ["value",typeof value,String(value)]}catch(error){return ["tdz",error instanceof ReferenceError]}}
