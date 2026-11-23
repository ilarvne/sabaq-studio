import { Select, SelectGroup, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/coss/select';
import { cn } from '@/lib/utils';

export function OptionSelect<Value extends string>({ label, value, options, onChange, className, disabled, size='default' }: {
  label:string; value:Value; options:{value:Value;label:string}[]; onChange:(value:Value)=>void; className?:string; disabled?:boolean; size?:'sm'|'default'|'lg';
}) {
  return <Select items={options} value={value} disabled={disabled} onValueChange={next=>{if(next!==null)onChange(next);}}>
    <SelectTrigger aria-label={label} size={size} className={cn('w-fit min-w-0 max-w-full',className)}><SelectValue/></SelectTrigger>
    <SelectPopup alignItemWithTrigger={false}>
      <SelectGroup>{options.map(option=><SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup>
    </SelectPopup>
  </Select>;
}
