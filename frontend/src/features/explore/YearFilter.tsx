import { useEffect, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Button } from '../../components/ui';
import type { YearRange } from './api';

export function YearFilter({ range, uncertain, onChange, onUncertain }: { range: YearRange; uncertain: boolean; onChange: (range: YearRange) => void; onUncertain: (value: boolean) => void }) {
  const [start, setStart] = useState(''), [end, setEnd] = useState(''), [error, setError] = useState('');
  useEffect(() => { setStart(range.start === undefined ? '' : String(range.start)); setEnd(range.end === undefined ? '' : String(range.end)); setError(''); }, [range.start, range.end]);
  function apply() {
    if ([start, end].some(v => v.trim() && !/^-?\d{1,6}$/.test(v.trim()))) { setError('请输入明确的整数年份。'); return; }
    const value = { ...(start.trim() ? { start: Number(start) } : {}), ...(end.trim() ? { end: Number(end) } : {}) };
    if (value.start !== undefined && value.end !== undefined && value.start > value.end) { setError('起始年份不能晚于结束年份。'); return; }
    setError(''); onChange(value);
  }
  return <section className="explore-left-section year-filter"><h3><CalendarRange size={14}/>年份范围</h3><form onSubmit={e => { e.preventDefault(); apply(); }}><div className="year-inputs"><label>起始年<input aria-label="起始年份" inputMode="numeric" placeholder="不限" value={start} onChange={e => setStart(e.target.value)}/></label><span>—</span><label>结束年<input aria-label="结束年份" inputMode="numeric" placeholder="不限" value={end} onChange={e => setEnd(e.target.value)}/></label></div><div className="year-actions"><Button type="submit">应用年份</Button><Button type="button" variant="ghost" onClick={() => onChange({})}>全部年份</Button></div></form>{error && <p role="alert" className="year-error">{error}</p>}<label className="explore-filter-row"><input type="checkbox" checked={uncertain} onChange={e => onUncertain(e.target.checked)}/><span>包含时间未定记录</span></label><p>按明确年份展示。未知边界保持未知，不代表持续有效。</p></section>;
}
