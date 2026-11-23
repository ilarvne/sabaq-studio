import { useState, type ClipboardEvent } from 'react';
import { ChartBarIcon, MinusIcon, PlusIcon, TableIcon } from '@phosphor-icons/react';
import type { Locale, Slide, SlideChanges, Value } from '@sabaq/lesson/types';
import { Button } from '@/components/shadcn/button';
import { Input } from '@/components/coss/input';
import { Textarea } from '@/components/coss/textarea';
import './data-editor.css';

const words = {
  en: {table: 'Table data', chart: 'Chart data', row: 'Row', column: 'Column', category: 'Category', series: 'Series',
    addRow: 'Add row', addColumn: 'Add column', addCategory: 'Add category', addSeries: 'Add series',
    removeRow: 'Remove row', removeColumn: 'Remove column', removeCategory: 'Remove category', removeSeries: 'Remove series',
    alt: 'Chart description', number: 'Enter a finite number.', paste: 'This selection exceeds the grid limits.', long: 'Cells can contain up to 1,000 characters.'},
  ru: {table: 'Данные таблицы', chart: 'Данные диаграммы', row: 'Строка', column: 'Столбец', category: 'Категория', series: 'Ряд',
    addRow: 'Добавить строку', addColumn: 'Добавить столбец', addCategory: 'Добавить категорию', addSeries: 'Добавить ряд',
    removeRow: 'Удалить строку', removeColumn: 'Удалить столбец', removeCategory: 'Удалить категорию', removeSeries: 'Удалить ряд',
    alt: 'Описание диаграммы', number: 'Введите конечное число.', paste: 'Данные не помещаются в сетку.', long: 'В ячейке может быть до 1000 символов.'},
  kk: {table: 'Кесте деректері', chart: 'Диаграмма деректері', row: 'Жол', column: 'Баған', category: 'Санат', series: 'Қатар',
    addRow: 'Жол қосу', addColumn: 'Баған қосу', addCategory: 'Санат қосу', addSeries: 'Қатар қосу',
    removeRow: 'Жолды жою', removeColumn: 'Бағанды жою', removeCategory: 'Санатты жою', removeSeries: 'Қатарды жою',
    alt: 'Диаграмма сипаттамасы', number: 'Ақырлы сан енгізіңіз.', paste: 'Деректер тордың шегінен асады.', long: 'Ұяшықта 1000 таңбаға дейін болуы мүмкін.'},
};

type Props = {
  slide: Slide;
  locale: Locale;
  disabled?: boolean;
  onChange: (changes: SlideChanges) => void;
};
type Grid = Value[][];

const maxRows = 100;
const maxCellLength = 1000;

function readCell(text: string, existing: Value): Value | undefined {
  if (typeof existing === 'string') return text;
  const decimal = text.trim().replace(',', '.');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(decimal)) return;
  const value = Number(decimal);
  return Number.isFinite(value) ? value : undefined;
}

function GridInput({value, label, disabled, invalidMessage, change, paste}: {
  value: Value; label: string; disabled: boolean; invalidMessage: string;
  change: (value: Value) => void; paste: (event: ClipboardEvent<HTMLInputElement>) => void;
}) {
  const [draft, setDraft] = useState<string>();
  const numeric = typeof value === 'number';
  const invalid = draft !== undefined && readCell(draft, value) === undefined;
  return <Input nativeInput unstyled size="sm" aria-label={label} value={draft ?? value}
    aria-invalid={invalid || undefined} aria-description={invalid ? invalidMessage : undefined} title={invalid ? invalidMessage : label}
    inputMode={numeric ? 'decimal' : 'text'} disabled={disabled} maxLength={maxCellLength}
    onPaste={event => { paste(event); if (event.defaultPrevented) setDraft(undefined); }}
    onBlur={() => setDraft(undefined)} onChange={event => {
      const text = event.currentTarget.value;
      const next = readCell(text, value);
      if (numeric) setDraft(text);
      if (next !== undefined && next !== value) change(next);
    }}/>;
}

function DataGrid({kind, locale, cells, disabled = false, onChange}: {
  kind: 'table' | 'chart'; locale: Locale; cells: Grid; disabled?: boolean; onChange: (next: Grid) => void;
}) {
  const t = words[locale];
  const chart = kind === 'chart';
  const maxColumns = chart ? 13 : 30; // The first chart column holds its category labels.
  const width = cells[0].length;
  const height = cells.length - 1;
  const [pasteError, setPasteError] = useState('');
  const rowLabel = chart ? t.category : t.row;
  const columnLabel = chart ? t.series : t.column;
  const removeRow = chart ? t.removeCategory : t.removeRow;
  const removeColumn = chart ? t.removeSeries : t.removeColumn;

  function initialValue(row: number, column: number): Value {
    if (row === 0) return columnLabel + ' ' + (chart ? column : column + 1);
    if (chart) return column === 0 ? rowLabel + ' ' + row : 0;
    return '';
  }

  function resize(rows: number, columns: number): Grid {
    return Array.from({length: rows + 1}, (_, row) =>
      Array.from({length: columns}, (_, column) => cells[row]?.[column] ?? initialValue(row, column)));
  }

  function paste(event: ClipboardEvent<HTMLInputElement>, row: number, column: number) {
    const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (!text.includes('\t') && !text.includes('\n')) return;
    event.preventDefault();
    const incoming = text.replace(/\n$/, '').split('\n').map(line => line.split('\t'));
    const rows = Math.max(height, row + incoming.length - 1);
    const columns = incoming.reduce((size, line) => Math.max(size, column + line.length), width);
    if (rows > maxRows || columns > maxColumns) { setPasteError(t.paste); return; }

    const next = resize(rows, columns);
    for (const [dy, line] of incoming.entries()) {
      for (const [dx, content] of line.entries()) {
        if (content.length > maxCellLength) { setPasteError(t.long); return; }
        const target = next[row + dy];
        const value = readCell(content, target[column + dx]);
        if (value === undefined) { setPasteError(t.number); return; }
        target[column + dx] = value;
      }
    }
    setPasteError('');
    onChange(next);
  }

  function change(row: number, column: number, value: Value) {
    setPasteError('');
    onChange(cells.map((line, y) => y === row ? line.map((cell, x) => x === column ? value : cell) : line));
  }

  function input(row: number, column: number, label: string) {
    return <GridInput value={cells[row][column]} label={label} disabled={disabled} invalidMessage={t.number}
      change={value => change(row, column, value)} paste={event => paste(event, row, column)}/>;
  }

  return <>
    <div className="slide-data-scroll" tabIndex={0} role="group" aria-label={t[kind]}>
      <table className="slide-data-grid" aria-label={t[kind]}>
        <thead><tr>
          <th scope="col" className="slide-data-corner"><span className="sr-only">{rowLabel}</span></th>
          {cells[0].map((_, column) => {
            if (chart && column === 0) return <th key={column} scope="col" className="slide-data-category">{t.category}</th>;
            const number = chart ? column : column + 1;
            const label = removeColumn + ' ' + number;
            return <th key={column} scope="col"><div className="slide-data-col-head">
              {input(0, column, columnLabel + ' ' + number)}
              <Button type="button" variant="ghost" size="icon-xs" disabled={disabled || width <= (chart ? 2 : 1)}
                aria-label={label} title={label} onClick={() => onChange(cells.map(line => line.filter((_, x) => x !== column)))}>
                <MinusIcon aria-hidden/>
              </Button>
            </div></th>;
          })}
        </tr></thead>
        <tbody>{cells.slice(1).map((line, y) => {
          const row = y + 1;
          return <tr key={row}>
            <th scope="row" className="slide-data-index">
              <span aria-hidden>{row}</span>
              <Button type="button" variant="ghost" size="icon-xs" disabled={disabled || height <= 1}
                aria-label={removeRow + ' ' + row} title={removeRow + ' ' + row}
                onClick={() => onChange(cells.filter((_, index) => index !== row))}><MinusIcon aria-hidden/></Button>
            </th>
            {line.map((_, x) => <td key={x}>{input(row, x, rowLabel + ' ' + row + (chart && x === 0 ? '' :
              ', ' + columnLabel.toLocaleLowerCase(locale) + ' ' + (chart ? x : x + 1)))}</td>)}
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="slide-data-tools">
      <Button size="xs" variant="outline" disabled={disabled || height >= maxRows} onClick={() => onChange(resize(height + 1, width))}>
        <PlusIcon aria-hidden/>{chart ? t.addCategory : t.addRow}
      </Button>
      <Button size="xs" variant="outline" disabled={disabled || width >= maxColumns} onClick={() => onChange(resize(height, width + 1))}>
        <PlusIcon aria-hidden/>{chart ? t.addSeries : t.addColumn}
      </Button>
    </div>
    {pasteError && <p className="slide-data-error" role="alert">{pasteError}</p>}
  </>;
}

export function SlideDataEditor({slide, locale, disabled, onChange}: Props) {
  const {chart, table} = slide;
  const t = words[locale];
  return <>
    {table && <section className="slide-data-editor" data-data-kind="table" aria-label={t.table}>
      <h3 className="inspect-label"><TableIcon aria-hidden/>{t.table}</h3>
      <DataGrid key={slide.id} kind="table" locale={locale} disabled={disabled} cells={[table.headers, ...table.rows]}
        onChange={([headers, ...rows]) => onChange({table: {headers: headers.map(String), rows}})}/>
    </section>}
    {chart && <section className="slide-data-editor" data-data-kind="chart" aria-label={t.chart}>
      <h3 className="inspect-label"><ChartBarIcon aria-hidden/>{t.chart}</h3>
      <DataGrid key={slide.id} kind="chart" locale={locale} disabled={disabled}
        cells={[[t.category, ...chart.series.map(s => s.name)], ...chart.categories.map((category, y) =>
          [category, ...chart.series.map(s => s.values[y])])]} onChange={([headers, ...rows]) => onChange({chart: {
            ...chart, categories: rows.map(row => String(row[0])),
            series: headers.slice(1).map((name, x) => ({name: String(name), values: rows.map(row => Number(row[x + 1]))})),
          }})}/>
      <label className="slide-data-alt">{t.alt}<Textarea rows={2} disabled={disabled} maxLength={maxCellLength} value={chart.alt}
        onChange={event => onChange({chart: {...chart, alt: event.target.value}})}/></label>
    </section>}
  </>;
}
