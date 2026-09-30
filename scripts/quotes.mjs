import { Pool } from "pg";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
    throw error;
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL não configurada.");
  console.error("No Render Shell ela é injetada automaticamente pelo Blueprint.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  query_timeout: 5_000,
});

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      rank_label TEXT NOT NULL,
      icon TEXT NOT NULL,
      aura BIGINT NOT NULL DEFAULT 0,
      puuid TEXT UNIQUE,
      region TEXT
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id BIGSERIAL PRIMARY KEY,
      player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      text TEXT NOT NULL CHECK (length(btrim(text)) > 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_quotes_player_active
      ON quotes(player_id, active);
  `);
}

function usage() {
  console.log(`
Uso:
  npm run quotes -- list
  npm run quotes -- add "Nick#TAG" "Texto da citação"
  npm run quotes -- disable <id>
  npm run quotes -- enable <id>
`);
}

const [, , command, ...args] = process.argv;

try {
  await ensureSchema();

  if (!command) {
    usage();
    process.exitCode = 1;
  } else if (command === "list") {
    const result = await pool.query(`
      SELECT q.id, p.name AS player, q.text, q.active, q.created_at
      FROM quotes q
      JOIN players p ON p.id = q.player_id
      ORDER BY p.name ASC, q.id ASC
    `);
    console.table(result.rows);
  } else if (command === "add") {
    const [playerName, text] = args;

    if (!playerName || !text?.trim()) {
      usage();
      process.exitCode = 1;
    } else {
      const playerResult = await pool.query(
        "SELECT id, name FROM players WHERE lower(name) = lower($1) LIMIT 2",
        [playerName],
      );

      if (playerResult.rows.length !== 1) {
        console.error(`Player não encontrado de forma única: ${playerName}`);
        console.error('Use o nome completo como aparece no board, incluindo "#TAG".');
        process.exitCode = 1;
      } else {
        const player = playerResult.rows[0];
        const result = await pool.query(
          `INSERT INTO quotes (player_id, text)
           VALUES ($1, $2)
           RETURNING id`,
          [player.id, text.trim()],
        );
        console.log(`Citação #${result.rows[0].id} adicionada para ${player.name}.`);
      }
    }
  } else if (command === "disable" || command === "enable") {
    const id = Number(args[0]);

    if (!Number.isInteger(id) || id <= 0) {
      usage();
      process.exitCode = 1;
    } else {
      const active = command === "enable";
      const result = await pool.query(
        `UPDATE quotes
         SET active = $1
         WHERE id = $2
         RETURNING id`,
        [active, id],
      );

      if (result.rowCount === 0) {
        console.error(`Citação #${id} não encontrada.`);
        process.exitCode = 1;
      } else {
        console.log(`Citação #${id} ${active ? "ativada" : "desativada"}.`);
      }
    }
  } else {
    usage();
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
