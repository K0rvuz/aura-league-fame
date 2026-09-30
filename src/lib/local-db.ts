import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type Player = {
  id: string;
  name: string;
  rank_label: string;
  icon: string;
  aura: number;
};

type PlayerInsert = Omit<Player, "id" | "aura"> & {
  puuid?: string;
  region?: string;
};

const databasePath = resolve(process.cwd(), "data", "aura-farming.sqlite");
const PAGE_SIZE = 10;
mkdirSync(dirname(databasePath), { recursive: true });

const globalDatabase = globalThis as typeof globalThis & {
  auraFarmingDatabase?: InstanceType<typeof Database>;
};

const db = globalDatabase.auraFarmingDatabase ?? new Database(databasePath);
globalDatabase.auraFarmingDatabase = db;

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    rank_label TEXT NOT NULL,
    icon TEXT NOT NULL,
    aura INTEGER NOT NULL DEFAULT 0,
    puuid TEXT UNIQUE,
    region TEXT
  );

  CREATE TABLE IF NOT EXISTS aura_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    delta INTEGER NOT NULL CHECK (delta IN (-5000, -1000, 1000, 5000)),
    UNIQUE (player_id, session_id)
  );
`);

export function listPlayers(
  search: string,
  page: number,
): { players: Player[]; total: number; playerCount: number; totalAura: number } {
  const filter = search ? "WHERE instr(lower(name), lower(?)) > 0" : "";
  const searchParams = search ? [search] : [];
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM players ${filter}`)
    .get(...searchParams) as { total: number };
  const { playerCount, totalAura } = db
    .prepare("SELECT COUNT(*) AS playerCount, COALESCE(SUM(aura), 0) AS totalAura FROM players")
    .get() as { playerCount: number; totalAura: number };
  const players = db
    .prepare(
      `SELECT id, name, rank_label, icon, aura
       FROM players ${filter}
       ORDER BY aura DESC, name ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...searchParams, PAGE_SIZE, (page - 1) * PAGE_SIZE) as Player[];

  return { players, total, playerCount, totalAura };
}

export function castVote(playerId: string, sessionId: string, delta: number): number {
  const transaction = db.transaction(() => {
    db.prepare("INSERT INTO aura_votes (player_id, session_id, delta) VALUES (?, ?, ?)").run(
      playerId,
      sessionId,
      delta,
    );

    db.prepare("UPDATE players SET aura = aura + ? WHERE id = ?").run(delta, playerId);
    const player = db.prepare("SELECT aura FROM players WHERE id = ?").get(playerId) as
      { aura: number } | undefined;
    if (!player) throw new Error("player_not_found");
    return player.aura;
  });

  try {
    return transaction.immediate();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(
        "UNIQUE constraint failed: aura_votes.player_id, aura_votes.session_id",
      )
    ) {
      throw new Error("already_voted");
    }
    throw error;
  }
}

export function hasPlayer(puuid: string, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM players WHERE puuid = ? OR name = ?").get(puuid, name));
}

export function createPlayer(player: PlayerInsert): void {
  db.prepare(
    `INSERT INTO players (id, name, rank_label, icon, aura, puuid, region)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    randomUUID(),
    player.name,
    player.rank_label,
    player.icon,
    player.puuid ?? null,
    player.region ?? null,
  );
}
