import Database from "better-sqlite3";
import { resolve } from "node:path";

const databasePath = resolve(process.cwd(), "data", "aura-farming.sqlite");
const db = new Database(databasePath);
db.pragma("foreign_keys = ON");

function usage() {
  console.log(`
Uso:
  npm run quotes -- list
  npm run quotes -- add "Nick#TAG" "Texto da citação"
  npm run quotes -- disable <id>
  npm run quotes -- enable <id>

Exemplos:
  npm run quotes -- add "Faker#KR1" "Hide on bush."
  npm run quotes -- list
  npm run quotes -- disable 3
`);
}

const [, , command, ...args] = process.argv;

if (!command) {
  usage();
  process.exit(1);
}

if (command === "list") {
  const rows = db.prepare(`
    SELECT q.id, p.name AS player, q.text, q.active, q.created_at
    FROM quotes q
    JOIN players p ON p.id = q.player_id
    ORDER BY p.name ASC, q.id ASC
  `).all();

  console.table(rows);
  process.exit(0);
}

if (command === "add") {
  const [playerName, text] = args;

  if (!playerName || !text?.trim()) {
    usage();
    process.exit(1);
  }

  const player = db
  .prepare("SELECT id, name FROM players WHERE name = ? COLLATE NOCASE")
  .get(playerName);

  if (!player) {
    console.error(`Player não encontrado: ${playerName}`);
    console.error('Use o nome completo exatamente como está no board, incluindo "#TAG".');
    process.exit(1);
  }

  const result = db
    .prepare("INSERT INTO quotes (player_id, text) VALUES (?, ?)")
    .run(player.id, text.trim());

  console.log(`Citação #${result.lastInsertRowid} adicionada para ${player.name}.`);
  process.exit(0);
}

if (command === "disable" || command === "enable") {
  const id = Number(args[0]);

  if (!Number.isInteger(id) || id <= 0) {
    usage();
    process.exit(1);
  }

  const active = command === "enable" ? 1 : 0;
  const result = db.prepare("UPDATE quotes SET active = ? WHERE id = ?").run(active, id);

  if (result.changes === 0) {
    console.error(`Citação #${id} não encontrada.`);
    process.exit(1);
  }

  console.log(`Citação #${id} ${active ? "ativada" : "desativada"}.`);
  process.exit(0);
}

usage();
process.exit(1);
