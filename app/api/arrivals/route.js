import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const INCHEON_ARRIVAL_ENDPOINT = 'https://apis.data.go.kr/6280000/busArrivalService/getAllRouteBusArrivalList';
const INCHEON_LOCATION_ENDPOINT = 'https://apis.data.go.kr/6280000/busLocationService/getBusRouteLocation';
const SEOUL_ARRIVAL_ENDPOINT = 'http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll';

const INCHEON_ROUTE_IDS = { '514-1':'165000076', '38':'165000037', '65-1':'165000046', '58':'161000007' };
const INCHEON_STOPS = {
  commute:{ label:'새안의원 정류장', stopNo:'37256', bstopId:'163000256', routes:['514-1','38'] },
  returnHome:{ label:'주안역환승정류장', stopNo:'37503', bstopId:'163000503', routes:['514-1','65-1','58'] },
};

const SEOUL_ROUTE_ID = '116900007';
const SEOUL_ROUTE_NAME = '구로09';
const SEOUL_STOPS = {
  commute: { label:'구로디지털단지역', arsId:'17472', order:28 },
  returnHome: { label:'에이스테크노타워', arsId:'17925', order:31 },
};

// 서울 구로09 정류소 순서. 서울 도착 API의 sectOrd 값을 정류장명으로 바꾸기 위해 사용합니다.
const SEOUL_ROUTE_STOPS = [
  null,
  {name:'동아1차아파트105동',arsId:'17475'}, {name:'신도림중학교',arsId:'17483'}, {name:'우성아파트',arsId:'17831'},
  {name:'신도림역.아이파크아파트',arsId:'17612'}, {name:'동아2차아파트상가',arsId:'17613'}, {name:'대림6차.태영프라자',arsId:'17499'},
  {name:'대림5차아파트.신도림주민센터',arsId:'17508'}, {name:'대림5차아파트702동',arsId:'17517'}, {name:'대림3차아파트',arsId:'17527'},
  {name:'신도림미성아파트',arsId:'17537'}, {name:'월드아파트',arsId:'17547'}, {name:'구로역.구로기계공구상가',arsId:'17147'},
  {name:'구로역·NC신구로점',arsId:'17144'}, {name:'항아리',arsId:'17575'}, {name:'구로보건소',arsId:'17240'},
  {name:'구로고.구로도서관',arsId:'17598'}, {name:'영림중학교',arsId:'17678'}, {name:'구로구민회관',arsId:'17694'},
  {name:'구로구청',arsId:'17708'}, {name:'구로중학교',arsId:'17717'}, {name:'동구로새마을금고',arsId:'17734'},
  {name:'구로시장.남구로시장',arsId:'17744'}, {name:'구로3동주민센터.삼성래미안아파트',arsId:'17773'}, {name:'구로3파출소',arsId:'17838'},
  {name:'에이스테크노타워',arsId:'17889'}, {name:'KEB하나은행',arsId:'17974'}, {name:'구로3동현대아파트',arsId:'17911'},
  {name:'구로디지털단지역',arsId:'17472'}, {name:'구로디지털단지입구(구.사조참치)',arsId:'17481'}, {name:'지밸리비즈플라자.이마트구로점',arsId:'17122'},
  {name:'에이스테크노타워',arsId:'17925'}, {name:'구로3파출소',arsId:'17927'}, {name:'구로3동주민센터.삼성래미안아파트',arsId:'17929'},
  {name:'구로시장.남구로시장',arsId:'17931'}, {name:'동구로새마을금고',arsId:'17933'}, {name:'구로중학교',arsId:'17297'},
  {name:'구로구청',arsId:'17935'}, {name:'강서수도사업소.민원센터',arsId:'17936'}, {name:'영림중학교',arsId:'17937'},
  {name:'구로고.구로도서관',arsId:'17938'}, {name:'구로보건소',arsId:'17863'}, {name:'항아리',arsId:'17940'},
  {name:'구로역·NC신구로점',arsId:'17145'}, {name:'구로역.구로기계공구상가',arsId:'17146'}, {name:'미성아파트',arsId:'17942'},
  {name:'대림1.2차아파트',arsId:'17943'}, {name:'대림5차아파트702동',arsId:'17944'}, {name:'대림5차아파트.신도림주민센터',arsId:'17945'},
  {name:'대림6차.태영프라자',arsId:'17946'}, {name:'신도림역',arsId:'17947'}, {name:'현대우성아파트',arsId:'17948'},
  {name:'동아1차아파트102동',arsId:'17949'}, {name:'동아1차아파트105동',arsId:'17950'},
];

const parser = new XMLParser({ ignoreAttributes:false, trimValues:true, parseTagValue:false, parseAttributeValue:false });
const MIN_REQUEST_INTERVAL_MS = 320;
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
function findIncheonHeader(v){ if(!v||typeof v!=='object')return null; const code=pick(v,'resultCode','RESULTCODE'),msg=pick(v,'resultMsg','RESULTMSG'); if(code!=null||msg!=null)return{code:String(code??''),msg:String(msg??'')}; for(const c of Object.values(v)){const f=findIncheonHeader(c);if(f)return f} return null; }
function findSeoulHeader(v){ if(!v||typeof v!=='object')return null; const code=pick(v,'headerCd'),msg=pick(v,'headerMsg'); if(code!=null||msg!=null)return{code:String(code??''),msg:String(msg??'')}; for(const c of Object.values(v)){const f=findSeoulHeader(c);if(f)return f} return null; }

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

async function requestIncheonXml(endpoint,params,label){
  const rawKey=process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  const decodedKey=normalizeServiceKey(rawKey);
  if(!rawKey) throw new Error('공공데이터 인증키가 설정되지 않았습니다.');
  const attempts=[]; const seen=new Set();
  const add=(name,paramName,key,manual=false)=>{ if(!key)return; const sig=`${paramName}|${key}|${manual}`; if(seen.has(sig))return; seen.add(sig); attempts.push({name,paramName,key,manual}); };
  add('decoded-ServiceKey','ServiceKey',decodedKey,false); add('decoded-serviceKey','serviceKey',decodedKey,false); add('encoded-ServiceKey','ServiceKey',rawKey,true); add('encoded-serviceKey','serviceKey',rawKey,true);
  let lastError='';
  for(const attempt of attempts){
    let url;
    if(attempt.manual){ const q=Object.entries(params).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&'); url=`${endpoint}?${attempt.paramName}=${attempt.key}${q?`&${q}`:''}`; }
    else { const u=new URL(endpoint); u.searchParams.set(attempt.paramName,attempt.key); Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v))); url=u.toString(); }
    try{
      const res=await queuedFetch(url,{cache:'no-store',headers:{Accept:'application/xml,text/xml,*/*'},signal:AbortSignal.timeout(8000)}); const text=await res.text();
      if(res.status===429 || /LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR|초당 서비스 요청제한 횟수 초과/i.test(text)) throw new Error(`${label} 호출 제한 초과(429) · 잠시 후 자동 갱신됩니다.`);
      const authError=/SERVICE_KEY_IS_NOT_REGISTERED_ERROR|등록되지 않은 서비스키|returnReasonCode[^0-9]*30/i.test(text); const accessError=/SERVICE_ACCESS_DENIED_ERROR|서비스 접근거부|returnReasonCode[^0-9]*(?:20|22)/i.test(text);
      if(authError||accessError){ lastError=`${label} 인증 오류 (${attempt.name})`; continue; }
      if(!res.ok){ lastError=`${label} HTTP ${res.status}: ${text.slice(0,220)}`; continue; }
      const xml=parser.parse(text); const h=findIncheonHeader(xml);
      if(h?.code==='4') return {xml,noResult:true,attempt:attempt.name};
      if(h?.code&&!['0','00','1'].includes(h.code)){ lastError=`${label} API 오류 ${h.code}: ${h.msg||'원인 미상'}`; continue; }
      return {xml,noResult:false,attempt:attempt.name};
    }catch(error){ const message=error instanceof Error?error.message:String(error); if(/호출 제한 초과\(429\)/.test(message)) throw error; lastError=`${label} 요청 실패: ${message}`; }
  }
  throw new Error(lastError||`${label} API 요청에 실패했습니다.`);
}

async function requestSeoulXml(){
  const rawKey=(process.env.SEOUL_DATA_GO_KR_SERVICE_KEY || process.env.DATA_GO_KR_SERVICE_KEY || '').trim();
  const decodedKey=normalizeServiceKey(rawKey);
  if(!rawKey) throw new Error('서울 버스 API 인증키가 설정되지 않았습니다.');
  const attempts=[]; const seen=new Set();
  const add=(name,key,manual=false)=>{ if(!key)return; const sig=`${key}|${manual}`; if(seen.has(sig))return; seen.add(sig); attempts.push({name,key,manual}); };
  add('decoded',decodedKey,false); add('encoded',rawKey,true);
  let lastError='';
  for(const attempt of attempts){
    let url;
    if(attempt.manual) url=`${SEOUL_ARRIVAL_ENDPOINT}?serviceKey=${attempt.key}&busRouteId=${SEOUL_ROUTE_ID}`;
    else { const u=new URL(SEOUL_ARRIVAL_ENDPOINT); u.searchParams.set('serviceKey',attempt.key); u.searchParams.set('busRouteId',SEOUL_ROUTE_ID); url=u.toString(); }
    try{
      const res=await queuedFetch(url,{cache:'no-store',headers:{Accept:'application/xml,text/xml,*/*'},signal:AbortSignal.timeout(8000)}); const text=await res.text();
      if(res.status===429 || /LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR|초당 서비스 요청제한 횟수 초과/i.test(text)) throw new Error('서울 버스 API 호출 제한 초과(429) · 잠시 후 자동 갱신됩니다.');
      const authError=/SERVICE_KEY_IS_NOT_REGISTERED_ERROR|등록되지 않은 서비스키|SERVICE_ACCESS_DENIED_ERROR|서비스 접근거부/i.test(text);
      if(authError){ lastError=`서울 버스 API 인증/활용승인 대기 (${attempt.name})`; continue; }
      if(!res.ok){ lastError=`서울 버스도착정보 HTTP ${res.status}: ${text.slice(0,220)}`; continue; }
      const xml=parser.parse(text); const h=findSeoulHeader(xml);
      if(h?.code && h.code!=='0'){ lastError=`서울 버스 API 오류 ${h.code}: ${h.msg||'원인 미상'}`; continue; }
      return xml;
    }catch(error){ const message=error instanceof Error?error.message:String(error); if(/호출 제한 초과\(429\)/.test(message)) throw error; lastError=`서울 버스 API 요청 실패: ${message}`; }
  }
  throw new Error(lastError||'서울 버스 API 요청에 실패했습니다.');
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

async function getStopArrivals(stop){ const r=await requestIncheonXml(INCHEON_ARRIVAL_ENDPOINT,{bstopId:stop.bstopId,numOfRows:100,pageNo:1},`${stop.label} 도착정보`); return r.noResult?[]:normalizeArrivals(r.xml); }
async function getRouteLocations(route, locationCache){
  const routeId=INCHEON_ROUTE_IDS[route];
  if(!locationCache.has(routeId)) locationCache.set(routeId,requestIncheonXml(INCHEON_LOCATION_ENDPOINT,{routeId,numOfRows:200,pageNo:1},`${route} 차량위치`).then(r=>({vehicles:r.noResult?[]:normalizeLocations(r.xml).filter(x=>x.routeId===routeId)})).catch(error=>({vehicles:[],error})));
  return locationCache.get(routeId);
}
async function buildIncheonRoute(stop,route,stopArrivals,locationCache){
  const routeId=INCHEON_ROUTE_IDS[route]; const arrivals=stopArrivals.filter(x=>x.routeId===routeId).sort((a,b)=>a.etaSec-b.etaSec); const first=arrivals[0]||null;
  const loc=await getRouteLocations(route,locationCache); const inferred=!loc.error&&first?locateBuses(first,loc.vehicles):{firstLocation:null,next:null,reason:first?'차량위치 API 미연결':'현재 도착예정 차량 없음'};
  return{route,routeId,provider:'incheon',found:Boolean(first),etaSec:first?.etaSec??null,stopsAway:Number.isFinite(first?.stopsAway)?first.stopsAway:null,currentStopName:inferred.firstLocation?.latestStopName||first?.latestStopName||null,currentStopId:inferred.firstLocation?.latestStopId||null,nextBusFound:Boolean(inferred.next),nextCurrentStopName:inferred.next?.latestStopName||null,nextCurrentStopId:inferred.next?.latestStopId||null,nextStopsAway:Number.isFinite(inferred.next?.stopsToTarget)?inferred.next.stopsToTarget:null,nextBusId:inferred.next?.busId||null,nextPlate:inferred.next?.plate||null,nextReason:inferred.reason||null,locationApiStatus:loc.error?'error':'ok',locationApiError:loc.error?(loc.error instanceof Error?loc.error.message:String(loc.error)):null,routeError:null};
}

function parseArrivalMessageSec(msg){ const text=String(msg||''); if(!text)return null; if(/곧 도착|도착예정|진입/.test(text))return 60; const m=text.match(/(\d+)\s*분(?:\s*(\d+)\s*초)?/); if(m)return Number(m[1])*60+Number(m[2]||0); const s=text.match(/(\d+)\s*초/); return s?Number(s[1]):null; }
function seoulEtaSec(item,n){ const exp=Number(pick(item,`exps${n}`)); if(Number.isFinite(exp)&&exp>0)return exp; const t=Number(pick(item,`traTime${n}`)); if(Number.isFinite(t)&&t>0)return t*60; return parseArrivalMessageSec(pick(item,`arrmsg${n}`)); }
function seoulStopsAway(targetOrd,sectOrd){ const s=Number(sectOrd); if(!Number.isFinite(s)||s<=0)return null; const d=targetOrd-s; return d>=0&&d<=53?d:null; }
function stopNameByOrd(ord){ const n=Number(ord); return Number.isFinite(n)&&SEOUL_ROUTE_STOPS[n]?.name?SEOUL_ROUTE_STOPS[n].name:null; }
function findSeoulItem(xml,stop){
  const items=collectObjects(xml,x=>pick(x,'arsId')!=null&&pick(x,'staOrd')!=null&&pick(x,'rtNm')!=null);
  return items.find(x=>String(pick(x,'arsId')??'').trim()===stop.arsId && String(pick(x,'rtNm')??'').trim()===SEOUL_ROUTE_NAME) || items.find(x=>String(pick(x,'arsId')??'').trim()===stop.arsId) || null;
}
function buildSeoulRoute(item,stop){
  if(!item) return {route:SEOUL_ROUTE_NAME,routeId:SEOUL_ROUTE_ID,provider:'seoul',found:false,etaSec:null,stopsAway:null,currentStopName:null,nextBusFound:false,nextCurrentStopName:null,nextStopsAway:null,nextReason:'현재 도착예정 차량 없음',routeError:null};
  const targetOrd=Number(pick(item,'staOrd'))||stop.order; const sect1=Number(pick(item,'sectOrd1')); const sect2=Number(pick(item,'sectOrd2')); const veh1=String(pick(item,'vehId1')??'').trim(); const veh2=String(pick(item,'vehId2')??'').trim();
  const eta1=seoulEtaSec(item,1); const eta2=seoulEtaSec(item,2); const firstFound=Boolean((veh1&&veh1!=='0')||eta1!=null||sect1>0); const secondFound=Boolean((veh2&&veh2!=='0')||eta2!=null||sect2>0);
  return {route:SEOUL_ROUTE_NAME,routeId:SEOUL_ROUTE_ID,provider:'seoul',found:firstFound,etaSec:eta1,stopsAway:seoulStopsAway(targetOrd,sect1),currentStopName:stopNameByOrd(sect1),currentStopId:SEOUL_ROUTE_STOPS[sect1]?.arsId||null,nextBusFound:secondFound,nextCurrentStopName:stopNameByOrd(sect2),nextCurrentStopId:SEOUL_ROUTE_STOPS[sect2]?.arsId||null,nextStopsAway:seoulStopsAway(targetOrd,sect2),nextBusId:veh2||null,nextPlate:String(pick(item,'plainNo2')??'').trim()||null,nextReason:secondFound?null:(String(pick(item,'arrmsg2')??'').trim()||'뒤따르는 운행 차량 없음'),routeError:null,seoulArrivalMessage1:String(pick(item,'arrmsg1')??'').trim(),seoulArrivalMessage2:String(pick(item,'arrmsg2')??'').trim()};
}

async function buildPayload(){
  const startedAt=Date.now(); const locationCache=new Map(); const stopResults={}; const stopErrors={};
  for(const key of ['commute','returnHome']){ try{stopResults[key]=await getStopArrivals(INCHEON_STOPS[key]);}catch(error){stopResults[key]=[];stopErrors[key]=error instanceof Error?error.message:String(error);} }
  const commute=[]; for(const route of INCHEON_STOPS.commute.routes) commute.push(await buildIncheonRoute(INCHEON_STOPS.commute,route,stopResults.commute,locationCache));
  const returnHome=[]; for(const route of INCHEON_STOPS.returnHome.routes) returnHome.push(await buildIncheonRoute(INCHEON_STOPS.returnHome,route,stopResults.returnHome,locationCache));
  if(stopErrors.commute) commute.forEach(x=>x.routeError=stopErrors.commute); if(stopErrors.returnHome) returnHome.forEach(x=>x.routeError=stopErrors.returnHome);

  let seoulCommute=[{route:SEOUL_ROUTE_NAME,routeId:SEOUL_ROUTE_ID,provider:'seoul',found:false,routeError:null}];
  let seoulReturnHome=[{route:SEOUL_ROUTE_NAME,routeId:SEOUL_ROUTE_ID,provider:'seoul',found:false,routeError:null}];
  let seoulError=null;
  try{
    const seoulXml=await requestSeoulXml();
    seoulCommute=[buildSeoulRoute(findSeoulItem(seoulXml,SEOUL_STOPS.commute),SEOUL_STOPS.commute)];
    seoulReturnHome=[buildSeoulRoute(findSeoulItem(seoulXml,SEOUL_STOPS.returnHome),SEOUL_STOPS.returnHome)];
  }catch(error){ seoulError=error instanceof Error?error.message:String(error); seoulCommute[0].routeError=seoulError; seoulReturnHome[0].routeError=seoulError; }

  const incheonAll=[...commute,...returnHome]; const hard=incheonAll.filter(x=>x.routeError),locErr=incheonAll.filter(x=>x.locationApiStatus==='error'); const incheonOk=hard.length<incheonAll.length; const routeErrors=hard.map(x=>`${x.route}: ${x.routeError}`).slice(0,5);
  return {ok:incheonOk,partial:hard.length>0||locErr.length>0||Boolean(seoulError),live:incheonOk,source:'인천 BIS + 서울 버스정보',version:'0.23',method:'인천 정류장별 도착정보 + 차량위치 / 서울 구로09 노선 도착정보',commute,returnHome,seoulCommute,seoulReturnHome,seoulApi:{ok:!seoulError,error:seoulError},locationApi:{ok:locErr.length===0,errorCount:locErr.length},diagnostics:{failedRoutes:hard.length,totalRoutes:incheonAll.length,routeErrors,upstreamCallsMax:7,minIntervalMs:MIN_REQUEST_INTERVAL_MS},error:!incheonOk?(routeErrors[0]||'인천 실시간 조회에 실패했습니다.'):null,fetchedAt:new Date().toISOString(),elapsedMs:Date.now()-startedAt};
}

export async function GET(){
  const now=Date.now();
  if(cachedResponse && now-cachedAt<RESPONSE_CACHE_MS) return NextResponse.json({...cachedResponse,cacheHit:true},{headers:{'Cache-Control':'private, no-store'}});
  if(!inFlight) inFlight=buildPayload().then(payload=>{cachedResponse=payload;cachedAt=Date.now();return payload}).finally(()=>{inFlight=null});
  const payload=await inFlight; return NextResponse.json({...payload,cacheHit:false},{headers:{'Cache-Control':'private, no-store'}});
}
