import type { TimelineRecord, YearRange } from './api';

export interface TimeViewport { start: number; end: number }
export function fitYears(bounds: { start: number | null; end: number | null }, range: YearRange): TimeViewport {
  const first = range.start ?? bounds.start ?? range.end ?? 0;
  const last = range.end ?? bounds.end ?? range.start ?? first;
  const span = Math.max(1, last - first + 1), padding = span * .07;
  return { start: first - padding, end: first + span + padding };
}
export function validTimeViewport(value: TimeViewport | undefined): value is TimeViewport {
  return !!value && Number.isFinite(value.start) && Number.isFinite(value.end) && value.end > value.start
    && value.start >= -3000000 && value.end <= 3000000 && value.end - value.start >= .25;
}
export function zoomYears(view: TimeViewport, factor: number, anchor = .5): TimeViewport {
  const span = Math.min(2200000, Math.max(.5, (view.end - view.start) * factor));
  const center = view.start + (view.end - view.start) * anchor;
  return { start: center - span * anchor, end: center + span * (1 - anchor) };
}
export function ticks(view: TimeViewport, width: number): number[] {
  const rough = (view.end - view.start) / Math.max(1, width / 94);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, rough)));
  const step = [1, 2, 5, 10].map(n => n * magnitude).find(n => n >= rough) || magnitude * 10;
  const result: number[] = [];
  for (let year = Math.ceil(view.start / step) * step; year < view.end && result.length < 50; year += step) result.push(year);
  return result;
}

export interface TimePlacement { record: TimelineRecord; left: number; width: number; track: number; interval: boolean; clipped: boolean }
export interface TimeLane { key: string; label: string; kind: TimelineRecord['kind']; height: number; placements: TimePlacement[] }
/** Label extents take part in collision detection. No record is merged or dropped. */
export function timeLanes(records: TimelineRecord[], view: TimeViewport, width: number): TimeLane[] {
  const lanes = new Map<string, TimelineRecord[]>();
  for (const record of records) {
    if (!lanes.has(record.lane_key)) lanes.set(record.lane_key, []);
    lanes.get(record.lane_key)!.push(record);
  }
  const rank = { event: 0, relationship: 1, assertion: 2 };
  return [...lanes].sort(([, a], [, b]) => rank[a[0].kind] - rank[b[0].kind] || a[0].lane_label.localeCompare(b[0].lane_label)).map(([key, values]) => {
    const ends: number[] = [], placements: TimePlacement[] = [];
    const x = (year: number) => (year - view.start) / (view.end - view.start) * width;
    for (const record of [...values].sort((a, b) => (a.time.start ?? a.time.end ?? 0) - (b.time.start ?? b.time.end ?? 0) || a.key.localeCompare(b.key))) {
      const singleYearEvent = record.kind === 'event' && record.time.certainty === 'dated' && record.time.start === record.time.end;
      const interval = record.time.certainty === 'dated' && !singleYearEvent;
      const first = record.time.start ?? record.time.end;
      if (first === null) continue;
      const left = x(first + (singleYearEvent ? .5 : 0)), right = interval ? x(record.time.end! + 1) : left;
      if (interval ? right < 0 || left > width : left < 0 || left > width) continue;
      const visibleLeft = Math.max(0, Math.min(left, width - 24));
      const barWidth = interval ? Math.max(24, Math.min(width, right) - visibleLeft) : 28;
      const labelWidth = Math.min(190, Math.max(100, (record.label.length + (record.value?.length || 0)) * 12 + 30));
      const extent = Math.min(width - visibleLeft, Math.max(barWidth, labelWidth));
      let track = ends.findIndex(end => end + 12 <= visibleLeft);
      if (track < 0) track = ends.length;
      ends[track] = visibleLeft + extent;
      placements.push({ record, left: visibleLeft, width: barWidth, track, interval, clipped: interval && (left < 0 || right > width) });
    }
    return { key, label: values[0].lane_label, kind: values[0].kind, height: Math.max(84, ends.length * 59 + 24), placements };
  });
}
