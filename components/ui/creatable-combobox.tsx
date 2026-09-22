'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Plus, X } from 'lucide-react';

export type ComboboxOption = { id: string; name: string };
export type ComboboxValue = { id: string; name: string };

type Props = {
  id?: string;
  value: ComboboxValue;
  options: ComboboxOption[];
  onChange: (value: ComboboxValue) => void;
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
  allowEmpty?: boolean;
};

export function CreatableCombobox({ id, value, options, onChange, placeholder, disabled = false, loading = false, allowEmpty = false }: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = value.name;
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const exactOption = options.find((option) => option.name.trim() === query.trim());
  const filtered = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) => option.name.toLocaleLowerCase('zh-CN').includes(normalizedQuery));
  }, [normalizedQuery, options]);
  const canCreate = Boolean(query.trim()) && !exactOption;
  const itemCount = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  function choose(option: ComboboxOption) {
    onChange({ id: option.id, name: option.name });
    setOpen(false);
  }

  function commitTypedValue() {
    const name = query.trim();
    if (!name) return;
    onChange({ id: '', name });
    setOpen(false);
  }

  function updateInput(name: string) {
    const exact = options.find((option) => option.name.trim() === name.trim());
    onChange({ id: exact?.id || '', name });
    setActiveIndex(0);
    setOpen(true);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault(); setOpen(true); setActiveIndex((index) => itemCount ? (index + 1) % itemCount : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true); setActiveIndex((index) => itemCount ? (index - 1 + itemCount) % itemCount : 0);
    } else if (event.key === 'Enter' && open && itemCount) {
      event.preventDefault();
      if (activeIndex < filtered.length) choose(filtered[activeIndex]); else commitTypedValue();
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return <div ref={rootRef} className="relative"><div className={`input flex items-center gap-2 px-3 py-0 ${disabled ? 'cursor-not-allowed bg-slate-50 text-slate-400' : ''}`}><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400" value={query} placeholder={placeholder} disabled={disabled} onFocus={() => { setActiveIndex(0); setOpen(true); }} onClick={() => setOpen(true)} onChange={(event) => updateInput(event.target.value)} onKeyDown={onKeyDown} />{loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-500" /> : value.name && allowEmpty ? <button type="button" aria-label="清空" className="rounded p-0.5 text-slate-400 hover:text-slate-600" onClick={() => onChange({ id: '', name: '' })}><X className="h-4 w-4" /></button> : <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />}</div>{open && !disabled && <div id={listId} role="listbox" className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">{filtered.map((option, index) => <button type="button" role="option" aria-selected={value.id === option.id} key={option.id} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${activeIndex === index ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`} onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>{value.id === option.id ? <Check className="h-4 w-4 text-brand-600" /> : <span className="w-4" />}{option.name}</button>)}{canCreate && <button type="button" role="option" aria-selected={false} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${activeIndex === filtered.length ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`} onMouseEnter={() => setActiveIndex(filtered.length)} onMouseDown={(event) => event.preventDefault()} onClick={commitTypedValue}><Plus className="h-4 w-4 text-brand-600" />创建“{query.trim()}”</button>}{!loading && !filtered.length && !canCreate && <p className="px-3 py-3 text-sm text-slate-400">暂无可选项</p>}</div>}</div>;
}
