import { Button, ErrorNotice } from "../../components/ui";
import type { PerceptionLayout } from "./api";

interface PlaceChoice {
  id: string;
  name: string;
}
interface StartingRole extends PlaceChoice {
  location: string;
}
interface ZoneDraft {
  id: string;
  name: string;
  place: string;
}
type LinkDraft = PerceptionLayout["links"][number] & { id: string };
export interface PerceptionDraft {
  enabled: boolean;
  zones: ZoneDraft[];
  positions: Record<string, string>;
  links: LinkDraft[];
}

export function preparePerception(
  draft: PerceptionDraft,
  places: PlaceChoice[],
  people: StartingRole[],
): { layout?: PerceptionLayout; error?: string } {
  if (!draft.enabled) return {};

  const placeIds = new Set(places.map((place) => place.id));
  const namedZones = new Map<string, ZoneDraft>();
  const names = new Set(placeIds);
  for (const zone of draft.zones) {
    const name = zone.name.trim();
    if (!name) return { error: "请填写区位名称。" };
    if (names.has(name)) return { error: `区位名称「${name}」重复，请改用不同的名称。` };
    if (!placeIds.has(zone.place)) return { error: `请为区位「${name}」选择所在地点。` };
    names.add(name);
    namedZones.set(zone.id, { ...zone, name });
  }

  const positions: Record<string, string> = {};
  for (const person of people) {
    const id = draft.positions[person.id];
    if (!id) continue;
    const zone = namedZones.get(id);
    if (!zone || zone.place !== person.location) {
      return { error: `请重新选择${person.name}在当前地点的起点区位。` };
    }
    positions[person.id] = zone.name;
  }

  const areaName = (id: string) => namedZones.get(id)?.name ?? (placeIds.has(id) ? id : undefined);
  const pairs = new Set<string>();
  const links: PerceptionLayout["links"] = [];
  for (const { source, observer, sight, sound } of draft.links) {
    const eventArea = areaName(source);
    const observerArea = areaName(observer);
    if (!eventArea || !observerArea) return { error: "请为每条观察关系选择发生区位和观察区位。" };
    if (eventArea === observerArea) return { error: "同一区位内直接观察，请为跨区关系选择不同的区位。" };
    if (!sight && !sound) return { error: "请为每条观察关系选择能看见或能听见声响。" };
    const key = JSON.stringify([observerArea, eventArea]);
    if (pairs.has(key)) return { error: "同方向的观察关系只需设置一条。" };
    pairs.add(key);
    links.push({ source: eventArea, observer: observerArea, sight, sound });
  }

  return { layout: { zones: Object.fromEntries([...namedZones.values()].map((zone) => [zone.name, zone.place])), positions, links } };
}

export function PerceptionSummary({
  layout,
  nameOf,
}: {
  layout: PerceptionLayout;
  nameOf: (id: string) => string;
}) {
  return (
    <div className="academy-perception-summary">
      <h3>区位与感知</h3>
      {Object.keys(layout.zones).length > 0 && (
        <ul>{Object.entries(layout.zones).map(([name, place]) => <li key={name}>{name} · {nameOf(place)}</li>)}</ul>
      )}
      {Object.keys(layout.positions).length > 0 && (
        <p>指定起点 · {Object.entries(layout.positions).map(([actor, zone]) => `${nameOf(actor)}在${zone}`).join("、")}</p>
      )}
      {layout.links.length > 0 ? (
        <ul>{layout.links.map(({ source, observer, sight, sound }, index) => (
          <li key={index}>在{nameOf(observer)}可{[sight && "看见", sound && "听见声响"].filter(Boolean).join("、")} · 事件发生在{nameOf(source)}</li>
        ))}</ul>
      ) : <p>已启用同一区位的感知。跨区关系尚未设置。</p>}
    </div>
  );
}

export function PerceptionPreparation({
  value,
  onChange,
  people,
  places,
  error,
}: {
  value: PerceptionDraft;
  onChange: (draft: PerceptionDraft) => void;
  people: StartingRole[];
  places: PlaceChoice[];
  error?: string;
}) {
  const areaChoices = [
    ...places.map((place) => ({ id: place.id, label: `${place.name}（地点默认）` })),
    ...value.zones.map((zone, index) => ({ id: zone.id, label: zone.name.trim() || `未命名区位 ${index + 1}` })),
  ];
  function updateZone(id: string, change: Partial<ZoneDraft>) {
    onChange({ ...value, zones: value.zones.map((zone) => zone.id === id ? { ...zone, ...change } : zone) });
  }
  function removeZone(id: string) {
    onChange({
      ...value,
      zones: value.zones.filter((zone) => zone.id !== id),
      positions: Object.fromEntries(Object.entries(value.positions).filter(([, area]) => area !== id)),
      links: value.links.filter((link) => link.source !== id && link.observer !== id),
    });
  }
  function updateLink(id: string, change: Partial<LinkDraft>) {
    onChange({ ...value, links: value.links.map((link) => link.id === id ? { ...link, ...change } : link) });
  }

  return (
    <details className="academy-start-summary academy-perception">
      <summary>区位与感知（可选）</summary>
      <label className="academy-check">
        <input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />
        按区位判断视线和声音
      </label>
      {value.enabled && (
        <div className="academy-perception-editor">
          <p>同一区位内可以看见交接、听清发言。跨区声音只提供声响，通行沿用现有出口规则。</p>
          <section aria-label="区位" className="academy-perception-section">
            <h3>区位</h3>
            {value.zones.map((zone, index) => (
              <fieldset key={zone.id} className="academy-perception-row">
                <legend>{zone.name.trim() || `新建区位 ${index + 1}`}</legend>
                <div className="academy-perception-fields">
                  <label>区位名称
                    <input value={zone.name} maxLength={120} onChange={(event) => updateZone(zone.id, { name: event.target.value })} />
                  </label>
                  <label>所在地点
                    <select value={zone.place} onChange={(event) => updateZone(zone.id, { place: event.target.value })}>
                      {places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
                    </select>
                  </label>
                </div>
                <Button variant="ghost" onClick={() => removeZone(zone.id)}>删除区位及相关设置</Button>
              </fieldset>
            ))}
            <Button disabled={!places.length || value.zones.length >= 32} onClick={() => onChange({
              ...value, zones: [...value.zones, { id: crypto.randomUUID(), name: "", place: places[0].id }],
            })}>添加区位</Button>
          </section>
          {value.zones.length > 0 && people.length > 0 && (
            <section aria-label="角色起点区位" className="academy-perception-section">
              <h3>角色起点区位</h3>
              <div className="academy-perception-fields">
                {people.map((person) => {
                  const choices = value.zones.filter((zone) => zone.place === person.location);
                  const selected = value.positions[person.id] || "";
                  return <label key={person.id}>{person.name}的起点区位
                    <select value={selected} onChange={(event) => onChange({
                      ...value, positions: { ...value.positions, [person.id]: event.target.value },
                    })}>
                      <option value="">{places.find((place) => place.id === person.location)?.name}（地点默认）</option>
                      {selected && !choices.some((zone) => zone.id === selected) && <option value={selected} disabled>原区位与当前地点不符</option>}
                      {choices.map((zone) => <option key={zone.id} value={zone.id}>{zone.name.trim() || "未命名区位"}</option>)}
                    </select>
                  </label>;
                })}
              </div>
            </section>
          )}
          <section aria-label="观察关系" className="academy-perception-section">
            <h3>观察关系</h3>
            {value.links.map((link, index) => (
              <fieldset key={link.id} className="academy-perception-row">
                <legend>观察关系 {index + 1}</legend>
                <div className="academy-perception-fields">
                  <label>事件发生区位
                    <select value={link.source} onChange={(event) => updateLink(link.id, { source: event.target.value })}>
                      <option value="">选择事件发生区位</option>
                      {areaChoices.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}
                    </select>
                  </label>
                  <label>从哪里观察
                    <select value={link.observer} onChange={(event) => updateLink(link.id, { observer: event.target.value })}>
                      <option value="">选择观察区位</option>
                      {areaChoices.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="academy-perception-actions">
                  <label className="academy-check"><input type="checkbox" checked={link.sight} onChange={(event) => updateLink(link.id, { sight: event.target.checked })} />能看见</label>
                  <label className="academy-check"><input type="checkbox" checked={link.sound} onChange={(event) => updateLink(link.id, { sound: event.target.checked })} />能听见声响</label>
                  <Button variant="ghost" onClick={() => onChange({ ...value, links: value.links.filter((entry) => entry.id !== link.id) })}>删除关系</Button>
                </div>
              </fieldset>
            ))}
            <Button disabled={areaChoices.length < 2 || value.links.length >= 128} onClick={() => onChange({
              ...value, links: [...value.links, { id: crypto.randomUUID(), source: "", observer: "", sight: false, sound: false }],
            })}>添加观察关系</Button>
          </section>
          {error && <ErrorNotice>{error}</ErrorNotice>}
        </div>
      )}
    </details>
  );
}
