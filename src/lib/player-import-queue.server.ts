import { randomUUID } from "node:crypto";
import {
  createPlayer,
  getDatabasePool,
  getPlayerByPuuid,
  hasPlayer,
  updatePlayerIdentityByPuuid,
} from "@/lib/postgres-db.server";

const JOB_INTERVAL_MS = 1_000;
const IDLE_LOOP_MS = 1_000;
const ACTIVE_LOOP_MS = 50;
const MAX_ATTEMPTS = 5;
const STALE_RECOVERY_INTERVAL_MS = 60_000;

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

const MAX_ACTIVE_IMPORTS = readPositiveInt(
  "PLAYER_IMPORT_BACKLOG_MAX",
  50_000,
  100,
  1_000_000,
);

const PLATFORMS: Record<string, string> = {
  BR1: "americas",
  NA1: "americas",
  LA1: "americas",
  LA2: "americas",
  EUW1: "europe",
  EUN1: "europe",
  TR1: "europe",
  RU: "europe",
  KR: "asia",
  JP1: "asia",
  OC1: "sea",
  VN2: "sea",
  SG2: "sea",
  TW2: "sea",
  PH2: "sea",
  TH2: "sea",
};

type Status =
  | "pending"
  | "processing"
  | "completed"
  | "duplicate"
  | "failed";

type Job = {
  id: string;
  riot_id: string;
  region: string;
  status: Status;
  attempts: number;
};

const g = globalThis as typeof globalThis & {
  auraPlayerImportWorkerStarted?: boolean;
  auraDdragonVersion?: {
    version: string;
    expiresAt: number;
  };
  auraQueueLastCleanupAt?: number;
  auraQueueLastStaleRecoveryAt?: number;
};

function normalizeRiotId(value: string): string {
  const [gameName = "", tagLine = ""] = value
    .split("#")
    .map((part) => part.trim());

  return `${gameName}#${tagLine}`;
}

export async function enqueuePlayerImport(
  riotId: string,
  region: string,
) {
  const normalized = normalizeRiotId(riotId);
  const db = await getDatabasePool();

  const exists = await db.query(
    `
      SELECT 1
      FROM players
      WHERE lower(name) = lower($1)
      LIMIT 1
    `,
    [normalized],
  );

  if ((exists.rowCount ?? 0) > 0) {
    return {
      ok: false as const,
      error: `${normalized} já está no ranking.`,
    };
  }

  const active = await db.query<{ id: string }>(
    `
      SELECT id
      FROM player_import_queue
      WHERE lower(riot_id) = lower($1)
        AND region = $2
        AND status IN ('pending', 'processing')
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [normalized, region],
  );

  if (active.rows[0]) {
    return {
      ok: true as const,
      requestId: active.rows[0].id,
      alreadyQueued: true,
    };
  }

  const backlog = await db.query<{ total: number }>(
    `
      SELECT COUNT(*)::INT AS total
      FROM player_import_queue
      WHERE status IN ('pending', 'processing')
    `,
  );

  if (Number(backlog.rows[0]?.total ?? 0) >= MAX_ACTIVE_IMPORTS) {
    return {
      ok: false as const,
      error:
        "A fila de validação está temporariamente cheia. Tente novamente mais tarde.",
    };
  }

  const id = randomUUID();

  try {
    await db.query(
      `
        INSERT INTO player_import_queue (id, riot_id, region)
        VALUES ($1, $2, $3)
      `,
      [id, normalized, region],
    );

    return {
      ok: true as const,
      requestId: id,
      alreadyQueued: false,
    };
  } catch (error) {
    const code =
      error != null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";

    if (code === "23505") {
      const raced = await db.query<{ id: string }>(
        `
          SELECT id
          FROM player_import_queue
          WHERE lower(riot_id) = lower($1)
            AND region = $2
            AND status IN ('pending', 'processing')
          ORDER BY created_at ASC
          LIMIT 1
        `,
        [normalized, region],
      );

      if (raced.rows[0]) {
        return {
          ok: true as const,
          requestId: raced.rows[0].id,
          alreadyQueued: true,
        };
      }
    }

    throw error;
  }
}

export async function getPlayerImportStatus(requestId: string) {
  const db = await getDatabasePool();

  const result = await db.query<{
    riot_id: string;
    region: string;
    status: Status;
    attempts: number;
    result_name: string | null;
    last_error: string | null;
  }>(
    `
      SELECT
        riot_id,
        region,
        status,
        attempts,
        result_name,
        last_error
      FROM player_import_queue
      WHERE id = $1
      LIMIT 1
    `,
    [requestId],
  );

  const row = result.rows[0];

  if (!row) {
    return {
      found: false as const,
    };
  }

  return {
    found: true as const,
    status: row.status,
    riotId: row.riot_id,
    region: row.region,
    attempts: row.attempts,
    name: row.result_name,
    error: row.last_error,
  };
}

async function recoverStaleJobsIfNeeded(): Promise<void> {
  const now = Date.now();
  const lastRecovery = g.auraQueueLastStaleRecoveryAt ?? 0;

  if (now - lastRecovery < STALE_RECOVERY_INTERVAL_MS) return;

  const db = await getDatabasePool();

  await db.query(`
    UPDATE player_import_queue
    SET status = 'pending',
        claimed_at = NULL,
        available_at = NOW()
    WHERE status = 'processing'
      AND claimed_at < NOW() - INTERVAL '5 minutes'
  `);

  g.auraQueueLastStaleRecoveryAt = Date.now();
}

async function claim(): Promise<Job | null> {
  await recoverStaleJobsIfNeeded();

  const db = await getDatabasePool();
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // First check whether there is actual work. When the queue is empty this
    // avoids writing/locking player_import_control on every worker tick.
    const candidate = await client.query<Job>(
      `
        SELECT
          id,
          riot_id,
          region,
          status,
          attempts
        FROM player_import_queue
        WHERE status = 'pending'
          AND available_at <= NOW()
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `,
    );

    const row = candidate.rows[0];

    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }

    const permit = await client.query(
      `
        UPDATE player_import_control
        SET next_allowed_at =
          NOW() + ($1 * INTERVAL '1 millisecond')
        WHERE id = TRUE
          AND next_allowed_at <= NOW()
        RETURNING next_allowed_at
      `,
      [JOB_INTERVAL_MS],
    );

    if ((permit.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const claimed = await client.query<Job>(
      `
        UPDATE player_import_queue
        SET status = 'processing',
            claimed_at = NOW(),
            attempts = attempts + 1,
            last_error = NULL
        WHERE id = $1
        RETURNING
          id,
          riot_id,
          region,
          status,
          attempts
      `,
      [row.id],
    );

    await client.query("COMMIT");

    return claimed.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function complete(
  id: string,
  name: string,
  status: "completed" | "duplicate",
): Promise<void> {
  const db = await getDatabasePool();

  await db.query(
    `
      UPDATE player_import_queue
      SET status = $2,
          result_name = $3,
          processed_at = NOW(),
          claimed_at = NULL,
          last_error = NULL
      WHERE id = $1
    `,
    [id, status, name],
  );
}

async function fail(id: string, message: string): Promise<void> {
  const db = await getDatabasePool();

  await db.query(
    `
      UPDATE player_import_queue
      SET status = 'failed',
          processed_at = NOW(),
          claimed_at = NULL,
          last_error = $2
      WHERE id = $1
    `,
    [id, message],
  );
}

async function retry(
  id: string,
  attempts: number,
  message: string,
  delay?: number,
): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await fail(id, message);
    return;
  }

  const seconds = delay ?? Math.min(60, 2 ** attempts * 2);
  const db = await getDatabasePool();

  await db.query(
    `
      UPDATE player_import_queue
      SET status = 'pending',
          claimed_at = NULL,
          available_at =
            NOW() + ($2 * INTERVAL '1 second'),
          last_error = $3
      WHERE id = $1
    `,
    [id, seconds, message],
  );
}

function retryAfter(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;

  const seconds = Number(raw);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }

  const retryDate = Date.parse(raw);

  return Number.isNaN(retryDate)
    ? undefined
    : Math.max(
        1,
        Math.ceil((retryDate - Date.now()) / 1_000),
      );
}

async function ddragonVersion(): Promise<string> {
  if (
    g.auraDdragonVersion &&
    g.auraDdragonVersion.expiresAt > Date.now()
  ) {
    return g.auraDdragonVersion.version;
  }

  try {
    const response = await fetch(
      "https://ddragon.leagueoflegends.com/api/versions.json",
      {
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (response.ok) {
      const versions = (await response.json()) as string[];

      if (versions[0]) {
        g.auraDdragonVersion = {
          version: versions[0],
          expiresAt: Date.now() + 60 * 60_000,
        };

        return versions[0];
      }
    }
  } catch {
    // A temporary Data Dragon failure must not block the import.
  }

  return "15.1.1";
}

async function processJob(job: Job): Promise<void> {
  const key = process.env["RIOT_API_KEY"];

  if (!key) {
    await retry(
      job.id,
      job.attempts,
      "Integração com a Riot indisponível no momento.",
      60,
    );
    return;
  }

  const [gameName = "", tagLine = ""] = job.riot_id
    .split("#")
    .map((part) => part.trim());

  const group = PLATFORMS[job.region];

  if (!group) {
    await fail(job.id, "Região inválida.");
    return;
  }

  const cluster = group === "sea" ? "asia" : group;
  const headers = {
    "X-Riot-Token": key,
  };

  try {
    const accountResponse = await fetch(
      `https://${cluster}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      {
        headers,
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (accountResponse.status === 404) {
      await fail(job.id, "Esse Riot ID não existe.");
      return;
    }

    if (accountResponse.status === 429) {
      await retry(
        job.id,
        job.attempts,
        "A Riot limitou temporariamente as consultas. Tentaremos novamente.",
        retryAfter(accountResponse),
      );
      return;
    }

    if (accountResponse.status >= 500) {
      await retry(
        job.id,
        job.attempts,
        "A Riot está temporariamente indisponível.",
      );
      return;
    }

    if (!accountResponse.ok) {
      console.error(
        "riot queued account request failed",
        accountResponse.status,
      );
      await fail(
        job.id,
        "Não foi possível validar esse Riot ID.",
      );
      return;
    }

    const account = (await accountResponse.json()) as {
      puuid: string;
      gameName: string;
      tagLine: string;
    };

    const name = `${account.gameName}#${account.tagLine}`;
    const existingByPuuid = await getPlayerByPuuid(account.puuid);

    const summonerResponse = await fetch(
      `https://${job.region.toLowerCase()}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`,
      {
        headers,
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (summonerResponse.status === 404) {
      await fail(
        job.id,
        "Essa conta não joga LoL nessa região.",
      );
      return;
    }

    if (summonerResponse.status === 429) {
      await retry(
        job.id,
        job.attempts,
        "A Riot limitou temporariamente as consultas. Tentaremos novamente.",
        retryAfter(summonerResponse),
      );
      return;
    }

    if (summonerResponse.status >= 500) {
      await retry(
        job.id,
        job.attempts,
        "A Riot está temporariamente indisponível.",
      );
      return;
    }

    if (!summonerResponse.ok) {
      console.error(
        "riot queued summoner request failed",
        summonerResponse.status,
      );
      await fail(
        job.id,
        "Não foi possível consultar essa conta na Riot.",
      );
      return;
    }

    const summoner = (await summonerResponse.json()) as {
      profileIconId: number;
      summonerLevel: number;
    };

    const version = await ddragonVersion();
    const rankLabel =
      `${job.region} · Nv ${summoner.summonerLevel}`;
    const icon =
      `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${summoner.profileIconId}.png`;

    if (existingByPuuid) {
      try {
        await updatePlayerIdentityByPuuid(account.puuid, {
          name,
          rank_label: rankLabel,
          icon,
          region: job.region,
        });
      } catch (error) {
        const code =
          error != null &&
          typeof error === "object" &&
          "code" in error
            ? String(error.code)
            : "";

        if (code === "23505") {
          await complete(job.id, name, "duplicate");
          return;
        }

        throw error;
      }

      await complete(job.id, name, "completed");
      return;
    }

    if (await hasPlayer(account.puuid, name)) {
      await complete(job.id, name, "duplicate");
      return;
    }

    try {
      await createPlayer({
        name,
        puuid: account.puuid,
        region: job.region,
        rank_label: rankLabel,
        icon,
      });
    } catch (error) {
      const code =
        error != null &&
        typeof error === "object" &&
        "code" in error
          ? String(error.code)
          : "";

      if (code === "23505") {
        await complete(job.id, name, "duplicate");
        return;
      }

      throw error;
    }

    await complete(job.id, name, "completed");
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.name === "TimeoutError" ||
        error.name === "AbortError"
      )
    ) {
      await retry(
        job.id,
        job.attempts,
        "A Riot demorou para responder. Tentaremos novamente.",
      );
      return;
    }

    console.error("player import queue job failed", error);

    await retry(
      job.id,
      job.attempts,
      "Falha temporária ao processar o jogador.",
    );
  }
}

async function cleanup(): Promise<void> {
  const now = Date.now();

  if (
    g.auraQueueLastCleanupAt &&
    now - g.auraQueueLastCleanupAt < 60 * 60_000
  ) {
    return;
  }

  const db = await getDatabasePool();

  await db.query(`
    DELETE FROM player_import_queue
    WHERE status IN ('completed', 'duplicate', 'failed')
      AND processed_at < NOW() - INTERVAL '7 days'
  `);

  g.auraQueueLastCleanupAt = Date.now();
}

async function loop(): Promise<void> {
  let delay = IDLE_LOOP_MS;

  try {
    await cleanup();

    const job = await claim();

    if (job) {
      delay = ACTIVE_LOOP_MS;
      await processJob(job);
    }
  } catch (error) {
    console.error("player import queue worker error", error);
  } finally {
    setTimeout(() => {
      void loop();
    }, delay);
  }
}

export function ensurePlayerImportWorker(): void {
  if (g.auraPlayerImportWorkerStarted) return;

  g.auraPlayerImportWorkerStarted = true;
  void loop();
}
