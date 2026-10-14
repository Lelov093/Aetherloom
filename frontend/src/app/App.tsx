import { lazy, Suspense, useEffect, useState } from "react";
import {
  Link,
  Route,
  Routes,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCheck,
  Compass,
  Globe2,
  Home,
  Orbit,
  PenLine,
  Sparkles,
  Search,
} from "lucide-react";
import { Button, ErrorNotice } from "../components/ui";
import { WorldLibrary } from "../features/worlds/WorldLibrary";
import { WorldHome } from "../features/worlds/WorldHome";
import { worldApi, type World } from "../features/worlds/api";
import { CreationWorkspace } from "../features/creation/CreationWorkspace";
import {
  WorldObjects,
  EntityFullView,
} from "../features/creation/WorldObjects";
import { WorldSearch } from "../features/creation/WorldSearch";
import { ObjectBrowser } from "../features/objects/ObjectBrowser";
import {useWorkspaceResume,workspaceDestination} from './workspaceResume';
import { ReviewWorkspace } from "../features/review/ReviewWorkspace";
import {reviewApi} from '../features/review/api';
import { ActivityNotice, useReviewActivity } from '../features/review/ReviewActivity';
import { CanonRecords } from "../features/review/CanonRecords";
import { SourceReader } from '../features/creation/SourceReader';
const SimulationWorkspace=lazy(()=>import('../features/simulation/SimulationWorkspace').then(m=>({default:m.SimulationWorkspace})));
const SimulationReview=lazy(()=>import('../features/simulation/SimulationReview').then(m=>({default:m.SimulationReview})));
const ExploreWorkspace=lazy(()=>import('../features/explore/ExploreWorkspace').then(m=>({default:m.ExploreWorkspace})));
import {
  WorkspaceContext,
  type ContextCrumb,
} from "../components/WorkspaceContext";

function Shell({
  world,
  children,
}: {
  world?: World;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const reviewActivity = useReviewActivity(world?.id);
  useWorkspaceResume(world?.id);
  const [searching, setSearching] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [trail, setTrail] = useState<ContextCrumb[]>([]);
  const [inspection,setInspection]=useState(false);
  useEffect(()=>{let alive=true;void reviewApi.provider().then(p=>{if(alive)setInspection(p.disabled)}).catch(()=>{});return()=>{alive=false}},[]);
  return (
    <div
      className="application"
      data-create-editor={Boolean(world && location.pathname === `/worlds/${world.id}/create`)}
      data-simulation-live={Boolean(world && location.pathname === `/worlds/${world.id}/simulate` && new URLSearchParams(location.search).has('session'))}
      data-workspace={
        location.pathname.includes("/review") ? "review" : location.pathname.includes('/explore') ? 'explore' : location.pathname.includes('/simulate') ? 'simulate' : "create"
      }
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          const main = document.getElementById("main-content");
          main?.setAttribute("tabindex", "-1");
          main?.focus();
        }}
      >
        跳到主要内容
      </a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Aetherloom 世界库">
          <span className="brand-symbol">
            <Orbit size={30} strokeWidth={1.4} />
          </span>
          <span>
            Aetherloom<small>编织世界，让想象生长</small>
          </span>
        </Link>
        <div className="history-controls">
          <Button
            variant="ghost"
            aria-label="后退"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={18} />
          </Button>
          <Button variant="ghost" aria-label="前进" onClick={() => navigate(1)}>
            <ArrowRight size={18} />
          </Button>
        </div>
        <nav className="breadcrumb" aria-label="当前路径">
          {world && location.pathname.includes('/create') ? <details className="create-navigation">
            <summary>创作</summary>
            <div onClick={event => { if ((event.target as HTMLElement).closest('a')) event.currentTarget.parentElement?.removeAttribute('open'); }}>
              <Link to={`/worlds/${world.id}/create`}>作品目录</Link>
              <Link to={`/worlds/${world.id}/create?view=library`}>全部资料</Link>
              <Link to={`/worlds/${world.id}/create/objects`}>世界对象</Link>
            </div>
          </details> : <span>
            {world
              ? location.pathname.includes("/review")
                ? "审阅"
                : location.pathname.includes('/explore') ? '探索' : location.pathname.includes('/simulate') ? '模拟' : location.pathname.includes("/create")
                  ? "创作"
                  : "世界首页"
              : "世界库"}
          </span>}
          {world && (
            <>
              <span className="crumb-divider world-crumb-divider">/</span>
              <Link className="world-crumb" to={`/worlds/${world.id}`}>
                {world.name}
              </Link>
            </>
          )}
          {trail.length > 2 && <details className="breadcrumb-ancestors">
            <summary aria-label="查看路径层级" title="查看完整路径">…</summary>
            <div onClick={event => { if ((event.target as HTMLElement).closest('a')) event.currentTarget.parentElement?.removeAttribute('open'); }}>
              {trail.slice(1,-1).map((crumb,index)=>crumb.to?<Link key={index} title={crumb.label} to={crumb.to}>{crumb.label}</Link>:<span key={index}>{crumb.label}</span>)}
            </div>
          </details>}
          {trail.map((crumb, index) => (
            <span className={`context-crumb ${index>0&&index<trail.length-1?'ancestor-crumb':''}`} key={`${index}-${crumb.label}`}>
              <span className="crumb-divider">/</span>
              {crumb.to ? (
                <Link title={crumb.label} to={crumb.to}>{crumb.label}</Link>
              ) : (
                <strong title={crumb.label} aria-current="page">{crumb.label}</strong>
              )}
            </span>
          ))}
        </nav>
        <div id="workspace-header-slot" className="workspace-header-slot" />
        <div className="topbar-context">
          {world && <ActivityNotice key={world.id} world={world.id} {...reviewActivity} />}
          {world && (
            <Button variant="ghost" aria-label="浏览世界对象" onClick={() => setBrowsing(true)}>
              <BookOpen size={18} />
              <span className="global-search-copy">浏览世界</span>
            </Button>
          )}
          {world && (
            <Button
              variant="ghost"
              aria-label="全局搜索"
              onClick={() => setSearching(true)}
            >
              <Search size={18} />
              <span className="global-search-copy">搜索人物、地点、正文…</span>
              <kbd>搜索</kbd>
            </Button>
          )}
          {world && (
            <span className="branch-chip">
              <Globe2 size={15} />
              {world.archived ? "已归档" : location.pathname.includes('/simulate') ? '独立世界线' : "Working Canon"}
            </span>
          )}
          <span className="local-status">
            <span className="local-dot" />
            {inspection?'检查副本 · AI 已停用':'本机工作台'}
          </span>
        </div>
      </header>
      <aside className="mode-rail">
        <nav aria-label="工作区">
          <Link
            to={world ? `/worlds/${world.id}` : "/"}
            className={`rail-item ${!location.pathname.includes("/create") && !location.pathname.includes("/review") && !location.pathname.includes('/simulate') && !location.pathname.includes('/explore') ? "active" : ""}`}
            aria-current={
              !location.pathname.includes("/create") &&
              !location.pathname.includes('/simulate') &&
              !location.pathname.includes('/explore') &&
              !location.pathname.includes("/review")
                ? "page"
                : undefined
            }
          >
            <Home size={22} strokeWidth={1.5} />
            <span>首页</span>
          </Link>
          {world && !world.archived ? (
            <Link
              to={workspaceDestination(world.id,'create')}
              className={`rail-item ${location.pathname.includes("/create") ? "active" : ""}`}
              aria-current={
                location.pathname.includes("/create") ? "page" : undefined
              }
            >
              <PenLine size={22} strokeWidth={1.5} />
              <span>创作</span>
            </Link>
          ) : (
            <button className="rail-item" disabled>
              <PenLine size={22} />
              <span>创作</span>
            </button>
          )}
          {world&&!world.archived&&<Link to={workspaceDestination(world.id,'simulate')} className={`rail-item ${location.pathname.includes('/simulate')?'active':''}`} aria-current={location.pathname.includes('/simulate')?'page':undefined}><Orbit size={22} strokeWidth={1.5}/><span>模拟</span></Link>}
          {world ? <Link to={workspaceDestination(world.id,'explore')} className={`rail-item ${location.pathname.includes('/explore') ? 'active' : ''}`} aria-current={location.pathname.includes('/explore') ? 'page' : undefined}><Compass size={22} strokeWidth={1.5}/><span>探索</span></Link> : <button className="rail-item" disabled><Compass size={22}/><span>探索</span></button>}
          {world ? (
            <Link
              to={workspaceDestination(world.id,'review')}
              className={`rail-item ${location.pathname.includes("/review") ? "active" : ""}`}
              aria-current={
                location.pathname.includes("/review") ? "page" : undefined
              }
            >
              <CheckCheck size={22} strokeWidth={1.5} />
              <span>审阅</span>
              {reviewActivity.activity && reviewActivity.activity.pending + reviewActivity.activity.simulation_pending > 0 && <span className="review-badge" aria-label={`${reviewActivity.activity.pending + reviewActivity.activity.simulation_pending} 项待审阅`}>{reviewActivity.activity.pending + reviewActivity.activity.simulation_pending}</span>}
            </Link>
          ) : (
            <button className="rail-item" disabled>
              <CheckCheck size={22} />
              <span>审阅</span>
            </button>
          )}
          <div className="rail-divider" />
          <Link to="/" className="rail-item" aria-label="打开世界库">
            <BookOpen size={22} strokeWidth={1.5} />
            <span>世界库</span>
          </Link>
        </nav>
        <div className="rail-bottom">
          <Sparkles size={18} strokeWidth={1.3} />
          <span>
            想象
            <br />
            有迹可循
          </span>
        </div>
      </aside>
      <div className="workspace">
        <WorkspaceContext.Provider value={setTrail}>
          {children}
        </WorkspaceContext.Provider>
      </div>
      {searching && world && (
        <WorldSearch world={world.id} onClose={() => setSearching(false)} />
      )}
      {browsing && world && (
        <ObjectBrowser world={world.id} browse onClose={() => setBrowsing(false)} onPick={object => {
          setBrowsing(false);
          navigate(object.to);
        }} />
      )}
    </div>
  );
}

function WorldRoute({
  view = "home",
}: {
  view?: "home" | "create" | "objects" | "entity" | "review" | "records" | "source" | 'simulate' | 'sim-review' | 'explore';
}) {
  const { id } = useParams();
  const [world, setWorld] = useState<World>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setWorld(undefined);
    setError("");
    if (id)
      worldApi
        .get(id)
        .then((value) => {
          if (active) setWorld(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [id, retry]);
  return (
    <Shell world={world}>
      {error ? (
        <main id="main-content" className="page loading-state">
          <ErrorNotice>{error}</ErrorNotice>
          <Button onClick={() => setRetry((n) => n + 1)}>重新载入</Button>
          <Link className="text-link" to="/">
            返回世界库
          </Link>
        </main>
      ) : world ? (
        view === 'explore' ? <Suspense fallback={<main id="main-content" className="page loading-state" role="status">正在打开世界关系…</main>}><ExploreWorkspace key={world.id} world={world.id}/></Suspense> : view === 'simulate' ? <Suspense fallback={<p role="status">正在打开世界模拟…</p>}><SimulationWorkspace key={world.id} world={world.id}/></Suspense> : view === 'sim-review' ? <Suspense fallback={<p role="status">正在打开模拟审阅…</p>}><SimulationReview key={world.id} world={world.id}/></Suspense> : view === "source" ? (
          <SourceReader world={world.id}/>
        ) : view === "review" ? (
          <ReviewWorkspace key={world.id} world={world.id} />
        ) : view === "records" ? (
          <CanonRecords key={world.id} world={world.id} />
        ) : view === "create" ? (
          <CreationWorkspace key={world.id} world={world.id} />
        ) : view === "objects" ? (
          <WorldObjects key={world.id} world={world.id} />
        ) : view === "entity" ? (
          <EntityFullView key={world.id} world={world.id} />
        ) : (
          <WorldHome key={world.id} world={world} onUpdated={setWorld} />
        )
      ) : (
        <main id="main-content" className="page loading-state" role="status">
          正在打开世界…
        </main>
      )}
    </Shell>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Shell>
            <WorldLibrary />
          </Shell>
        }
      />
      <Route path="/worlds/:id" element={<WorldRoute />} />
      <Route path="/worlds/:id/create" element={<WorldRoute view="create" />} />
      <Route path="/worlds/:id/create/sources/:sourceId" element={<WorldRoute view="source"/>}/>
      <Route path="/worlds/:id/create/source" element={<WorldRoute view="source"/>}/>
      <Route path="/worlds/:id/review" element={<WorldRoute view="review" />} />
      <Route path="/worlds/:id/review/simulation" element={<WorldRoute view="sim-review"/>}/>
      <Route path="/worlds/:id/simulate" element={<WorldRoute view="simulate"/>}/>
      <Route path="/worlds/:id/explore" element={<WorldRoute view="explore"/>}/>
      <Route
        path="/worlds/:id/create/records"
        element={<WorldRoute view="records" />}
      />
      <Route
        path="/worlds/:id/create/objects"
        element={<WorldRoute view="objects" />}
      />
      <Route
        path="/worlds/:id/create/objects/:entityId"
        element={<WorldRoute view="entity" />}
      />
      <Route
        path="*"
        element={
          <Shell>
            <main id="main-content" className="page loading-state">
              <h1>这里还没有留下足迹</h1>
              <Link className="text-link" to="/">
                返回世界库
              </Link>
            </main>
          </Shell>
        }
      />
    </Routes>
  );
}
