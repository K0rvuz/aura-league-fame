import { randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";

export type Player = { id:string; name:string; rank_label:string; icon:string; aura:number; quotes:string[] };
type PlayerInsert = { name:string; rank_label:string; icon:string; puuid?:string; region?:string };
const PAGE_SIZE = 10;
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

const globalDatabase = globalThis as typeof globalThis & {
  auraPostgresPool?: Pool;
  auraPostgresSchemaPromise?: Promise<void>;
};

const pool = globalDatabase.auraPostgresPool ?? new Pool({
  connectionString: databaseUrl,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  query_timeout: 5_000,
});
pool.on("error", (error) => console.error("PostgreSQL pool error", error));
globalDatabase.auraPostgresPool = pool;

async function ensureSchema(): Promise<void> {
  if (!globalDatabase.auraPostgresSchemaPromise) {
    globalDatabase.auraPostgresSchemaPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`CREATE TABLE IF NOT EXISTS players (
          id UUID PRIMARY KEY, name TEXT NOT NULL UNIQUE, rank_label TEXT NOT NULL,
          icon TEXT NOT NULL, aura BIGINT NOT NULL DEFAULT 0, puuid TEXT UNIQUE, region TEXT
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS quotes (
          id BIGSERIAL PRIMARY KEY,
          player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          text TEXT NOT NULL CHECK (length(btrim(text)) > 0),
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS player_import_queue (
          id UUID PRIMARY KEY,
          riot_id TEXT NOT NULL,
          region TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','processing','completed','duplicate','failed')),
          attempts INTEGER NOT NULL DEFAULT 0,
          available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          claimed_at TIMESTAMPTZ,
          processed_at TIMESTAMPTZ,
          result_name TEXT,
          last_error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS player_import_control (
          id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
          next_allowed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        await client.query(`INSERT INTO player_import_control (id,next_allowed_at)
          VALUES (TRUE,NOW()) ON CONFLICT (id) DO NOTHING`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_players_aura_name ON players (aura DESC,name ASC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_quotes_player_active ON quotes (player_id,active)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_player_import_queue_ready
          ON player_import_queue (status,available_at,created_at)`);
        await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_player_import_queue_active_unique
          ON player_import_queue (lower(riot_id),region)
          WHERE status IN ('pending','processing')`);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        globalDatabase.auraPostgresSchemaPromise = undefined;
        throw error;
      } finally { client.release(); }
    })();
  }
  await globalDatabase.auraPostgresSchemaPromise;
}

export async function getDatabasePool(): Promise<Pool> { await ensureSchema(); return pool; }

type RankingRow = QueryResultRow & {
  total:number; player_count:number; total_aura:string;
  players:Array<{id:string;name:string;rank_label:string;icon:string;aura:number|string;quotes:string[]}>;
};
type AuraRow = QueryResultRow & { aura:string };

export async function listPlayers(search:string,page:number) {
  await ensureSchema();
  const offset=(page-1)*PAGE_SIZE;
  const result=await pool.query<RankingRow>(`
    WITH filtered AS (
      SELECT id,name,rank_label,icon,aura FROM players
      WHERE ($1='' OR POSITION(lower($1) IN lower(name))>0)
    ),
    page_rows AS (
      SELECT f.id,f.name,f.rank_label,f.icon,f.aura,
        ARRAY(SELECT q.text FROM quotes q
          WHERE q.player_id=f.id AND q.active=TRUE ORDER BY q.id ASC) AS quotes
      FROM filtered f ORDER BY f.aura DESC,f.name ASC LIMIT $2 OFFSET $3
    ),
    stats AS (
      SELECT COUNT(*)::INT AS player_count, COALESCE(SUM(aura),0)::TEXT AS total_aura FROM players
    ),
    filtered_count AS (SELECT COUNT(*)::INT AS total FROM filtered)
    SELECT filtered_count.total,stats.player_count,stats.total_aura,
      COALESCE((SELECT json_agg(page_rows ORDER BY aura DESC,name ASC) FROM page_rows),'[]'::JSON) AS players
    FROM stats CROSS JOIN filtered_count
  `,[search,PAGE_SIZE,offset]);
  const row=result.rows[0];
  if(!row) return {players:[],total:0,playerCount:0,totalAura:0};
  return {
    total:Number(row.total), playerCount:Number(row.player_count), totalAura:Number(row.total_aura),
    players:row.players.map(p=>({...p,aura:Number(p.aura),quotes:Array.isArray(p.quotes)?p.quotes:[]}))
  };
}

export async function castVote(playerId:string,delta:number):Promise<number>{
  await ensureSchema();
  const result=await pool.query<AuraRow>(`UPDATE players SET aura=aura+$1 WHERE id=$2 RETURNING aura::TEXT`,[delta,playerId]);
  const row=result.rows[0]; if(!row) throw new Error("player_not_found"); return Number(row.aura);
}
export async function hasPlayer(puuid:string,name:string):Promise<boolean>{
  await ensureSchema();
  const result=await pool.query("SELECT 1 FROM players WHERE puuid=$1 OR lower(name)=lower($2) LIMIT 1",[puuid,name]);
  return (result.rowCount??0)>0;
}
export async function createPlayer(player:PlayerInsert):Promise<void>{
  await ensureSchema();
  await pool.query(`INSERT INTO players (id,name,rank_label,icon,aura,puuid,region)
    VALUES ($1,$2,$3,$4,0,$5,$6)`,
    [randomUUID(),player.name,player.rank_label,player.icon,player.puuid??null,player.region??null]);
}
