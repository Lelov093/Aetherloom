import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, ErrorNotice } from '../../components/ui';
import { creationApi, type ContentNode, type Entity, type Work } from '../creation/api';
import { periodsApi, type PeriodEvent } from '../periods/api';
import { BackgroundPicker, materialDraft, materialKey, type MaterialDraft, type SelectedMaterial } from './BackgroundPicker';
import { openingLabels, runtimeRequest, scenarioPeriodLabel, type HostSession, type OpeningCheck, type ScenarioPeriod } from './api';
import { PreparationScope, type PreparationScopePreview } from './PreparationScope';
import { OpeningInspection, OpeningRules, RoleRoster, type CharacterDraft, type RuleDraft } from './OpeningReadiness';
import { PremisePreparation, type PastDraft, type UnknownDraft } from './PremisePreparation';
import { ReopenDifferences } from './ReopenDifferences';
import '../../styles/scenario-preparation.css';

interface Preview extends PreparationScopePreview {
  scope_key: string;
  revision: number;
  period: ScenarioPeriod;
  materials: { path: string; location_id: string; time: string; text: string }[];
}

type SavedBinding = { entity_id: string | null };
interface ReopenSeed {
  worldline_id: string;
  title: string;
  origin_available: boolean;
  materials: { before: MaterialDraft; current: MaterialDraft | null; current_version: number | null; same_text: boolean }[];
  config: {
    origin_node_id: string | null;
    expanded: string[];
    excluded: string[];
    period: { year: number | null; event_id: string | null; side: 'before' | 'after' | null };
    opening: { mode: 'continue' | 'custom'; location: SavedBinding; material_index: number | null; time: string; situation: string };
    cast: SavedBinding[];
    review?: {
      candidates: SavedBinding[];
      roles: Record<string, { location: SavedBinding | null; goal: string; voice_sample: string;
        evidence: { basis: CharacterDraft['evidence'][number]['basis']; text: string; reporter: string; source: SelectedMaterial | null }[] }>;
      required_rules: Record<string, { mechanism: RuleDraft['mechanism'] | null; destination: SavedBinding | null;
        item: SavedBinding | null; holder: SavedBinding | null }>;
      observation_question: string;
      ordinary_past?: Omit<PastDraft, 'id'>[];
      key_unknowns?: Omit<UnknownDraft, 'id'>[];
    };
  };
}

const sourceChanged = '资料或关联范围已更新。请核对当前版本，必要时移除旧选段并重新选择。';
function message(error: unknown) {
  const value = (error as Error).message;
  const hints: Record<string, string> = {
    host_unavailable: '请在启用了文本模拟的桌面工作区中准备并保存起点。',
    scenario_migration_required: '此工作区尚未启用共享 Runtime，暂时无法保存新的文本起点。',
    scenario_sources_changed: sourceChanged,
    unauthorized: '本机授权已过期，请重新连接后继续。',
    session_expired: '本机授权已过期，请重新连接后继续。',
    invalid_scenario_opening: '请核对选中的接续段落，或填完整自定开场的时间和情境。',
    scenario_readiness_blocked: '开局条件已变化，请重新检查后保存。',
    reopen_requires_authored_start: '这个起点缺少可复用的作者准备记录。',
    spoiler_view_active: '请回到原世界线，关闭防泄底后查看准备配置。',
    invalid_opening_source: '有角色输入引用了已移除的原文，请重新指定依据。',
    invalid_premise_scope: '请核对往事及问题是否重复，并检查获知范围是否都属于本场参与人物。',
  };
  return hints[value] ?? (value.startsWith('[') ? '请检查选材和开场设置。' : value);
}

function binding(entity: Entity) {
  return { entity_id: entity.id, entity_version: entity.version };
}

export function AuthoredPreparation({ world, onCreated }: { world: string; onCreated: (line: string) => void }) {
  const [params] = useSearchParams();
  const reopening = params.get('reopen');
  const [reopenSeed, setReopenSeed] = useState<ReopenSeed>();
  const reopenLoaded = useRef(false);
  const [removeOrigin, setRemoveOrigin] = useState(false);
  const [resolvedSelections, setResolvedSelections] = useState<Record<string, string>>({});
  const originId = reopening ? removeOrigin ? null : reopenSeed?.config.origin_node_id ?? null : params.get('origin');
  const sourceId = params.get('source');
  const version = params.get('version'), start = params.get('start'), end = params.get('end');
  const fromWorldHome = params.get('from') === 'home';
  const returnToReading = params.get('mode') === 'read';
  const [host, setHost] = useState<HostSession>(), [cycle, setCycle] = useState(0);
  const [works, setWorks] = useState<Work[]>([]), [entities, setEntities] = useState<Entity[]>([]);
  const [events, setEvents] = useState<PeriodEvent[]>([]), [origin, setOrigin] = useState<ContentNode>();
  const [loading, setLoading] = useState(true), [hostError, setHostError] = useState('');
  const [materials, setMaterials] = useState<MaterialDraft[]>([]);
  const [error, setError] = useState('');
  const [reviewError, setReviewError] = useState<{ key: string; error: Error }>();
  const [previewCycle, setPreviewCycle] = useState(0);
  const [expanded, setExpanded] = useState<string[]>([]), [excluded, setExcluded] = useState<string[]>([]);
  const [periodMode, setPeriodMode] = useState(''), [periodYear, setPeriodYear] = useState(''), [eventId, setEventId] = useState('');
  const [result, setResult] = useState<{ key: string; materialKeys: string[]; preview: Preview }>();
  const [title, setTitle] = useState(''), [mode, setMode] = useState<'continue' | 'custom'>('continue');
  const [anchor, setAnchor] = useState('');
  const [continuePlace, setContinuePlace] = useState(''), [continueTime, setContinueTime] = useState(''), [continuation, setContinuation] = useState('');
  const [customPlace, setCustomPlace] = useState(''), [customTime, setCustomTime] = useState(''), [situation, setSituation] = useState('');
  const [cast, setCast] = useState<string[]>([]), [candidates, setCandidates] = useState<string[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, CharacterDraft>>({});
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, RuleDraft>>({});
  const [observationQuestion, setObservationQuestion] = useState('');
  const [ordinary, setOrdinary] = useState<PastDraft[]>([]), [unknowns, setUnknowns] = useState<UnknownDraft[]>([]);
  const [checking, setChecking] = useState(false);
  const [readiness, setReadiness] = useState<{ key: string; check: OpeningCheck }>();
  const [savedStart, setSavedStart] = useState<{ key: string; line: string; title: string }>();
  const [saving, setSaving] = useState(false);
  const saveAttempt = useRef<{ serialized: string; id: string }>(undefined);

  function restoreStart(seed: ReopenSeed) {
    const { config, materials: sources } = seed;
    const { opening, period, review } = config;
    setReopenSeed(seed);
    setMaterials(sources.flatMap(row => row.current ? [row.current] : []));
    setExpanded(config.expanded);
    setExcluded(config.excluded);
    setTitle(Array.from(seed.title).slice(0, 93).join('') + ' · 新版');
    setMode(opening.mode);
    setContinuePlace(opening.mode === 'continue' ? opening.location.entity_id ?? '' : '');
    setContinueTime(opening.mode === 'continue' ? opening.time : '');
    setContinuation(opening.mode === 'continue' ? opening.situation : '');
    setCustomPlace(opening.mode === 'custom' ? opening.location.entity_id ?? '' : '');
    setCustomTime(opening.mode === 'custom' ? opening.time : '');
    setSituation(opening.mode === 'custom' ? opening.situation : '');
    const nextAnchor = opening.material_index === null ? null : sources[opening.material_index]?.current;
    setAnchor(nextAnchor ? materialKey(nextAnchor) : '');
    setPeriodMode(period.year !== null ? 'year' : period.side ?? '');
    setPeriodYear(period.year === null ? '' : String(period.year));
    setEventId(period.event_id ?? '');
    setCast(config.cast.flatMap(row => row.entity_id ? [row.entity_id] : []));
    setCandidates((review?.candidates ?? []).flatMap(row => row.entity_id ? [row.entity_id] : []));
    setObservationQuestion(review?.observation_question ?? '');
    setOrdinary((review?.ordinary_past ?? []).map(row => ({ ...row, id: crypto.randomUUID() })));
    setUnknowns((review?.key_unknowns ?? []).map(row => ({ ...row, id: crypto.randomUUID() })));
    const unchanged = new Map(sources.flatMap(row => row.same_text && row.current
      ? [[materialKey(row.before), materialKey(row.current)] as const] : []));
    setRoleDrafts(Object.fromEntries(Object.entries(review?.roles ?? {}).map(([id, role]) => [id, {
      location: role.location?.entity_id ?? '', goal: role.goal, voiceSample: role.voice_sample,
      evidence: role.evidence.map(entry => {
        const source = entry.source ? materialKey(entry.source) : '';
        return { ...entry, id: crypto.randomUUID(), source: unchanged.get(source) ?? source };
      }),
    }])));
    setRuleDrafts(Object.fromEntries(Object.entries(review?.required_rules ?? {}).map(([id, rule]) => [id, {
      mechanism: rule.mechanism ?? '', destination: rule.destination?.entity_id ?? '',
      item: rule.item?.entity_id ?? '', holder: rule.holder?.entity_id ?? '',
    }])));
  }

  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    creationApi.node(sourceId).then(node => {
      if (!active) return;
      if (originId === node.id) setOrigin(node);
      if (version !== null && node.version !== Number(version)) {
        setError(sourceChanged);
        return;
      }
      const range = start !== null && end !== null && /^\d+$/.test(start) && /^\d+$/.test(end)
        ? { start: Number(start), end: Number(end) } : undefined;
      const initial = materialDraft(node, range);
      if (initial) {
        setMaterials(rows => rows.some(row => row.node_id === initial.node_id) ? rows : [initial, ...rows]);
        setAnchor(previous => previous || materialKey(initial));
      } else if (version !== null) setError(sourceChanged);
    }).catch(problem => { if (active) setError(message(problem)); });
    return () => { active = false; };
  }, [sourceId, originId, version, start, end]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setHostError('');
    async function load() {
      if (!(await window.aetherloomRuntime?.available())) throw new Error('host_unavailable');
      const [session, nextWorks, objects, worldEvents] = await Promise.all([
        window.aetherloomRuntime!.session(world, 'creator_observer', undefined, undefined,
          Boolean(reopening && localStorage.getItem(`runtime-spoiler-free:${world}`) === '1')),
        creationApi.works(world), creationApi.entities(world), periodsApi.events(world),
      ]);
      if (!active) return;
      if (!session) throw new Error('host_unavailable');
      const config = await runtimeRequest<{ ready: boolean }>(session, '/series');
      if (!active) return;
      if (!config.ready) throw new Error('scenario_migration_required');
      if (reopening && !reopenLoaded.current) {
        const seed = await runtimeRequest<ReopenSeed>(session, `/worldlines/${encodeURIComponent(reopening)}/reopen`);
        const sourceOrigin = seed.config.origin_node_id && seed.origin_available
          ? await creationApi.node(seed.config.origin_node_id) : undefined;
        if (!active) return;
        restoreStart(seed);
        setOrigin(sourceOrigin);
        reopenLoaded.current = true;
      }
      setHost(session);
      setWorks(nextWorks.filter(work => work.status === 'active'));
      setEntities(objects.filter(entity => entity.status === 'active' && !entity.merged_into));
      setEvents(worldEvents);
    }
    void load().catch(problem => { if (active) setHostError(message(problem)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [world, cycle, reopening]);

  const periodValid = periodMode === 'year' ? /^-?\d{1,6}$/.test(periodYear)
    : !periodMode || Boolean(eventId);
  const background = {
    materials: materials.map(({ node_id, version, start, end }) => ({ node_id, version, start, end })),
    expanded, excluded,
    period: periodMode === 'year' ? { year: Number(periodYear) }
      : periodMode ? { event_id: eventId, side: periodMode } : {},
  };
  const request = periodValid && materials.length ? JSON.stringify(background) : '';
  const requestKey = `${host?.token ?? ''}\n${previewCycle}\n${request}`;
  useEffect(() => {
    if (!request || !host || loading) return;
    const abort = new AbortController();
    const payload = JSON.parse(request) as { materials: SelectedMaterial[] };
    runtimeRequest<Preview>(host, '/scenario-background', abort.signal, 'POST', payload)
      .then(preview => {
        if (!abort.signal.aborted) {
          setResult({ key: requestKey, materialKeys: payload.materials.map(materialKey), preview });
          setReviewError(previous => previous?.key === requestKey ? undefined : previous);
        }
      })
      .catch(problem => { if (!abort.signal.aborted) {
        setReviewError({ key: requestKey, error: problem as Error });
      } });
    return () => abort.abort();
  }, [host, loading, request, requestKey]);
  const currentError = reviewError?.key === requestKey ? reviewError.error : undefined;
  const preview = !loading && !hostError && result?.key === requestKey ? result.preview : undefined;
  const displayedScope = result?.preview;
  const scopeLoading = Boolean(request && !preview && !currentError && !hostError);
  const places = entities.filter(entity => entity.kind === 'location');
  const choices = entities.filter(entity => entity.kind === 'character');
  const peopleById = new Map(choices.map(person => [person.id, person]));
  const orderedPeople = (ids: string[]) => ids.map(id => peopleById.get(id)).filter((person): person is Entity => Boolean(person));
  const participants = reopening ? orderedPeople(cast) : choices.filter(person => cast.includes(person.id));
  const possibleActors = reopening ? orderedPeople(candidates) : choices.filter(person => candidates.includes(person.id));
  const exactIndex = materials.findIndex(item => materialKey(item) === anchor);
  const anchorIndex = reopening || exactIndex >= 0 ? exactIndex : materials.length - 1;
  const anchorMaterial = materials[anchorIndex];
  const previewIndex = anchorMaterial ? result?.materialKeys.indexOf(materialKey(anchorMaterial)) ?? -1 : -1;
  const selected = displayedScope?.materials[previewIndex];
  const suggestedPlace = places.find(place => place.id === selected?.location_id);
  const location = places.find(place => place.id === (mode === 'custom' ? customPlace : continuePlace || suggestedPlace?.id));
  const time = mode === 'custom' ? customTime : continueTime || selected?.time || '';
  const ancestors = origin ? works.find(work => work.id === origin.work_id) : undefined;
  const worldPath = `/worlds/${world}`;
  const back = reopening ? `${worldPath}/simulate?line=${encodeURIComponent(reopening)}`
    : origin && originId ? `${worldPath}/create?${new URLSearchParams({ work: origin.work_id, node: origin.id,
    ...(returnToReading ? { mode: 'read' } : {}) })}` : fromWorldHome ? worldPath : `${worldPath}/simulate`;
  const activeScope = (displayedScope?.context ?? []).filter(row => row.included);
  const rules = activeScope.filter(row => row.kind === 'world_rule');
  const referencePeople = activeScope.filter(row => row.kind === 'character' && !cast.includes(row.id) && !candidates.includes(row.id));
  const actors = [...participants, ...possibleActors];
  const roleLocations = new Set(actors.map(actor => roleDrafts[actor.id]?.location));
  const scopedPlaces = new Set(activeScope.filter(row => row.kind === 'location').map(row => row.id));
  const scenePlaces = places.filter(place => place.id === location?.id || scopedPlaces.has(place.id) || roleLocations.has(place.id));
  const byId = new Map(entities.map(entity => [entity.id, entity]));
  const materialByKey = new Map(materials.map(row => [materialKey(row), row]));
  const unresolved = reopenSeed?.materials.filter(row => row.current === null) ?? [];
  const pendingSelections = unresolved.some(row => {
    const decision = resolvedSelections[materialKey(row.before)];
    return decision !== 'skip' && !materialByKey.has(decision);
  });
  const missingRules = reopening && preview ? Object.keys(ruleDrafts).filter(id => !rules.some(rule => rule.id === id)) : [];
  const originMissing = reopenSeed && !reopenSeed.origin_available && !removeOrigin;
  function bound(id?: string) {
    if (!id) return null;
    const entity = byId.get(id);
    return entity ? binding(entity) : { entity_id: id, entity_version: null };
  }
  const incompleteActor = actors.find(person => roleDrafts[person.id]?.evidence.some(row =>
    !row.text.trim() || row.basis === 'reported' && !row.reporter.trim() || row.source && !materialByKey.has(row.source)));
  const incompletePremise = ordinary.some(row => !row.text.trim() || !row.witnesses.length) || unknowns.some(row => !row.title.trim());
  const payload = preview && location && participants.length && participants.length === cast.length && possibleActors.length === candidates.length &&
    !pendingSelections && !originMissing && missingRules.length === 0 &&
    title.trim() && (mode === 'continue' ? Boolean(anchorMaterial) : customTime.trim() && situation.trim()) ? {
      ...background, title: title.trim(), scope_key: preview.scope_key, origin_node_id: originId, reopened_from: reopening ?? undefined,
      opening: { mode, material_index: mode === 'continue' ? anchorIndex : null, location: binding(location), time,
        situation: mode === 'continue' ? continuation : situation },
      cast: participants.map(binding),
      review: {
        candidates: possibleActors.map(binding), observation_question: observationQuestion,
        ordinary_past: ordinary.map(({ text, witnesses }) => ({ text, witnesses })),
        key_unknowns: unknowns.map(({ title, may_resolve, knowers }) => ({ title, may_resolve, knowers })),
        roles: Object.fromEntries(actors.flatMap(({ id }) => {
          const settings = roleDrafts[id];
          if (!settings) return [];
          return [[id, { location: bound(settings.location), goal: settings.goal, voice_sample: settings.voiceSample,
            evidence: settings.evidence.map(row => {
              const source = materialByKey.get(row.source);
              return { basis: row.basis, text: row.text, reporter: row.basis === 'reported' ? row.reporter : '',
                source: source ? { node_id: source.node_id, version: source.version, start: source.start, end: source.end } : null };
            }) }]];
        })),
        required_rules: Object.fromEntries(rules.flatMap(rule => {
          const settings = ruleDrafts[rule.id];
          return settings ? [[rule.id, { mechanism: settings.mechanism || null, destination: bound(settings.destination),
            item: bound(settings.item), holder: bound(settings.holder) }]] : [];
        })),
      },
    } : undefined;
  const serialized = payload ? JSON.stringify(payload) : '';
  const check = readiness?.key === serialized && !incompleteActor && !incompletePremise ? readiness.check : undefined;
  const alreadySaved = savedStart?.key === serialized;
  const ready = check && !check.blockers.length && !alreadySaved;

  function add(rows: MaterialDraft[]) {
    const combined = new Map(materials.map(row => [materialKey(row), row]));
    for (const row of rows) {
      for (const [key, old] of combined) {
        if (old.node_id === row.node_id && old.version !== row.version) combined.delete(key);
      }
      combined.set(materialKey(row), row);
    }
    if (combined.size > 30) {
      setError('一个起点最多选 30 段或份正文，请先移除部分材料。');
      return;
    }
    setMaterials([...combined.values()]);
    setError('');
  }

  function reportError(problem: unknown) {
    const code = (problem as Error).message;
    if (['scenario_sources_changed', 'unauthorized', 'session_expired'].includes(code)) setCycle(value => value + 1);
    setError(message(problem));
  }

  async function checkOpening() {
    if (!host || !payload || checking || saving) return;
    if (incompleteActor) {
      setError(`请补齐「${incompleteActor.name}」的角色输入、转述者或原文依据。`);
      return;
    }
    if (incompletePremise) {
      setError('请填齐已登记的关键未知，并为获准补充的每条往事选择亲历者。');
      return;
    }
    setChecking(true);
    setError('');
    try {
      const result = await runtimeRequest<OpeningCheck>(host, '/scenario-readiness', undefined, 'POST', payload);
      setReadiness({ key: serialized, check: result });
    } catch (problem) { reportError(problem); }
    finally { setChecking(false); }
  }

  function locateIssue(issue: OpeningCheck['blockers'][number]) {
    const row = document.getElementById(`opening-${issue.kind}-${issue.id}`);
    if (row instanceof HTMLDetailsElement) row.open = true;
    row?.scrollIntoView({ block: 'center' });
    row?.querySelector('select')?.focus({ preventScroll: true });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !payload || !host || saving) return;
    const stay = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === 'stay';
    if (saveAttempt.current?.serialized !== serialized) saveAttempt.current = { serialized, id: crypto.randomUUID() };
    setSaving(true);
    setError('');
    try {
      const saved = await runtimeRequest<{ worldline_id: string }>(host, '/scenarios/authored', undefined, 'POST',
        { ...payload, request_id: saveAttempt.current.id });
      if (stay) setSavedStart({ key: serialized, line: saved.worldline_id, title: payload.title });
      else onCreated(saved.worldline_id);
    } catch (problem) {
      setReadiness(undefined);
      reportError(problem);
    } finally { setSaving(false); }
  }

  const listPlaces = (value: string, onChange: (id: string) => void, fallback: string) => (
    <select value={value} onChange={event => onChange(event.target.value)}>
      <option value="">{fallback}</option>
      {places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
    </select>
  );

  return <main id="main-content" className="page simulation-page scenario-preparation">
    <header className="preparation-heading">
      <Link className="text-link" to={back}>← {reopening ? '返回原世界线' : origin && originId ? '返回发起章幕' : fromWorldHome ? '返回世界首页' : '返回世界线列表'}</Link>
      <h1>{reopening ? '用新版重开' : '准备文本模拟'}</h1>
      {reopenSeed && <p>沿用「{reopenSeed.title}」的开场与角色配置。检查新版出处后保存起点。</p>}
      {originId && origin && <p>发起章幕 · {ancestors?.title && `${ancestors.title} / `}{origin.title}</p>}
    </header>
    {loading && <p role="status">正在读取本机工作区…</p>}
    {hostError && <ErrorNotice>{hostError}</ErrorNotice>}
    {!loading && hostError && <Button onClick={() => setCycle(value => value + 1)}>重新连接</Button>}
    {host && <form className="preparation-form" onSubmit={save}>
      <section aria-labelledby="preparation-material-heading">
        <h2 id="preparation-material-heading">本场背景</h2>
        {originMissing && <p>原发起章幕已收起或不可用。 <Button type="button" onClick={() => setRemoveOrigin(true)}>移除新线的发起章幕</Button></p>}
        {unresolved.map(({ before, current_version }) => <div className="preparation-selected" key={materialKey(before)}>
          <strong>{before.title} · 旧选段 v{before.version}</strong>
          <p>{before.quote}</p>
          <label>处理旧选段 · {before.title}
            <select aria-label={`处理旧选段 · ${before.title}`} value={resolvedSelections[materialKey(before)] ?? ''} onChange={event => {
              const value = event.target.value;
              setResolvedSelections(rows => ({ ...rows, [materialKey(before)]: value }));
              const openingIndex = reopenSeed?.config.opening.material_index;
              const opening = openingIndex == null ? null : reopenSeed?.materials[openingIndex]?.before;
              if (opening && materialKey(opening) === materialKey(before)) setAnchor(value === 'skip' ? '' : value);
            }}>
              <option value="">{current_version ? `请从 v${current_version} 重选并加入选材` : '原资料不可用'}</option>
              {materials.filter(row => row.node_id === before.node_id).map(row => <option key={materialKey(row)} value={materialKey(row)}>{row.quote}</option>)}
              <option value="skip">略过此旧选段</option>
            </select>
          </label>
        </div>)}
        <BackgroundPicker works={works} origin={origin} disabled={saving} onAdd={add} onError={setError} />
        {materials.length > 0 && <div className="preparation-selected">
          <h3>已选章段</h3>
          <ul aria-label="已选章段" className="preparation-rows">
            {materials.map(item => <li key={materialKey(item)}>
              <div><strong>{item.title} · v{item.version}</strong><small>{item.quote}</small></div>
              <Button type="button" aria-label={`移除选材：${item.title}`} disabled={saving}
                onClick={() => setMaterials(rows => rows.filter(row => materialKey(row) !== materialKey(item)))}>移除</Button>
            </li>)}
          </ul>
        </div>}
        <div className="preparation-fields">
          <label>背景时期<select value={periodMode} onChange={event => setPeriodMode(event.target.value)}>
            <option value="">未限定时期</option><option value="year">指定年份</option>
            <option value="before">事件之前</option><option value="after">事件之后</option>
          </select></label>
          {periodMode === 'year' && <label>故事年份<input type="number" min="-999999" max="999999" value={periodYear}
            onChange={event => setPeriodYear(event.target.value)} /></label>}
          {periodMode && periodMode !== 'year' && <label>时期事件<select value={eventId} onChange={event => setEventId(event.target.value)}>
            <option value="">选择事件</option>
            {events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}
          </select></label>}
        </div>
      </section>
      {materials.length > 0 && <section aria-labelledby="preparation-scope-heading">
        <header className="preparation-scope-heading">
          <h2 id="preparation-scope-heading">关联范围{displayedScope && ` · ${scenarioPeriodLabel(displayedScope.period)}`}</h2>
          <span role="status">{displayedScope && `已纳入 ${displayedScope.context.filter(item => item.included).length} 项`}</span>
        </header>
        <PreparationScope scope={displayedScope} excluded={excluded} requested={expanded}
          loading={scopeLoading} saving={saving}
          onDiscover={key => setExpanded(rows => rows.includes(key) ? rows : [...rows, key])}
          onInclude={key => setExcluded(rows => rows.includes(key) ? rows.filter(value => value !== key) : [...rows, key])} />
        {currentError && <div>
          <ErrorNotice>{message(currentError)}</ErrorNotice>
          <Button type="button" onClick={() => {
            if (['unauthorized', 'session_expired'].includes(currentError.message)) setCycle(value => value + 1);
            else setPreviewCycle(value => value + 1);
          }}>重新读取背景</Button>
        </div>}
      </section>}
      <section aria-labelledby="preparation-opening-heading">
        <h2 id="preparation-opening-heading">开场</h2>
        <fieldset className="preparation-modes" aria-label="开场方式">
          <label><input type="radio" name="opening" checked={mode === 'continue'} onChange={() => setMode('continue')} />{openingLabels.continue}</label>
          <label><input type="radio" name="opening" checked={mode === 'custom'} onChange={() => setMode('custom')} />{openingLabels.custom}</label>
        </fieldset>
        {mode === 'continue' ? <>
          <label>接续原文<select value={materials[anchorIndex] ? materialKey(materials[anchorIndex]) : ''} onChange={event => {
            setAnchor(event.target.value); setContinuePlace(''); setContinueTime('');
          }}>
            {!anchorMaterial && <option value="">请选择接续原文</option>}
            {materials.map(item => <option key={materialKey(item)} value={materialKey(item)}>{item.title} · v{item.version} · {item.quote.slice(0, 32)}</option>)}
          </select></label>
          {selected && <blockquote className="preparation-quote">{selected.text}</blockquote>}
          <div className="preparation-fields">
            <label>接续地点{listPlaces(continuePlace, setContinuePlace, suggestedPlace ? `沿用章幕地点 · ${suggestedPlace.name}` : '选择已有地点')}</label>
            <label>接续时间<input placeholder={selected?.time || '可沿用背景时期'} value={continueTime} maxLength={160}
              onChange={event => setContinueTime(event.target.value)} /></label>
          </div>
          <label>接续情境（可选）<textarea rows={2} maxLength={3000} value={continuation} onChange={event => setContinuation(event.target.value)} /></label>
        </> : <>
          <div className="preparation-fields">
            <label>开场地点{listPlaces(customPlace, setCustomPlace, '选择已有地点')}</label>
            <label>开场时间<input value={customTime} maxLength={160} required onChange={event => setCustomTime(event.target.value)} /></label>
          </div>
          <label>开场情境<textarea rows={3} value={situation} maxLength={3000} required onChange={event => setSituation(event.target.value)} /></label>
        </>}
        <label>世界线名称<input value={title} maxLength={100} required onChange={event => setTitle(event.target.value)} /></label>
      </section>
      <section aria-labelledby="preparation-roles-heading">
        <h2 id="preparation-roles-heading">角色与知情</h2>
        <RoleRoster people={choices} cast={cast} candidates={candidates} scenery={places} materials={materials}
          drafts={roleDrafts} disabled={saving} onRoster={(group, ids) => {
            if (group === 'cast') {
              setCast(ids);
              setOrdinary(rows => rows.map(row => ({ ...row, witnesses: row.witnesses.filter(id => ids.includes(id)) })));
              setUnknowns(rows => rows.map(row => ({ ...row, knowers: row.knowers.filter(id => ids.includes(id)) })));
            } else setCandidates(ids);
          }}
          onRole={(id, value) => setRoleDrafts(rows => ({ ...rows, [id]: value }))} />
        {referencePeople.length > 0 && <p className="opening-note">仅作背景的人物 · {referencePeople.map(person => person.title).join('、')}</p>}
        <label>作者观察问题（可选）<textarea rows={2} maxLength={1000} value={observationQuestion}
          onChange={event => setObservationQuestion(event.target.value)} /></label>
        <p className="opening-note">背景、开场说明和观察问题留给作者。展开人物设置，填写可以交给该角色的内容。</p>
        <PremisePreparation people={participants} ordinary={ordinary} unknowns={unknowns} disabled={saving}
          onOrdinary={setOrdinary} onUnknowns={setUnknowns} />
      </section>
      <section aria-labelledby="preparation-rules-heading">
        <h2 id="preparation-rules-heading">开局规则</h2>
        {missingRules.map(id => <p key={id}>{byId.get(id)?.name ?? '原必需规则'}已离开背景范围。
          <Button type="button" onClick={() => setRuleDrafts(({ [id]: _removed, ...remaining }) => remaining)}>从新起点移除这条规则</Button></p>)}
        <OpeningRules rules={rules} places={scenePlaces} items={entities.filter(entity => entity.kind === 'item')}
          holders={[...participants, ...scenePlaces]} drafts={ruleDrafts} disabled={saving} onRule={(id, value) => {
            setRuleDrafts(rows => {
              const next = { ...rows };
              if (value) next[id] = value;
              else delete next[id];
              return next;
            });
          }} />
      </section>
      <section aria-labelledby="preparation-check-heading">
        <h2 id="preparation-check-heading">开局检查</h2>
        <div className="opening-actions">
          <Button type="button" disabled={!payload || checking || saving} onClick={() => void checkOpening()}>
            {checking ? '正在检查…' : '检查开局并预览角色输入'}
          </Button>
          {check && <span role="status">{check.blockers.length ? `${check.blockers.length} 条需要处理` : '开局检查通过'}</span>}
        </div>
        {!payload && <p className="opening-note">{pendingSelections ? '请先处理旧选段。' : '先选择背景、填写开场和世界线名称，并加入参与人物。'}</p>}
        {check && <OpeningInspection check={check} onIssue={locateIssue} citation={source => {
          const row = materialByKey.get(materialKey(source));
          return row ? `依据 · ${row.title} · v${source.version} · ${row.quote}` : `冻结依据 · v${source.version}`;
        }} />}
        {check?.reopen && <ReopenDifferences difference={check.reopen} world={world} />}
      </section>
      <footer className="preparation-save">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {savedStart && <p role="status">已保存「{savedStart.title}」 · <Link className="text-link"
          to={`${worldPath}/simulate?line=${encodeURIComponent(savedStart.line)}`}>打开已保存起点</Link></p>}
        <p>保存后停在起点，可重开核对冻结范围。保存过程没有模型调用。</p>
        <div className="opening-actions">
          <Button type="submit" variant="primary" disabled={!ready || checking || saving}>{saving ? '正在保存…' : '保存起点'}</Button>
          <Button type="submit" value="stay" disabled={!ready || checking || saving}>保存并继续准备</Button>
        </div>
      </footer>
    </form>}
  </main>;
}
