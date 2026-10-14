import { createElement, useEffect, useId, useRef, useState, type CSSProperties, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { Check, ChevronDown, FileUp, Minus, Plus } from 'lucide-react';

/** The selected label may shrink without clipping the picker's arrow. */
export function Select({ children, className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`themed-select ${className}`}><button type="button">{createElement('selectedcontent')}</button>{children}</select>;
}

/** Keep the actual file input for the OS chooser, validation and FormData. */
export function FilePicker({ className = '', onChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [names, setNames] = useState<string[]>([]);
  return <span className={`file-picker ${className}`}>
    <input {...props} type="file" onChange={event => {
      setNames(Array.from(event.target.files ?? [], file => file.name));
      onChange?.(event);
    }}/>
    <span className="file-picker-action" aria-hidden="true"><FileUp size={18}/>{names.length ? '重新选择' : '选择文件'}</span>
    <span className="file-picker-name" aria-live="polite">{names.length ? names.join('、') : props.multiple ? '尚未选择，可一次选择多个文件' : '尚未选择文件'}</span>
  </span>;
}

export function NumberInput({ value, onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> & {
  value: number | string; onValueChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const atMin = value !== '' && props.min !== undefined && Number(value) <= Number(props.min);
  const atMax = value !== '' && props.max !== undefined && Number(value) >= Number(props.max);
  const step = (direction: number) => {
    const input = ref.current;
    if (!input) return;
    if (direction > 0) input.stepUp(); else input.stepDown();
    onValueChange(input.value);
    input.focus();
  };
  return <span className="number-input">
    <input {...props} ref={ref} type="number" value={value} onChange={event => onValueChange(event.target.value)}/>
    <span className="number-input-actions">
      <button type="button" aria-label={`减少${props['aria-label'] ?? '数值'}`} disabled={props.disabled || props.readOnly || atMin} onClick={() => step(-1)}><Minus size={14}/></button>
      <button type="button" aria-label={`增加${props['aria-label'] ?? '数值'}`} disabled={props.disabled || props.readOnly || atMax} onClick={() => step(1)}><Plus size={14}/></button>
    </span>
  </span>;
}

const typeLabels: Record<string, string> = { volume: '卷', chapter: '章', section: '节', act: '幕', scene: '场景', quest: '任务', page: '页', note: '笔记' };

/** Free-form input with suggestions; choosing a suggestion is always optional. */
export function TypeCombobox({ value, onValueChange, suggestions, label, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'list'> & {
  value: string; onValueChange: (value: string) => void; suggestions: string[]; label: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const input = useRef<HTMLInputElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [filter, setFilter] = useState(false), [active, setActive] = useState(-1);
  const options = suggestions.filter(kind => !filter || `${kind} ${typeLabels[kind] ?? ''}`.toLowerCase().includes(value.toLowerCase()));
  const anchor = `--type-${id}`;
  useEffect(() => {
    if (open && !props.disabled) popup.current?.showPopover(); else popup.current?.hidePopover();
  }, [open, props.disabled]);
  const choose = (kind: string) => { onValueChange(kind); setOpen(false); setActive(-1); input.current?.focus(); };
  return <span className="type-combobox" style={{ anchorName: anchor } as CSSProperties}>
    <input {...props} ref={input} value={value} aria-label={label} role="combobox" aria-autocomplete="list"
      aria-expanded={open} aria-controls={`${id}-suggestions`} aria-activedescendant={open && active >= 0 && options[active] ? `${id}-option-${active}` : undefined}
      onChange={event => { onValueChange(event.target.value); setFilter(true); setActive(-1); setOpen(true); }}
      onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) { setFilter(false); setOpen(true); setActive(event.key === 'ArrowDown' ? 0 : suggestions.length - 1); }
          else if (options.length) setActive(previous => event.key === 'ArrowDown' ? (previous + 1) % options.length : ((previous < 0 ? options.length : previous) - 1 + options.length) % options.length);
        } else if (event.key === 'Enter' && open && active >= 0 && options[active]) {
          event.preventDefault(); choose(options[active]);
        } else if (event.key === 'Escape' && open) {
          event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
        } else if (event.key === 'Tab') setOpen(false);
      }}/>
    <button type="button" className="type-combobox-toggle" aria-label={`显示${label}的建议`} aria-expanded={open} disabled={props.disabled}
      onMouseDown={event => event.preventDefault()} onClick={() => { setFilter(false); setActive(-1); setOpen(!open); input.current?.focus(); }}><ChevronDown size={16}/></button>
    <div ref={popup} id={`${id}-suggestions`} className="control-menu type-suggestions" popover="auto" role="listbox" aria-label={`${label}建议`}
      style={{ positionAnchor: anchor } as CSSProperties} onToggle={event => { if (event.newState === 'closed') { setOpen(false); setActive(-1); } }}>
      {options.length ? options.map((kind, index) => <button key={kind} id={`${id}-option-${index}`} type="button" role="option" tabIndex={-1}
        aria-selected={value === kind} className={active === index ? 'is-active' : ''}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(kind)}>
        <span>{typeLabels[kind]}<small>{kind}</small></span>{value === kind && <Check size={16}/>}</button>) : <p className="control-menu-empty">可继续使用自定义类型</p>}
    </div>
  </span>;
}
