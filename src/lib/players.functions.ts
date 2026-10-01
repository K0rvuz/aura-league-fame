import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PLATFORMS:Record<string,string>={BR1:"americas",NA1:"americas",LA1:"americas",LA2:"americas",EUW1:"europe",EUN1:"europe",TR1:"europe",RU:"europe",KR:"asia",JP1:"asia",OC1:"sea",VN2:"sea",SG2:"sea",TW2:"sea",PH2:"sea",TH2:"sea"};
const schema=z.object({riotId:z.string().trim().min(3).max(40).regex(/^[^#]{3,16}#[^#]{2,5}$/),region:z.enum(Object.keys(PLATFORMS) as [string,...string[]])});

export const getPlayers=createServerFn({method:"GET"}).validator((data)=>
  z.object({search:z.string().max(100),page:z.number().int().min(1)}).parse(data)
).handler(async({data})=>{
  const [{listPlayers},{assertRateLimit}]=await Promise.all([import("@/lib/postgres-db.server"),import("@/lib/rate-limit.server")]);
  assertRateLimit("players:list",3000,60000);
  return listPlayers(data.search.trim(),data.page);
});

const voteSchema=z.object({playerId:z.string().uuid(),delta:z.union([z.literal(-5000),z.literal(-1000),z.literal(1000),z.literal(5000)])});
export const voteAura=createServerFn({method:"POST"}).validator((data)=>voteSchema.parse(data)).handler(async({data})=>{
  const [{castVote},{assertRateLimit}]=await Promise.all([import("@/lib/postgres-db.server"),import("@/lib/rate-limit.server")]);
  assertRateLimit("players:vote",600,60000);
  return castVote(data.playerId,data.delta);
});

export const addRiotPlayer=createServerFn({method:"POST"}).validator((d)=>schema.parse(d)).handler(async({data})=>{
  const [{assertRateLimit},{enqueuePlayerImport,ensurePlayerImportWorker}]=await Promise.all([
    import("@/lib/rate-limit.server"),import("@/lib/player-import-queue.server")
  ]);
  assertRateLimit("players:add",10,60*60000);
  ensurePlayerImportWorker();
  const result=await enqueuePlayerImport(data.riotId.trim(),data.region);
  if(!result.ok) return result;
  return {ok:true as const,queued:true as const,requestId:result.requestId,alreadyQueued:result.alreadyQueued};
});

export const getRiotPlayerImportStatus=createServerFn({method:"GET"})
.validator((data)=>z.object({requestId:z.string().uuid()}).parse(data))
.handler(async({data})=>{
  const [{assertRateLimit},{getPlayerImportStatus,ensurePlayerImportWorker}]=await Promise.all([
    import("@/lib/rate-limit.server"),import("@/lib/player-import-queue.server")
  ]);
  assertRateLimit("players:import-status",240,60000);
  ensurePlayerImportWorker();
  return getPlayerImportStatus(data.requestId);
});

export const REGIONS=Object.keys(PLATFORMS);
