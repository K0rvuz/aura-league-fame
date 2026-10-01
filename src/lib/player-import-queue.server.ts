import { randomUUID } from "node:crypto";
import { createPlayer, getDatabasePool, getPlayerByPuuid, hasPlayer, updatePlayerIdentityByPuuid } from "@/lib/postgres-db.server";

const JOB_INTERVAL_MS=1000;
const MAX_ATTEMPTS=5;
const PLATFORMS:Record<string,string>={BR1:"americas",NA1:"americas",LA1:"americas",LA2:"americas",EUW1:"europe",EUN1:"europe",TR1:"europe",RU:"europe",KR:"asia",JP1:"asia",OC1:"sea",VN2:"sea",SG2:"sea",TW2:"sea",PH2:"sea",TH2:"sea"};
type Status="pending"|"processing"|"completed"|"duplicate"|"failed";
type Job={id:string;riot_id:string;region:string;status:Status;attempts:number};

const g=globalThis as typeof globalThis & {
  auraPlayerImportWorkerStarted?:boolean;
  auraDdragonVersion?:{version:string;expiresAt:number};
  auraQueueLastCleanupAt?:number;
};

function normalizeRiotId(v:string){
  const [gameName="",tagLine=""]=v.split("#").map(x=>x.trim());
  return `${gameName}#${tagLine}`;
}

export async function enqueuePlayerImport(riotId:string,region:string){
  const normalized=normalizeRiotId(riotId);
  const db=await getDatabasePool();
  const exists=await db.query("SELECT 1 FROM players WHERE lower(name)=lower($1) LIMIT 1",[normalized]);
  if((exists.rowCount??0)>0) return {ok:false as const,error:`${normalized} já está no ranking.`};

  const active=await db.query<{id:string}>(`SELECT id FROM player_import_queue
    WHERE lower(riot_id)=lower($1) AND region=$2 AND status IN ('pending','processing')
    ORDER BY created_at ASC LIMIT 1`,[normalized,region]);
  if(active.rows[0]) return {ok:true as const,requestId:active.rows[0].id,alreadyQueued:true};

  const id=randomUUID();
  try{
    await db.query("INSERT INTO player_import_queue (id,riot_id,region) VALUES ($1,$2,$3)",[id,normalized,region]);
    return {ok:true as const,requestId:id,alreadyQueued:false};
  }catch(error){
    const code=error&&typeof error==="object"&&"code" in error?String(error.code):"";
    if(code==="23505"){
      const raced=await db.query<{id:string}>(`SELECT id FROM player_import_queue
        WHERE lower(riot_id)=lower($1) AND region=$2 AND status IN ('pending','processing')
        ORDER BY created_at ASC LIMIT 1`,[normalized,region]);
      if(raced.rows[0]) return {ok:true as const,requestId:raced.rows[0].id,alreadyQueued:true};
    }
    throw error;
  }
}

export async function getPlayerImportStatus(requestId:string){
  const db=await getDatabasePool();
  const result=await db.query<{
    riot_id:string;region:string;status:Status;attempts:number;result_name:string|null;last_error:string|null
  }>(`SELECT riot_id,region,status,attempts,result_name,last_error
      FROM player_import_queue WHERE id=$1 LIMIT 1`,[requestId]);
  const row=result.rows[0];
  if(!row) return {found:false as const};
  return {found:true as const,status:row.status,riotId:row.riot_id,region:row.region,
    attempts:row.attempts,name:row.result_name,error:row.last_error};
}

async function claim():Promise<Job|null>{
  const db=await getDatabasePool();
  const c=await db.connect();
  try{
    await c.query("BEGIN");
    await c.query(`UPDATE player_import_queue SET status='pending',claimed_at=NULL,available_at=NOW()
      WHERE status='processing' AND claimed_at < NOW()-INTERVAL '5 minutes'`);
    const permit=await c.query(`UPDATE player_import_control
      SET next_allowed_at=NOW()+($1*INTERVAL '1 millisecond')
      WHERE id=TRUE AND next_allowed_at<=NOW() RETURNING next_allowed_at`,[JOB_INTERVAL_MS]);
    if((permit.rowCount??0)===0){await c.query("ROLLBACK");return null;}
    const q=await c.query<Job>(`WITH next_job AS (
        SELECT id FROM player_import_queue
        WHERE status='pending' AND available_at<=NOW()
        ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE player_import_queue q SET status='processing',claimed_at=NOW(),
        attempts=attempts+1,last_error=NULL
      FROM next_job WHERE q.id=next_job.id
      RETURNING q.id,q.riot_id,q.region,q.status,q.attempts`);
    await c.query("COMMIT");
    return q.rows[0]??null;
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}

async function complete(id:string,name:string,status:"completed"|"duplicate"){
  const db=await getDatabasePool();
  await db.query(`UPDATE player_import_queue SET status=$2,result_name=$3,processed_at=NOW(),
    claimed_at=NULL,last_error=NULL WHERE id=$1`,[id,status,name]);
}
async function fail(id:string,msg:string){
  const db=await getDatabasePool();
  await db.query(`UPDATE player_import_queue SET status='failed',processed_at=NOW(),
    claimed_at=NULL,last_error=$2 WHERE id=$1`,[id,msg]);
}
async function retry(id:string,attempts:number,msg:string,delay?:number){
  if(attempts>=MAX_ATTEMPTS){await fail(id,msg);return;}
  const seconds=delay??Math.min(60,2**attempts*2);
  const db=await getDatabasePool();
  await db.query(`UPDATE player_import_queue SET status='pending',claimed_at=NULL,
    available_at=NOW()+($2*INTERVAL '1 second'),last_error=$3 WHERE id=$1`,[id,seconds,msg]);
}
function retryAfter(r:Response){
  const raw=r.headers.get("retry-after"); if(!raw) return undefined;
  const n=Number(raw); if(Number.isFinite(n)&&n>=0) return Math.ceil(n);
  const d=Date.parse(raw); return Number.isNaN(d)?undefined:Math.max(1,Math.ceil((d-Date.now())/1000));
}
async function ddragonVersion(){
  if(g.auraDdragonVersion&&g.auraDdragonVersion.expiresAt>Date.now()) return g.auraDdragonVersion.version;
  try{
    const r=await fetch("https://ddragon.leagueoflegends.com/api/versions.json",{signal:AbortSignal.timeout(5000)});
    if(r.ok){const v=await r.json() as string[]; if(v[0]){
      g.auraDdragonVersion={version:v[0],expiresAt:Date.now()+3600000}; return v[0];
    }}
  }catch{}
  return "15.1.1";
}
async function processJob(job:Job){
  const key=process.env["RIOT_API_KEY"];
  if(!key){await retry(job.id,job.attempts,"Integração com a Riot indisponível no momento.",60);return;}
  const [gameName="",tagLine=""]=job.riot_id.split("#").map(x=>x.trim());
  const group=PLATFORMS[job.region]; if(!group){await fail(job.id,"Região inválida.");return;}
  const cluster=group==="sea"?"asia":group;
  const headers={"X-Riot-Token":key};
  try{
    const a=await fetch(`https://${cluster}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,{headers,signal:AbortSignal.timeout(8000)});
    if(a.status===404){await fail(job.id,"Esse Riot ID não existe.");return;}
    if(a.status===429){await retry(job.id,job.attempts,"A Riot limitou temporariamente as consultas. Tentaremos novamente.",retryAfter(a));return;}
    if(a.status>=500){await retry(job.id,job.attempts,"A Riot está temporariamente indisponível.");return;}
    if(!a.ok){console.error("riot queued account request failed",a.status);await fail(job.id,"Não foi possível validar esse Riot ID.");return;}
    const acc=await a.json() as {puuid:string;gameName:string;tagLine:string};
    const name=`${acc.gameName}#${acc.tagLine}`;
    const existingByPuuid=await getPlayerByPuuid(acc.puuid);

    const s=await fetch(`https://${job.region.toLowerCase()}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(acc.puuid)}`,{headers,signal:AbortSignal.timeout(8000)});
    if(s.status===404){await fail(job.id,"Essa conta não joga LoL nessa região.");return;}
    if(s.status===429){await retry(job.id,job.attempts,"A Riot limitou temporariamente as consultas. Tentaremos novamente.",retryAfter(s));return;}
    if(s.status>=500){await retry(job.id,job.attempts,"A Riot está temporariamente indisponível.");return;}
    if(!s.ok){console.error("riot queued summoner request failed",s.status);await fail(job.id,"Não foi possível consultar essa conta na Riot.");return;}
    const sum=await s.json() as {profileIconId:number;summonerLevel:number};
    const version=await ddragonVersion();
    const rankLabel=`${job.region} · Nv ${sum.summonerLevel}`;
    const icon=`https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${sum.profileIconId}.png`;

    if(existingByPuuid){
      await updatePlayerIdentityByPuuid(acc.puuid,{
        name,
        rank_label:rankLabel,
        icon,
        region:job.region,
      });
      await complete(job.id,name,"completed");
      return;
    }

    if(await hasPlayer(acc.puuid,name)){
      await complete(job.id,name,"duplicate");
      return;
    }

    try{
      await createPlayer({name,puuid:acc.puuid,region:job.region,
        rank_label:rankLabel,
        icon});
    }catch(error){
      const code=error&&typeof error==="object"&&"code" in error?String(error.code):"";
      if(code==="23505"){await complete(job.id,name,"duplicate");return;}
      throw error;
    }
    await complete(job.id,name,"completed");
  }catch(error){
    if(error instanceof Error&&(error.name==="TimeoutError"||error.name==="AbortError")){
      await retry(job.id,job.attempts,"A Riot demorou para responder. Tentaremos novamente.");return;
    }
    console.error("player import queue job failed",error);
    await retry(job.id,job.attempts,"Falha temporária ao processar o jogador.");
  }
}
async function cleanup(){
  const now=Date.now();
  if(g.auraQueueLastCleanupAt&&now-g.auraQueueLastCleanupAt<3600000) return;
  g.auraQueueLastCleanupAt=now;
  const db=await getDatabasePool();
  await db.query(`DELETE FROM player_import_queue
    WHERE status IN ('completed','duplicate','failed')
    AND processed_at < NOW()-INTERVAL '7 days'`);
}
async function loop(){
  try{await cleanup();const job=await claim();if(job) await processJob(job);}
  catch(e){console.error("player import queue worker error",e);}
  finally{setTimeout(()=>void loop(),250);}
}
export function ensurePlayerImportWorker(){
  if(g.auraPlayerImportWorkerStarted) return;
  g.auraPlayerImportWorkerStarted=true;
  void loop();
}
