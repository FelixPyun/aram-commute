'use client';
import { useEffect, useState } from 'react';

const EMPTY = {
  commute: [{ route: '514-1' }, { route: '38' }],
  returnHome: [{ route: '514-1' }, { route: '65-1' }, { route: '58' }],
};

const routeClass = {
  '514-1': 'route-green',
  '38': 'route-blue',
  '65-1': 'route-blue',
  '58': 'route-blue',
};

function etaLabel(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return '도착정보 없음';
  if (sec <= 90) return '곧 도착';
  return `${Math.max(1, Math.ceil(sec / 60))}분 후`;
}

function FirstBus({ bus, destination }) {
  const hasEta = bus.etaSec != null;
  return (
    <div className="first-bus-block">
      <div className="block-title"><span className="step-pill blue">1</span> 첫 번째 버스</div>
      <div className={`eta-big ${hasEta && bus.etaSec <= 180 ? 'soon' : ''}`}>{etaLabel(bus.etaSec)}</div>
      <div className="fact-grid">
        <div className="fact-item">
          <span>현재 위치</span>
          <strong>🚌 {bus.currentStopName || '위치 확인 중'}</strong>
        </div>
        <div className="fact-item align-right">
          <span>{destination}까지</span>
          <strong>{bus.stopsAway != null ? `${bus.stopsAway}정거장` : '-'}</strong>
        </div>
      </div>
    </div>
  );
}

function NextBus({ bus, destination }) {
  return (
    <div className="next-bus-block">
      <div className="block-title green-title"><span className="step-pill green">2</span> 다음 버스</div>
      {bus.nextBusFound ? (
        <div className="next-facts">
          <div className="next-stop">
            <span>현재 위치</span>
            <strong>🚌 {bus.nextCurrentStopName || '정류장명 확인 중'}</strong>
          </div>
          <div className="next-count">
            <span>{destination}까지</span>
            <strong>{bus.nextStopsAway != null ? `${bus.nextStopsAway}정거장 남음` : '-'}</strong>
          </div>
        </div>
      ) : (
        <div className="next-empty">
          <strong>현재 확인되는 다음 차량이 없습니다.</strong>
          <span>{bus.nextReason || '운행 위치정보가 잡히면 자동으로 표시됩니다.'}</span>
        </div>
      )}
    </div>
  );
}

function BusCard({ bus, destination }) {
  return (
    <article className="bus-card-v13">
      <div className="route-head">
        <div className={`route-badge ${routeClass[bus.route]}`}>{bus.route}</div>
      </div>
      <FirstBus bus={bus} destination={destination} />
      <NextBus bus={bus} destination={destination} />
    </article>
  );
}

function StopView({ type, stopName, stopNo, buses }) {
  const morning = type === 'commute';
  const destination = morning ? '새안의원' : '주안역환승';
  return (
    <section className={`stop-panel ${morning ? 'morning-panel' : 'evening-panel'}`}>
      <div className="stop-heading simple-stop-heading">
        <div>
          <h2>{stopName}</h2>
          <p>정류장 번호 {stopNo}</p>
        </div>
      </div>
      <div className="bus-stack">
        {buses.map(bus => <BusCard key={bus.route} bus={bus} destination={destination} />)}
      </div>
    </section>
  );
}

export default function Home() {
  const [data, setData] = useState(EMPTY);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState(null);
  const [mode, setMode] = useState(() => {
    const hour = new Date().getHours();
    return hour >= 4 && hour < 15 ? 'commute' : 'returnHome';
  });

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/arrivals', { cache: 'no-store' });
      const json = await res.json();
      setMeta(json);
      if (!res.ok || !json.ok) throw new Error(json.error || json?.diagnostics?.routeErrors?.[0] || `실시간 조회 실패 (HTTP ${res.status})`);
      setData({ commute: json.commute, returnHome: json.returnHome });
      setLive(true);
      setUpdatedAt(json.fetchedAt ? new Date(json.fetchedAt) : new Date());
    } catch (e) {
      setLive(false);
      setError(e instanceof Error ? e.message : '실시간 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20000);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    return () => clearInterval(id);
  }, []);

  return (
    <main className="page-shell v13-shell">
      <header className="topbar v13-topbar">
        <div className="brand-center">
          <h1>🚌 아람출퇴근</h1>
          <div className="update-line">
            <span className={live ? 'dot live' : loading ? 'dot loading' : 'dot error'} />
            {loading && !updatedAt
              ? '실시간 정보 연결 중...'
              : live
                ? `20초 자동 갱신 · ${updatedAt?.toLocaleTimeString('ko-KR', { hour12: false })}`
                : '연결 실패'}
          </div>
        </div>
        <button className="icon-btn" onClick={refresh} disabled={loading} aria-label="새로고침">↻</button>
      </header>

      <div className="mode-tabs" role="tablist" aria-label="출퇴근 선택">
        <button className={mode === 'commute' ? 'active' : ''} onClick={() => setMode('commute')}>☀️ 출근</button>
        <button className={mode === 'returnHome' ? 'active' : ''} onClick={() => setMode('returnHome')}>🌙 퇴근</button>
      </div>

      {error && (
        <div className="error-panel">
          <strong>⚠️ 실시간 버스정보를 불러오지 못했습니다.</strong>
          <span>{error}</span>
        </div>
      )}

      {mode === 'commute' ? (
        <StopView type="commute" stopName="새안의원 정류장" stopNo="37256" buses={data.commute} />
      ) : (
        <StopView type="returnHome" stopName="주안역환승정류장" stopNo="37503" buses={data.returnHome} />
      )}

      <div className={`live-note ${live ? 'ok' : 'bad'}`}>
        {live ? `● 실시간 연결 · 인천 BIS · ${meta?.elapsedMs ?? '-'}ms` : '● 인천 BIS 연결 안 됨'}
      </div>
    </main>
  );
}
