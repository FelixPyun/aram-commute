import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ARRIVAL_ENDPOINT = 'https://apis.data.go.kr/6280000/busArrivalService/getBusArrivalList';
const LOCATION_ENDPOINT = 'https://apis.data.go.kr/6280000/busLocationService/getBusRouteLocation';

const ROUTE_IDS = { '514-1':'165000076', '38':'165000037', '65-1':'165000046', '58':'161000007' };
const STOPS = {
  commute:{ label:'새안의원 정류장', stopNo:'37256', bstopId:'163000256', routes:['514-1','38'] },
  returnHome:{ label:'주안역환승정류장', stopNo:'37503', bstopId:'163000503', routes:['514-1','65-1','58'] },
};
const parser = new XMLParser({ ignoreAttributes:false, trimValues:true, parseTagValue:false, parseAttributeValue:false });

function normalizeServiceKey(raw){ if(!raw)return ''; try{return decodeURIComponent(raw.trim())}catch{return raw.trim()} }
function pick(obj,...keys){ if(!obj||typeof obj!=='object')return undefined; for(const key of keys){ if(obj[key]!=null)return obj[key]; const f=Object.keys(obj).find(k=>k.toLowerCase()===key.toLowerCase()); if(f)return obj[f]; } }
function collectObjects(v,p,out=[]){ if(Array.isArray(v)){v.forEach(x=>collectObjects(x,p,out));return out} if(!v||typeof v!=='object')return out; if(p(v))out.push(v); Object.values(v).forEach(x=>collectObjects(x,p,out)); return out; }
function findHeader(v){ if(!v||typeof v!=='object')return null; const code=pick(v,'resultCode','RESULTCODE'),msg=pick(v,'resultMsg','RESULTMSG'); if(code!=null||msg!=null)return{code:String(code??''),msg:String(msg??'')}; for(const c of Object.values(v)){const f=findHeader(c);if(f)return f} return null; }

async function requestXml(endpoint,params,label){
  const rawKey=process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  const decodedKey=normalizeServiceKey(rawKey);
  if(!rawKey) throw new Error('공공데이터 인증키가 설정되지 않았습니다.');

  // 공공데이터포털 인증키는 Encoding/Decoding 형태에 따라 게이트웨이에서
  // 다르게 해석되는 경우가 있어, 서버 환경(Vercel 포함)에서도 안전하게
  // 동작하도록 공식 표기(ServiceKey)를 우선으로 여러 안전한 조합을 시도합니다.
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
      const res=await fetch(url,{cache:'no-store',headers:{Accept:'application/xml,text/xml,*/*'},signal:AbortSignal.timeout(8000)});
      const text=await res.text();
      const authError=/SERVICE_KEY_IS_NOT_REGISTERED_ERROR|등록되지 않은 서비스키|returnReasonCode[^0-9]*30/i.test(text);
      const accessError=/SERVICE_ACCESS_DENIED_ERROR|서비스 접근거부|returnReasonCode[^0-9]*(?:20|22)/i.test(text);

      if(authError||accessError){
        lastError=`${label} 인증 오류 (${attempt.name})`;
        continue;
      }
      if(!res.ok){
        lastError=`${label} HTTP ${res.status}: ${text.slice(0,220)}`;
        continue;
      }

      const xml=parser.parse(text);
      const h=findHeader(xml);
      if(h?.code==='4') return {xml,noResult:true,attempt:attempt.name};
      if(h?.code&&!['0','00','1'].includes(h.code)){
        lastError=`${label} API 오류 ${h.code}: ${h.msg||'원인 미상'}`;
        continue;
      }
      return {xml,noResult:false,attempt:attempt.name};
    }catch(error){
      lastError=`${label} 요청 실패: ${error instanceof Error?error.message:String(error)}`;
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

async function fetchRoute(stop,route,cache){
  const routeId=ROUTE_IDS[route];
  try{
    const a=await requestXml(ARRIVAL_ENDPOINT,{bstopId:stop.bstopId,routeId,numOfRows:20,pageNo:1},`${stop.label} ${route} 도착정보`);
    const arrivals=a.noResult?[]:normalizeArrivals(a.xml).filter(x=>x.routeId===routeId).sort((x,y)=>x.etaSec-y.etaSec); const first=arrivals[0]||null;
    let lp=cache.get(routeId); if(!lp){lp=requestXml(LOCATION_ENDPOINT,{routeId,numOfRows:200,pageNo:1},`${route} 차량위치`).then(r=>({vehicles:r.noResult?[]:normalizeLocations(r.xml).filter(x=>x.routeId===routeId)})).catch(error=>({vehicles:[],error}));cache.set(routeId,lp)}
    const loc=await lp, inferred=!loc.error&&first?locateBuses(first,loc.vehicles):{firstLocation:null,next:null,reason:'차량위치 API 미연결'};
    return{
      route,routeId,found:Boolean(first),etaSec:first?.etaSec??null,stopsAway:Number.isFinite(first?.stopsAway)?first.stopsAway:null,
      currentStopName:inferred.firstLocation?.latestStopName||first?.latestStopName||null,currentStopId:inferred.firstLocation?.latestStopId||null,
      nextBusFound:Boolean(inferred.next),nextCurrentStopName:inferred.next?.latestStopName||null,nextCurrentStopId:inferred.next?.latestStopId||null,
      nextStopsAway:Number.isFinite(inferred.next?.stopsToTarget)?inferred.next.stopsToTarget:null,nextBusId:inferred.next?.busId||null,nextPlate:inferred.next?.plate||null,nextReason:inferred.reason||null,
      locationApiStatus:loc.error?'error':'ok',locationApiError:loc.error?(loc.error instanceof Error?loc.error.message:String(loc.error)):null,routeError:null
    };
  }catch(error){const message=error instanceof Error?error.message:String(error);console.error(`[aram-commute v0.13] ${stop.label} ${route}`,error);return{route,routeId,found:false,etaSec:null,stopsAway:null,currentStopName:null,nextBusFound:false,nextCurrentStopName:null,nextStopsAway:null,locationApiStatus:'unknown',routeError:message}}
}

export async function GET(){
  const startedAt=Date.now(),cache=new Map();
  const [commute,returnHome]=await Promise.all([Promise.all(STOPS.commute.routes.map(r=>fetchRoute(STOPS.commute,r,cache))),Promise.all(STOPS.returnHome.routes.map(r=>fetchRoute(STOPS.returnHome,r,cache)))]);
  const all=[...commute,...returnHome],hard=all.filter(x=>x.routeError),locErr=all.filter(x=>x.locationApiStatus==='error');
  const ok=hard.length<all.length;
  const routeErrors=hard.map(x=>`${x.route}: ${x.routeError}`).slice(0,5);
  const error=!ok ? (routeErrors[0]||'전체 노선 실시간 조회에 실패했습니다.') : null;
  return NextResponse.json({
    ok,partial:hard.length>0||locErr.length>0,live:ok,
    source:'인천광역시 버스정보시스템(BIS)',version:'0.18',
    method:'첫 버스=도착정보 API, 현재/다음 버스 위치=버스위치정보 API',
    commute,returnHome,
    locationApi:{ok:locErr.length===0,errorCount:locErr.length},
    diagnostics:{failedRoutes:hard.length,totalRoutes:all.length,routeErrors},
    error,fetchedAt:new Date().toISOString(),elapsedMs:Date.now()-startedAt
  },{headers:{'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','Pragma':'no-cache','Expires':'0'}});
}
