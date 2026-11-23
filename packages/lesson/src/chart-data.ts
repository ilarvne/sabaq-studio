import type {SlideTable,Value} from './types';

// Convert only explicit decimal data. Leading-zero strings remain identifiers.
export function numericChartValue(value:Value):number|undefined {
  if (typeof value==='number') return Number.isFinite(value) ? value : undefined;
  const text=value.trim();
  if (!/^[+-]?(?:(?:0|[1-9]\d*)(?:[.,]\d+)?|[.,]\d+)$/u.test(text)) return;
  const number=Number(text.replace(',','.'));
  return Number.isFinite(number) ? number : undefined;
}

export function numericTableValues(table:SlideTable|undefined):number[][]|undefined {
  if (!table || table.headers.length<2 || table.headers.length>13 || !table.rows.length) return;
  const values:number[][]=[];
  for (const row of table.rows) {
    if (row.length!==table.headers.length) return;
    const numbers:number[]=[];
    for (const value of row.slice(1)) {
      const number=numericChartValue(value);
      if (number===undefined) return;
      numbers.push(number);
    }
    values.push(numbers);
  }
  return values;
}
