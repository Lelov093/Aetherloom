import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, ErrorNotice } from '../../components/ui';
import { mapPath, mapsApi } from './api';
import { withMoment, type StoryMoment } from '../periods/api';

export function LocationMaps({ world, entity, moment }: { world: string; entity: string; moment?: StoryMoment }) {
  const [positions, setPositions] = useState<Awaited<ReturnType<typeof mapsApi.positions>>>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    mapsApi.positions(world, entity).then(value => { if (active) setPositions(value); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [world, entity, retry]);
  return <section className="location-maps">
    <h2>地图位置</h2>
    {error ? <><ErrorNotice>{error}</ErrorNotice><Button onClick={() => setRetry(n => n + 1)}>重新读取地图位置</Button></> :
      !positions ? <p role="status">正在读取地图位置…</p> :
        positions.length ? <ul>{positions.map(item => <li key={item.feature_id}>
          <Link className="text-link" to={withMoment(mapPath(world, item.map_id, { id: item.feature_id, locate: true }), moment)}>
            <MapPin size={16}/><span>在「{item.map_title}」定位{item.name}</span>
          </Link>
        </li>)}</ul> : <><p>这张卡还没有地图标注。</p><Link className="text-link" to={mapPath(world)}>打开作者地图 →</Link></>}
  </section>;
}
