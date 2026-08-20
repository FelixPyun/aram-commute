import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// v0.19: 정류장 전체 도착정보는 정류장당 1회만 조회합니다.
// 2개 정류장 + 4개 고유 노선 위치조회 = 한 갱신당 최대 6회 호출입니다.
const ARRIVAL_ENDPOINT = 'https://apis.data.go.kr/6280000/busArrivalService/getAllRouteBusArrivalList';
const LOCATION_ENDPOINT = 'https://apis.data.go.kr/6280000/busLocationService/getBusRouteLocation';

const ROUTE_IDS = { '514-1':'165000076', '38':'165000037', '65-1':'165000046', '58':'161000007' };
const STOPS = {
  commute:{ label:'새안의원 정류장', stopNo:'37256', bstopId:'163000256', routes:['514-1','38'] },
  returnHome:{ label:'주안역환승정류장', stopNo:'37503', bstopId:'163000503', routes:['514-1','65-1','58'] },
};

const parser = new XMLParser({ ignoreAttributes:false, trimValues:true, parseTagValue:false, parseAttributeValue:false });

const MIN_REQUEST_INTERVAL_MS = 320; // 약 3회/초 이하로 직렬화
const RESPONSE_CACHE_MS = 10000;
let apiQueue = Promise.resolve();
let lastApiStartedAt = 0;
let cachedResponse = null;
let cachedAt = 0;
let inFlight = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeServiceKey(raw){ if(!raw)return ''; try{return decodeURIComponent(raw.trim())}catch{return raw.trim()} }
function pick(obj,...keys){ if(!obj||typeof obj!=='object')return undefined; for(const key of keys){ if(obj[key]!=null)return obj[key]; const f=Object.keys(obj).find(k=>k.toLowerCase()===key.toLowerCase()); if(f)return obj[f]; } }
function collectObjects(v,p,out=[]){ if(Array.isArray(v)){v.forEach(x=>collectObjects(x,p,out));return out} if(!v||typeof v!=='object')return out; if(p(v))out.push(v); Object.values(v).forEach(x=>collectObjects(x,p,out)); return out; }
function findHeader(v){ if(!v||typeof v!=='object')return null; const code=pick(v,'resultCode','RESULTCODE'),msg=pick(v,'resultMsg','RESULTMSG'); if(code!=null||msg!=null)return{code:String(code??''),msg:String(msg??'')}; for(const c of Object.values(v)){const f=findHeader(c);if(f)return f} return null; }

function queuedFetch(url, options){
  const task = apiQueue.then(async () => {
    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastApiStartedAt));
    if (wait) await sleep(wait);
    lastApiStartedAt = Date.now();
    return fetch(url, options);
  });
  apiQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function requestXml(endpoint,params,label){
  const rawKey=process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  const decodedKey=normalizeServiceKey(rawKey);
  if(!rawKey) throw new Error('공공데이터 인증키가 설정되지 않았습니다.');

  const attempts=[];
  const seen=new Set();
  const add=(name,paramName,key,manual=false)=>{
    if(!key) return;
    const sig=`${paramName}|${key}|${manual}`;
    if(seen.has(sig)) return;
    seen.add(sig); attempts.push({name,paramName,key,manual});
  };
  add('decoded-ServiceKey','ServiceKey',decodedKey,false);
  add('decoded-serviceKey','serviceKey',decodedKey,false);
  add('encoded-ServiceKey','ServiceKey',rawKey,true);
  add('encoded-serviceKey','serviceKey',rawKey,true);

  let lastError='';
  for(const attempt of attempts){
    let url;
    if(attempt.manual){
      const q=Object.entries(params).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
      url=`${endpoint}?${attempt.paramName}=${attempt.key}${q?`&${q}`:''}`;
    }else{
      const u=new URL(endpoint);
      u.searchParams.set(attempt.paramName,attempt.key);
      Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));
      url=u.toString();
    }

    try{
      const res=await queuedFetch(url,{cache:'no-store',headers:{Accept:'application/xml,text/xml,*/*'},signal:AbortSignal.timeout(8000)});
      const text=await res.text();

      // 429는 인증 형식 문제가 아니므로 다른 키 조합을 재시도하지 않습니다.
      // 재시도하면 같은 순간에 호출량만 더 늘어납니다.
      if(res.status===429 || /LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR|초당 서비스 요청제한 횟수 초과/i.test(text)){
        throw new Error(`${label} 호출 제한 초과(429) · 잠시 후 자동 갱신됩니다.`);
      }

      const authError=/SERVICE_KEY_IS_NOT_REGISTERED_ERROR|등록되지 않은 서비스키|returnReasonCode[^0-9]*30/i.test(text);
      const accessError=/SERVICE_ACCESS_DENIED_ERROR|서비스 접근거부|returnReasonCode[^0-9]*(?:20|22)/i.test(text);
      if(authError||accessError){ lastError=`${label} 인증 오류 (${attempt.name})`; continue; }
      if(!res.ok){ lastError=`${label} HTTP ${res.status}: ${text.slice(0,220)}`; continue; }

      const xml=parser.parse(text);
      const h=findHeader(xml);
      if(h?.code==='4') return {xml,noResult:true,attempt:attempt.name};
      if(h?.code&&!['0','00','1'].includes(h.code)){ lastError=`${label} API 오류 ${h.code}: ${h.msg||'원인 미상'}`; continue; }
      return {xml,noResult:false,attempt:attempt.name};
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      if(/호출 제한 초과\(429\)/.test(message)) throw error;
      lastError=`${label} 요청 실패: ${message}`;
    }
  }
  throw new Error(lastError||`${label} API 요청에 실패했습니다.`);
}

function normalizeArrivals(xml){return collectObjects(xml,x=>{const k=Object.keys(x).map(v=>v.toUpperCase());return k.includes('ROUTEID')&&k.includes('ARRIVALESTIMATETIME')}).map(x=>({
  routeId:String(pick(x,'ROUTEID')??'').trim(),busId:String(pick(x,'BUSID')??'').trim(),plate:String(pick(x,'BUS_NUM_PLATE')??'').trim(),
  stopsAway:Number(pick(x,'REST_STOP_COUNT')),etaSec:Number(pick(x,'ARRIVALESTIMATETIME')),latestStopName:String(pick(x,'LATEST_STOP_NAME')??'').trim(),lastBus:String(pick(x,'LASTBUSYN')??'').trim()
})).filter(x=>x.routeId&&Number.isFinite(x.etaSec)&&x.etaSec>=0)}
function normalizeLocations(xml){return collectObjects(xml,x=>{const k=Object.keys(x).map(v=>v.toUpperCase());return k.includes('ROUTEID')&&k.includes('BUSID')&&k.includes('LATEST_STOPSEQ')}).map(x=>({
  routeId:String(pick(x,'ROUTEID')??'').trim(),busId:String(pick(x,'BUSID')??'').trim(),plate:String(pick(x,'BUS_NUM_PLATE')??'').trim(),dirCd:String(pick(x,'DIRCD')??'').trim(),
  latestStopSeq:Number(pick(x,'LATEST_STOPSEQ')),pathSeq:Number(pick(x,'PATHSEQ')),latestStopId:String(pick(x,'LATEST_STOP_ID')??'').trim(),latestStopName:String(pick(x,'LATEST_STOP_NAME')??'').trim(),
})).filter(x=>x.routeId&&x.busId&&Number.isFinite(x.latestStopSeq))}

function locateBuses(first,locations){
  if(!first||!Number.isFinite(first.stopsAway))return{firstLocation:null,next:null,reason:'첫 버스 정보 없음'};
  const matched=locations.find(x=>first.busId&&x.busId===first.busId)||locations.find(x=>first.plate&&x.plate===first.plate);
  if(!matched)return{firstLocation:null,next:null,reason:'첫 버스 차량 위치 매칭 실패'};
  const targetSeq=matched.latestStopSeq+first.stopsAway;
  const same=locations.filter(x=>(!matched.dirCd||!x.dirCd||x.dirCd===matched.dirCd)&&x.busId!==matched.busId);
  const candidates=same.map(x=>({...x,stopsToTarget:targetSeq-x.latestStopSeq})).filter(x=>Number.isFinite(x.stopsToTarget)&&x.stopsToTarget>first.stopsAway).sort((a,b)=>a.stopsToTarget-b.stopsToTarget);
  return{firstLocation:matched,next:candidates[0]||null,targetSeq,reason:candidates.length?null:'뒤따르는 운행 차량 없음'};
}

async function getStopArrivals(stop){
  const r=await requestXml(ARRIVAL_ENDPOINT,{bstopId:stop.bstopId,numOfRows:100,pageNo:1},`${stop.label} 도착정보`);
  return r.noResult?[]:normalizeArrivals(r.xml);
}

async function getRouteLocations(route, locationCache){
  const routeId=ROUTE_IDS[route];
  if(!locationCache.has(routeId)){
    locationCache.set(routeId,
      requestXml(LOCATION_ENDPOINT,{routeId,numOfRows:200,pageNo:1},`${route} 차량위치`)
        .then(r=>({vehicles:r.noResult?[]:normalizeLocations(r.xml).filter(x=>x.routeId===routeId)}))
        .catch(error=>({vehicles:[],error}))
    );
  }
  return locationCache.get(routeId);
}

async function buildRoute(stop,route,stopArrivals,locationCache){
  const routeId=ROUTE_IDS[route];
  const arrivals=stopArrivals.filter(x=>x.routeId===routeId).sort((a,b)=>a.etaSec-b.etaSec);
  const first=arrivals[0]||null;
  const loc=await getRouteLocations(route,locationCache);
  const inferred=!loc.error&&first?locateBuses(first,loc.vehicles):{firstLocation:null,next:null,reason:first?'차량위치 API 미연결':'현재 도착예정 차량 없음'};
  return{
    route,routeId,found:Boolean(first),etaSec:first?.etaSec??null,stopsAway:Number.isFinite(first?.stopsAway)?first.stopsAway:null,
    currentStopName:inferred.firstLocation?.latestStopName||first?.latestStopName||null,currentStopId:inferred.firstLocation?.latestStopId||null,
    nextBusFound:Boolean(inferred.next),nextCurrentStopName:inferred.next?.latestStopName||null,nextCurrentStopId:inferred.next?.latestStopId||null,
    nextStopsAway:Number.isFinite(inferred.next?.stopsToTarget)?inferred.next.stopsToTarget:null,nextBusId:inferred.next?.busId||null,nextPlate:inferred.next?.plate||null,nextReason:inferred.reason||null,
    locationApiStatus:loc.error?'error':'ok',locationApiError:loc.error?(loc.error instanceof Error?loc.error.message:String(loc.error)):null,routeError:null
  };
}

async function buildPayload(){
  const startedAt=Date.now();
  const locationCache=new Map();
  const stopResults={};
  const stopErrors={};

  // 정류장 도착정보 2회는 순차적으로 조회해 순간 호출량을 낮춥니다.
  for(const key of ['commute','returnHome']){
    try{ stopResults[key]=await getStopArrivals(STOPS[key]); }
    catch(error){ stopResults[key]=[]; stopErrors[key]=error instanceof Error?error.message:String(error); }
  }

  const commute=[];
  for(const route of STOPS.commute.routes){ commute.push(await buildRoute(STOPS.commute,route,stopResults.commute,locationCache)); }
  const returnHome=[];
  for(const route of STOPS.returnHome.routes){ returnHome.push(await buildRoute(STOPS.returnHome,route,stopResults.returnHome,locationCache)); }

  if(stopErrors.commute) commute.forEach(x=>x.routeError=stopErrors.commute);
  if(stopErrors.returnHome) returnHome.forEach(x=>x.routeError=stopErrors.returnHome);

  const all=[...commute,...returnHome],hard=all.filter(x=>x.routeError),locErr=all.filter(x=>x.locationApiStatus==='error');
  const ok=hard.length<all.length;
  const routeErrors=hard.map(x=>`${x.route}: ${x.routeError}`).slice(0,5);
  return{
    ok,partial:hard.length>0||locErr.length>0,live:ok,
    source:'인천광역시 버스정보시스템(BIS)',version:'0.19',
    method:'정류장별 도착정보 2회 + 고유노선별 차량위치 4회 · 호출속도 제한 적용',
    commute,returnHome,
    locationApi:{ok:locErr.length===0,errorCount:locErr.length},
    diagnostics:{failedRoutes:hard.length,totalRoutes:all.length,routeErrors,upstreamCallsMax:6,minIntervalMs:MIN_REQUEST_INTERVAL_MS},
    error:!ok?(routeErrors[0]||'전체 노선 실시간 조회에 실패했습니다.'):null,
    fetchedAt:new Date().toISOString(),elapsedMs:Date.now()-startedAt
  };
}

export async function GET(){
  const now=Date.now();
  if(cachedResponse && now-cachedAt<RESPONSE_CACHE_MS){
    return NextResponse.json({...cachedResponse,cacheHit:true},{headers:{'Cache-Control':'private, no-store'}});
  }
  if(!inFlight){
    inFlight=buildPayload().then(payload=>{cachedResponse=payload;cachedAt=Date.now();return payload}).finally(()=>{inFlight=null});
  }
  const payload=await inFlight;
  return NextResponse.json({...payload,cacheHit:false},{headers:{'Cache-Control':'private, no-store'}});
}
