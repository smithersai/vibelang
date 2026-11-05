export const marker={defect:true}
export const events:string[]=[]
export const log={info(value:string):number{events.push(value);if(value==="primitive")throw 7;if(value==="object")throw marker;if(value==="error")throw new Error("boom");return value.length}}
