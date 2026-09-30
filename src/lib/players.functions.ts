import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

const schema = z.object({
  riotId: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[^#]{3,16}#[^#]{2,5}$/),
  region: z.enum(Object.keys(PLATFORMS) as [string, ...string[]]),
});

export const getPlayers = createServerFn({ method: "GET" })
  .validator((data) =>
    z.object({ search: z.string().max(100), page: z.number().int().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const [{ listPlayers }, { assertRateLimit }] = await Promise.all([
      import("@/lib/postgres-db.server"),
      import("@/lib/rate-limit.server"),
    ]);

    // Large headroom for shared Wi-Fi/CGNAT during an event.
    assertRateLimit("players:list", 3_000, 60_000);

    return listPlayers(data.search.trim(), data.page);
  });

const voteSchema = z.object({
  playerId: z.string().uuid(),
  delta: z.union([z.literal(-5000), z.literal(-1000), z.literal(1000), z.literal(5000)]),
});

export const voteAura = createServerFn({ method: "POST" })
  .validator((data) => voteSchema.parse(data))
  .handler(async ({ data }) => {
    const [{ castVote }, { assertRateLimit }] = await Promise.all([
      import("@/lib/postgres-db.server"),
      import("@/lib/rate-limit.server"),
    ]);

    // Refresh-to-vote remains allowed. This is flood protection, not identity/auth.
    assertRateLimit("players:vote", 600, 60_000);

    return castVote(data.playerId, data.delta);
  });

export const addRiotPlayer = createServerFn({ method: "POST" })
  .validator((d) => schema.parse(d))
  .handler(async ({ data }) => {
    const { assertRateLimit } = await import("@/lib/rate-limit.server");
    assertRateLimit("players:add", 10, 60 * 60_000);

    const key = process.env["RIOT_API_KEY"];
    if (!key) return { ok: false as const, error: "Conexão com a Riot ainda não configurada." };

    const [gameName = "", tagLine = ""] = data.riotId.split("#").map((s) => s.trim());
    const cluster = PLATFORMS[data.region] === "sea" ? "asia" : PLATFORMS[data.region];
    const headers = { "X-Riot-Token": key };

    try {
      const accRes = await fetch(
        `https://${cluster}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
        { headers, signal: AbortSignal.timeout(8_000) },
      );

      if (accRes.status === 404) {
        return { ok: false as const, error: "Esse Riot ID não existe." };
      }

      if (!accRes.ok) {
        console.error("riot account request failed", accRes.status);
        return { ok: false as const, error: "A Riot não respondeu. Tenta de novo já já." };
      }

      const acc = (await accRes.json()) as {
        puuid: string;
        gameName: string;
        tagLine: string;
      };

      const sumRes = await fetch(
        `https://${data.region.toLowerCase()}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(acc.puuid)}`,
        { headers, signal: AbortSignal.timeout(8_000) },
      );

      if (sumRes.status === 404) {
        return { ok: false as const, error: "Essa conta não joga LoL nessa região." };
      }

      if (!sumRes.ok) {
        console.error("riot summoner request failed", sumRes.status);
        return { ok: false as const, error: "A Riot não respondeu. Tenta de novo já já." };
      }

      const sum = (await sumRes.json()) as {
        profileIconId: number;
        summonerLevel: number;
      };

      let version = "15.1.1";
      try {
        const versionResponse = await fetch(
          "https://ddragon.leagueoflegends.com/api/versions.json",
          { signal: AbortSignal.timeout(5_000) },
        );

        if (versionResponse.ok) {
          const versions = (await versionResponse.json()) as string[];
          if (versions[0]) version = versions[0];
        }
      } catch {
        version = "15.1.1";
      }

      const name = `${acc.gameName}#${acc.tagLine}`;
      const { createPlayer, hasPlayer } = await import("@/lib/postgres-db.server");

      if (await hasPlayer(acc.puuid, name)) {
        return { ok: false as const, error: `${name} já está no board.` };
      }

      try {
        await createPlayer({
          name,
          puuid: acc.puuid,
          region: data.region,
          rank_label: `${data.region} · Nv ${sum.summonerLevel}`,
          icon: `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${sum.profileIconId}.png`,
        });
      } catch (error) {
        const code =
          error != null && typeof error === "object" && "code" in error
            ? String(error.code)
            : "";

        if (code === "23505") {
          return { ok: false as const, error: `${name} já está no board.` };
        }

        console.error(error);
        return { ok: false as const, error: "Não deu pra adicionar agora." };
      }

      return { ok: true as const, name };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        console.error("riot request timeout");
        return {
          ok: false as const,
          error: "A Riot demorou demais para responder. Tenta novamente.",
        };
      }

      console.error(error);
      return { ok: false as const, error: "A Riot não respondeu. Tenta de novo já já." };
    }
  });

export const REGIONS = Object.keys(PLATFORMS);
