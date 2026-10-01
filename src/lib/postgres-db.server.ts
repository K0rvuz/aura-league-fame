import { randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";

export type Player = {
  id: string;
  name: string;
  rank_label: string;
  icon: string;
  aura: number;
  quotes: string[];
};

export type FeaturedPlayer = {
  id: string;
  name: string;
  rank_label: string;
  icon: string;
  aura: number;
};

type PlayerInsert = {
  name: string;
  rank_label: string;
  icon: string;
  puuid?: string;
  region?: string;
};

type RankingResult = {
  players: Player[];
  total: number;
  playerCount: number;
  totalAura: number;
  leader: FeaturedPlayer | null;
  lowest: FeaturedPlayer | null;
};

type Stats = {
  playerCount: number;
  totalAura: number;
  leader: FeaturedPlayer | null;
  lowest: FeaturedPlayer | null;
};

type RankingCacheEntry = {
  expiresAt: number;
  value?: RankingResult;
  inFlight?: Promise<RankingResult>;
};

const PAGE_SIZE = 10;

function readPositiveInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

const PG_POOL_MAX = readPositiveInt("PG_POOL_MAX", 5, 1, 20);
const RANKING_CACHE_TTL_MS = readPositiveInt("RANKING_CACHE_TTL_MS", 4_000, 500, 30_000);
const RANKING_SEARCH_CACHE_TTL_MS = readPositiveInt(
  "RANKING_SEARCH_CACHE_TTL_MS",
  2_500,
  500,
  30_000,
);
const RANKING_STATS_CACHE_TTL_MS = readPositiveInt(
  "RANKING_STATS_CACHE_TTL_MS",
  5_000,
  500,
  60_000,
);
const RANKING_CACHE_MAX_ENTRIES = readPositiveInt(
  "RANKING_CACHE_MAX_ENTRIES",
  256,
  32,
  2_000,
);

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

const globalDatabase = globalThis as typeof globalThis & {
  auraPostgresPool?: Pool;
  auraPostgresSchemaPromise?: Promise<void>;
  auraRankingCache?: Map<string, RankingCacheEntry>;
  auraStatsCacheValue?: Stats;
  auraStatsCacheExpiresAt?: number;
  auraStatsCacheInFlight?: Promise<Stats>;
};

const pool =
  globalDatabase.auraPostgresPool ??
  new Pool({
    connectionString: databaseUrl,
    max: PG_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });

pool.on("error", (error) => {
  console.error("PostgreSQL pool error", error);
});

globalDatabase.auraPostgresPool = pool;

const rankingCache =
  globalDatabase.auraRankingCache ?? new Map<string, RankingCacheEntry>();
globalDatabase.auraRankingCache = rankingCache;

async function ensureSchema(): Promise<void> {
  if (!globalDatabase.auraPostgresSchemaPromise) {
    globalDatabase.auraPostgresSchemaPromise = (async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await client.query(`
          CREATE TABLE IF NOT EXISTS players (
            id UUID PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            rank_label TEXT NOT NULL,
            icon TEXT NOT NULL,
            aura BIGINT NOT NULL DEFAULT 0,
            puuid TEXT UNIQUE,
            region TEXT
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS quotes (
            id BIGSERIAL PRIMARY KEY,
            player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            text TEXT NOT NULL CHECK (length(btrim(text)) > 0),
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS player_import_queue (
            id UUID PRIMARY KEY,
            riot_id TEXT NOT NULL,
            region TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'processing', 'completed', 'duplicate', 'failed')),
            attempts INTEGER NOT NULL DEFAULT 0,
            available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            claimed_at TIMESTAMPTZ,
            processed_at TIMESTAMPTZ,
            result_name TEXT,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS player_import_control (
            id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
            next_allowed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query(`
          INSERT INTO player_import_control (id, next_allowed_at)
          VALUES (TRUE, NOW())
          ON CONFLICT (id) DO NOTHING
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_players_aura_name
          ON players (aura DESC, name ASC)
        `);

        // Speeds up case-insensitive exact-name checks used by the import path.
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_players_lower_name
          ON players (lower(name))
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_quotes_player_active
          ON quotes (player_id, active)
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_player_import_queue_ready
          ON player_import_queue (status, available_at, created_at)
        `);

        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_player_import_queue_active_unique
          ON player_import_queue (lower(riot_id), region)
          WHERE status IN ('pending', 'processing')
        `);

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        globalDatabase.auraPostgresSchemaPromise = undefined;
        throw error;
      } finally {
        client.release();
      }
    })();
  }

  await globalDatabase.auraPostgresSchemaPromise;
}

export async function getDatabasePool(): Promise<Pool> {
  await ensureSchema();
  return pool;
}

type AuraRow = QueryResultRow & {
  aura: string;
};

type FeaturedPlayerRow = {
  id: string;
  name: string;
  rank_label: string;
  icon: string;
  aura: number | string;
};

type StatsRow = QueryResultRow & {
  player_count: number;
  total_aura: string;
  leader: FeaturedPlayerRow | null;
  lowest: FeaturedPlayerRow | null;
};

type PagePlayer = {
  id: string;
  name: string;
  rank_label: string;
  icon: string;
  aura: number | string;
  quotes: string[];
};

type FilteredPageRow = QueryResultRow & {
  total: number;
  players: PagePlayer[];
};

function mapPlayers(players: PagePlayer[]): Player[] {
  return players.map((player) => ({
    ...player,
    aura: Number(player.aura),
    quotes: Array.isArray(player.quotes) ? player.quotes : [],
  }));
}

function mapFeaturedPlayer(
  player: FeaturedPlayerRow | null,
): FeaturedPlayer | null {
  if (!player) return null;

  return {
    id: player.id,
    name: player.name,
    rank_label: player.rank_label,
    icon: player.icon,
    aura: Number(player.aura),
  };
}

async function getStatsCached(): Promise<Stats> {
  const now = Date.now();

  if (
    globalDatabase.auraStatsCacheValue &&
    (globalDatabase.auraStatsCacheExpiresAt ?? 0) > now
  ) {
    return globalDatabase.auraStatsCacheValue;
  }

  if (globalDatabase.auraStatsCacheInFlight) {
    return globalDatabase.auraStatsCacheInFlight;
  }

  const inFlight = (async () => {
    const result = await pool.query<StatsRow>(`
      SELECT
        COUNT(*)::INT AS player_count,
        COALESCE(SUM(aura), 0)::TEXT AS total_aura,
        (
          SELECT json_build_object(
            'id', p.id,
            'name', p.name,
            'rank_label', p.rank_label,
            'icon', p.icon,
            'aura', p.aura::TEXT
          )
          FROM players p
          ORDER BY p.aura DESC, p.name ASC
          LIMIT 1
        ) AS leader,
        (
          SELECT json_build_object(
            'id', p.id,
            'name', p.name,
            'rank_label', p.rank_label,
            'icon', p.icon,
            'aura', p.aura::TEXT
          )
          FROM players p
          ORDER BY p.aura ASC, p.name DESC
          LIMIT 1
        ) AS lowest
      FROM players
    `);

    const row = result.rows[0];
    const stats = {
      playerCount: Number(row?.player_count ?? 0),
      totalAura: Number(row?.total_aura ?? 0),
      leader: mapFeaturedPlayer(row?.leader ?? null),
      lowest: mapFeaturedPlayer(row?.lowest ?? null),
    };

    globalDatabase.auraStatsCacheValue = stats;
    globalDatabase.auraStatsCacheExpiresAt =
      Date.now() + RANKING_STATS_CACHE_TTL_MS;

    return stats;
  })();

  globalDatabase.auraStatsCacheInFlight = inFlight;

  try {
    return await inFlight;
  } finally {
    if (globalDatabase.auraStatsCacheInFlight === inFlight) {
      globalDatabase.auraStatsCacheInFlight = undefined;
    }
  }
}

async function loadRanking(search: string, page: number): Promise<RankingResult> {
  const offset = (page - 1) * PAGE_SIZE;
  const statsPromise = getStatsCached();

  if (search === "") {
    const pagePromise = pool.query<PagePlayer & QueryResultRow>(
      `
        SELECT
          p.id,
          p.name,
          p.rank_label,
          p.icon,
          p.aura,
          ARRAY(
            SELECT q.text
            FROM quotes q
            WHERE q.player_id = p.id
              AND q.active = TRUE
            ORDER BY q.id ASC
          ) AS quotes
        FROM players p
        ORDER BY p.aura DESC, p.name ASC
        LIMIT $1 OFFSET $2
      `,
      [PAGE_SIZE, offset],
    );

    const [stats, pageResult] = await Promise.all([statsPromise, pagePromise]);

    return {
      players: mapPlayers(pageResult.rows),
      total: stats.playerCount,
      playerCount: stats.playerCount,
      totalAura: stats.totalAura,
      leader: stats.leader,
      lowest: stats.lowest,
    };
  }

  const pagePromise = pool.query<FilteredPageRow>(
    `
      WITH filtered AS (
        SELECT id, name, rank_label, icon, aura
        FROM players
        WHERE POSITION(lower($1) IN lower(name)) > 0
      ),
      page_rows AS (
        SELECT
          f.id,
          f.name,
          f.rank_label,
          f.icon,
          f.aura,
          ARRAY(
            SELECT q.text
            FROM quotes q
            WHERE q.player_id = f.id
              AND q.active = TRUE
            ORDER BY q.id ASC
          ) AS quotes
        FROM filtered f
        ORDER BY f.aura DESC, f.name ASC
        LIMIT $2 OFFSET $3
      )
      SELECT
        (SELECT COUNT(*)::INT FROM filtered) AS total,
        COALESCE(
          (
            SELECT json_agg(page_rows ORDER BY aura DESC, name ASC)
            FROM page_rows
          ),
          '[]'::JSON
        ) AS players
    `,
    [search, PAGE_SIZE, offset],
  );

  const [stats, pageResult] = await Promise.all([statsPromise, pagePromise]);
  const row = pageResult.rows[0];

  return {
    players: mapPlayers(row?.players ?? []),
    total: Number(row?.total ?? 0),
    playerCount: stats.playerCount,
    totalAura: stats.totalAura,
    leader: stats.leader,
    lowest: stats.lowest,
  };
}

function trimRankingCache(now: number): void {
  if (rankingCache.size <= RANKING_CACHE_MAX_ENTRIES) return;

  for (const [key, entry] of rankingCache) {
    if (!entry.inFlight && entry.expiresAt <= now) {
      rankingCache.delete(key);
    }
  }

  while (rankingCache.size > RANKING_CACHE_MAX_ENTRIES) {
    const oldestKey = rankingCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    rankingCache.delete(oldestKey);
  }
}

export async function listPlayers(
  search: string,
  page: number,
): Promise<RankingResult> {
  await ensureSchema();

  const normalizedSearch = search.trim();
  const key = `${normalizedSearch.toLowerCase()}:${page}`;
  const now = Date.now();
  const current = rankingCache.get(key);

  if (current?.value && current.expiresAt > now) {
    return current.value;
  }

  if (current?.inFlight) {
    return current.inFlight;
  }

  const ttl =
    normalizedSearch === ""
      ? RANKING_CACHE_TTL_MS
      : RANKING_SEARCH_CACHE_TTL_MS;

  const staleValue = current?.value;
  const inFlight = loadRanking(normalizedSearch, page);

  rankingCache.set(key, {
    expiresAt: now + ttl,
    value: staleValue,
    inFlight,
  });

  try {
    const value = await inFlight;
    rankingCache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
    trimRankingCache(Date.now());
    return value;
  } catch (error) {
    rankingCache.delete(key);

    // A short stale fallback is preferable to taking the ranking down for a
    // transient database hiccup.
    if (staleValue) return staleValue;

    throw error;
  }
}

export async function castVote(
  playerId: string,
  delta: number,
): Promise<number> {
  await ensureSchema();

  const result = await pool.query<AuraRow>(
    `
      UPDATE players
      SET aura = aura + $1
      WHERE id = $2
      RETURNING aura::TEXT
    `,
    [delta, playerId],
  );

  const row = result.rows[0];
  if (!row) throw new Error("player_not_found");

  return Number(row.aura);
}

export async function hasPlayer(
  puuid: string,
  name: string,
): Promise<boolean> {
  await ensureSchema();

  const result = await pool.query(
    `
      SELECT 1
      FROM players
      WHERE puuid = $1
         OR lower(name) = lower($2)
      LIMIT 1
    `,
    [puuid, name],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function getPlayerByPuuid(
  puuid: string,
): Promise<{ id: string; name: string } | null> {
  await ensureSchema();

  const result = await pool.query<{ id: string; name: string } & QueryResultRow>(
    `
      SELECT id, name
      FROM players
      WHERE puuid = $1
      LIMIT 1
    `,
    [puuid],
  );

  return result.rows[0] ?? null;
}

export async function updatePlayerIdentityByPuuid(
  puuid: string,
  player: {
    name: string;
    rank_label: string;
    icon: string;
    region: string;
  },
): Promise<void> {
  await ensureSchema();

  await pool.query(
    `
      UPDATE players
      SET name = $2,
          rank_label = $3,
          icon = $4,
          region = $5
      WHERE puuid = $1
    `,
    [
      puuid,
      player.name,
      player.rank_label,
      player.icon,
      player.region,
    ],
  );
}

export async function createPlayer(player: PlayerInsert): Promise<void> {
  await ensureSchema();

  await pool.query(
    `
      INSERT INTO players (id, name, rank_label, icon, aura, puuid, region)
      VALUES ($1, $2, $3, $4, 0, $5, $6)
    `,
    [
      randomUUID(),
      player.name,
      player.rank_label,
      player.icon,
      player.puuid ?? null,
      player.region ?? null,
    ],
  );
}
