import { values, dates, aliases } from './out/main.js'
console.log(JSON.stringify([
  typeof values[0] === 'number', typeof values[1] === 'number', values[2] === '1',
  dates[0] instanceof Date, typeof dates[1] === 'string',
  aliases.every(value => typeof value === 'number')
]))
