import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PLATFORMS: Record<string, string> = {
  BR1: "americas", NA1: "americas", LA1: "americas", LA2: "americas",
  EUW1: "europe", EUN1: "europe", TR1: "europe", RU: "europe",
  KR: "asia", JP1: "asia", OC1: "sea", VN2: "sea", SG2: "sea", TW2: "sea", PH2: "sea", TH2: "sea",
};

const schema = z.object({
  riotId: z.string().trim().min(3).max(40).regex(/^[^#]{3,16}#[^#]{2,5}$/),
  region: z.enum(Object.keys(PLATFORMS) as [string, ...string[]]),
});

export const addRiotPlayer = createServerFn({ method: "POST" })
  .inputValidator((d) => schema.parse(d))
  .handler(async ({ data }) => {
    const key = process.env["RIOT_API_KEY"];
    if (!key) return { ok: false as const, error: "Conexão com a Riot ainda não configurada." };
    const [gameName, tagLine] = data.riotId.split("#").map((s) => s.trim());
    const cluster = PLATFORMS[data.region] === "sea" ? "asia" : PLATFORMS[data.region];
    const headers = { "X-Riot-Token": key };

    const accRes = await fetch(
      `https://${cluster}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      { headers },
    );
    if (accRes.status === 404) return { ok: false as const, error: "Esse Riot ID não existe." };
    if (!accRes.ok) {
      console.error("riot account", accRes.status, await accRes.text());
      return { ok: false as const, error: "A Riot não respondeu. Tenta de novo já já." };
    }
    const acc = (await accRes.json()) as { puuid: string; gameName: string; tagLine: string };

    const sumRes = await fetch(
      `https://${data.region.toLowerCase()}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${acc.puuid}`,
      { headers },
    );
    if (sumRes.status === 404)
      return { ok: false as const, error: "Essa conta não joga LoL nessa região." };
    if (!sumRes.ok) {
      console.error("riot summoner", sumRes.status, await sumRes.text());
      return { ok: false as const, error: "A Riot não respondeu. Tenta de novo já já." };
    }
    const sum = (await sumRes.json()) as { profileIconId: number; summonerLevel: number };

    let version = "15.1.1";
    try {
      const v = (await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json()) as string[];
      if (v[0]) version = v[0];
    } catch {}

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const name = `${acc.gameName}#${acc.tagLine}`;
    const { data: existing } = await supabaseAdmin
      .from("players").select("id").or(`puuid.eq.${acc.puuid},name.eq.${name}`).maybeSingle();
    if (existing) return { ok: false as const, error: `${name} já está no board.` };

    const { error } = await supabaseAdmin.from("players").insert({
      name,
      puuid: acc.puuid,
      region: data.region,
      rank_label: `${data.region} · Nv ${sum.summonerLevel}`,
      icon: `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${sum.profileIconId}.png`,
      aura: 0,
    });
    if (error) {
      console.error(error);
      return { ok: false as const, error: "Não deu pra adicionar agora." };
    }
    return { ok: true as const, name };
  });

export const REGIONS = Object.keys(PLATFORMS);
