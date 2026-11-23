export type LibraryActivity = { day: string; created: number; edited: number };
export type SlideSource = {id:string;title:string;revision:number;local:boolean;slides:{id:string;title:string}[]};

export function calendarDayFormatter(timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit',
  });
  return (date: Date) => {
    const values = Object.fromEntries(formatter.formatToParts(date).map(({type,value})=>[type,value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
}
