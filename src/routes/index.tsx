import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { addRiotPlayer, REGIONS } from "@/lib/players.functions";

import iconFaker from "@/assets/icon-faker.jpg";
import iconCaps from "@/assets/icon-caps.jpg";
import iconChovy from "@/assets/icon-chovy.jpg";
import iconKnight from "@/assets/icon-knight.jpg";
import iconGumayusi from "@/assets/icon-gumayusi.jpg";
import iconDoublelift from "@/assets/icon-doublelift.jpg";

const ICONS: Record<string, string> = {
  faker: iconFaker,
  caps: iconCaps,
  chovy: iconChovy,
  knight: iconKnight,
  gumayusi: iconGumayusi,
  doublelift: iconDoublelift,
};

const DELTAS = [-5000, -1000, 1000, 5000] as const;

type Player = {
  id: string;
  name: string;
  rank_label: string;
  icon: string;
  aura: number;
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aura Farming — Farme aura nos pros de LoL" },
      {
        name: "description",
        content:
          "Farme aura nos seus jogadores favoritos de League of Legends. Sem conta, sem login: um voto por sessão. Quem carrega a aura desse patch?",
      },
      { property: "og:title", content: "Aura Farming — Farme aura nos pros de LoL" },
      {
        property: "og:description",
        content:
          "Vote +5000 ou -5000 de aura nos pros de LoL. Um voto por sessão, ranking ao vivo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function getSessionId(): string {
  const key = "aura-farming-session";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function formatAura(n: number): string {
  return n.toLocaleString("pt-BR");
}

function formatDelta(d: number): string {
  return d > 0 ? `+${d / 1000}k` : `−${Math.abs(d) / 1000}k`;
}

function Index() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [voted, setVoted] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem("aura-farming-votes") ?? "{}");
    } catch {
      return {};
    }
  });
  const [pending, setPending] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [riotId, setRiotId] = useState("");
  const [region, setRegion] = useState("BR1");
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const addPlayerFn = useServerFn(addRiotPlayer);

  const sessionId = useMemo(() => {
    if (typeof window === "undefined") return "";
    return getSessionId();
  }, []);

  useEffect(() => {
    localStorage.setItem("aura-farming-votes", JSON.stringify(voted));
  }, [voted]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("players")
      .select("id, name, rank_label, icon, aura")
      .order("aura", { ascending: false })
      .then(({ data }) => {
        if (!cancelled && data) setPlayers(data as Player[]);
        if (!cancelled) setLoading(false);
      });

    const channel = supabase
      .channel("players-aura")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "players" },
        (payload) => {
          const row = payload.new as Player;
          setPlayers((prev) =>
            prev.some((p) => p.id === row.id)
              ? prev
              : [...prev, row].sort((a, b) => b.aura - a.aura),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "players" },
        (payload) => {
          const row = payload.new as Player;
          setPlayers((prev) =>
            prev
              .map((p) => (p.id === row.id ? { ...p, aura: row.aura } : p))
              .sort((a, b) => b.aura - a.aura),
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  async function vote(player: Player, delta: number) {
    if (voted[player.id] !== undefined || pending) return;
    setPending(player.id);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc("vote_aura", {
      p_player_id: player.id,
      p_session_id: sessionId,
      p_delta: delta,
    });

    setPending(null);

    if (rpcError) {
      if (rpcError.message.includes("already_voted")) {
        setVoted((v) => ({ ...v, [player.id]: 0 }));
        setError(`Você já farmou aura no ${player.name} nessa sessão.`);
      } else {
        setError("Algo deu errado no rift. Tenta de novo.");
      }
      return;
    }

    setVoted((v) => ({ ...v, [player.id]: delta }));
    setPlayers((prev) =>
      prev
        .map((p) => (p.id === player.id ? { ...p, aura: data as number } : p))
        .sort((a, b) => b.aura - a.aura),
    );
    setTicked(player.id);
    setTimeout(() => setTicked(null), 700);
  }

  async function submitPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^#]{3,16}#[^#]{2,5}$/.test(riotId.trim())) {
      setAddMsg({ ok: false, text: "Use o formato Nick#TAG." });
      return;
    }
    setAdding(true);
    setAddMsg(null);
    try {
      const res = await addPlayerFn({ data: { riotId: riotId.trim(), region } });
      if (res.ok) {
        setAddMsg({ ok: true, text: `${res.name} entrou no board. Bora farmar aura!` });
        setRiotId("");
      } else setAddMsg({ ok: false, text: res.error });
    } catch {
      setAddMsg({ ok: false, text: "Algo deu errado. Tenta de novo." });
    } finally {
      setAdding(false);
    }
  }

  const totalAura = players.reduce((sum, p) => sum + p.aura, 0);
  const maxAura = players.length ? Math.max(...players.map((p) => Math.abs(p.aura)), 1) : 1;

  return (
    <div className="min-h-screen bg-void text-ink selection:bg-crest/30">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(1100px 520px at 50% -12%, rgba(10,200,185,0.14), transparent 62%), radial-gradient(900px 460px at 88% 110%, rgba(200,162,74,0.12), transparent 55%)",
        }}
      />

      <div className="relative mx-auto max-w-6xl px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="clip-hex grid size-10 animate-aurglow place-items-center border border-sigil/60 bg-steel/60">
              <span className="font-display text-xl font-bold text-sigil">A</span>
            </div>
            <div>
              <div className="font-display text-lg font-bold leading-none tracking-[0.18em]">
                AURA<span className="text-sigil"> · </span>FARMING
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.35em] text-mist">
                Runeterra aura ledger
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs uppercase tracking-widest text-mist sm:flex">
            <span className="size-1.5 animate-aurglow rounded-full bg-crest" />
            Live session
          </div>
        </header>

        <section className="mb-8 mt-10 max-w-2xl">
          <div className="mb-3 text-xs uppercase tracking-[0.4em] text-crest">
            Season 2026 · Ranked
          </div>
          <h1 className="font-display text-4xl leading-[1.05] sm:text-5xl">
            Farme a <span className="text-sigil">aura.</span>
            <br />
            <span className="text-mist">Veja o brilho do ranking subir.</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-mist/90 sm:text-base">
            Sem conta. Só vibes. Vote aura em qualquer pro — um voto por sessão e
            depois trava. Quem carrega a aura desse patch?
          </p>
        </section>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="flex items-end gap-6 border-t-2 border-sigil/70 pt-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.25em] text-mist">
                Aura total farmada
              </div>
              <div className="text-3xl font-bold tabular-nums text-sigilsoft">
                {formatAura(totalAura)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.25em] text-mist">
                Pros no board
              </div>
              <div className="text-3xl font-bold tabular-nums">{players.length}</div>
            </div>
          </div>
          <div className="flex items-center border border-hexline/60 bg-abyss/40 p-4 lg:col-span-2">
            <div className="text-xs leading-relaxed text-mist">
              <span className="font-semibold text-sigil">Regra da sessão:</span>{" "}
              cada pro recebe um voto por sessão do navegador. O board é público e
              ao vivo — sem login, sem medo de cooldown, só o grind.
            </div>
          </div>
        </section>

        <form
          onSubmit={submitPlayer}
          className="mt-10 flex flex-col gap-2 border border-sigil/40 bg-abyss/50 p-4 sm:flex-row sm:items-center"
        >
          <div className="text-xs uppercase tracking-[0.25em] text-sigil sm:mr-2">
            Adicionar player
          </div>
          <input
            value={riotId}
            onChange={(e) => setRiotId(e.target.value)}
            placeholder="Nick#TAG"
            className="flex-1 border border-hexline/70 bg-steel/40 px-3 py-2 text-sm text-ink placeholder:text-mist/60 focus:border-sigil focus:outline-none"
          />
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="border border-hexline/70 bg-steel/40 px-3 py-2 text-sm text-ink"
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            disabled={adding}
            className="border border-sigil/60 bg-sigil/15 px-4 py-2 text-sm font-semibold text-sigilsoft hover:bg-sigil/25 disabled:opacity-50"
          >
            {adding ? "Verificando…" : "Invocar"}
          </button>
        </form>
        {addMsg && (
          <div className={`mt-2 text-sm ${addMsg.ok ? "text-crest" : "text-destructive"}`}>
            {addMsg.text}
          </div>
        )}

        <div className="mb-6 mt-12 flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-[0.35em] text-mist">
            Top aura · ao vivo
          </h2>
          <div className="text-xs uppercase tracking-widest text-mist/70">
            Ranqueado por aura
          </div>
        </div>

        {error && (
          <div className="mb-4 border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm uppercase tracking-[0.3em] text-mist">
            Carregando o rift…
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {players.map((player, i) => {
              const hasVoted = voted[player.id] !== undefined;
              const isPending = pending === player.id;
              return (
                <div
                  key={player.id}
                  className="clip-card group border border-hexline/60 bg-abyss/50 transition-colors hover:border-sigil/50"
                >
                  <div className="flex items-center gap-3 px-4 pt-4">
                    <img
                      src={player.icon.startsWith("http") ? player.icon : (ICONS[player.icon] ?? iconFaker)}
                      alt={`Ícone de ${player.name}`}
                      loading="lazy"
                      width={48}
                      height={48}
                      className="size-12 shrink-0 rounded-sm object-cover outline-1 -outline-offset-1 outline-black/20"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-sigil">#{i + 1}</span>
                        <span className="text-[11px] uppercase tracking-widest text-crest">
                          {player.rank_label}
                        </span>
                      </div>
                      <div className="truncate font-display font-bold tracking-wide">
                        {player.name}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 px-4">
                    <div className="flex items-baseline justify-between">
                      <span
                        key={player.aura}
                        className={`text-2xl font-bold tabular-nums ${player.aura < 0 ? "text-destructive" : "text-sigilsoft"} ${
                          ticked === player.id ? "animate-aura-tick" : ""
                        }`}
                      >
                        {formatAura(player.aura)}
                      </span>
                      <span className="text-[11px] uppercase tracking-widest text-crest">
                        aura
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden bg-steel">
                      <div
                        className="h-full bg-gradient-to-r from-sigil to-crest transition-all duration-500"
                        style={{
                          width: `${Math.max(4, Math.round((Math.abs(player.aura) / maxAura) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 px-4 py-4">
                    {DELTAS.map((delta) => {
                      const positive = delta > 0;
                      return (
                        <button
                          key={delta}
                          disabled={hasVoted || isPending}
                          onClick={() => vote(player, delta)}
                          className={`py-2 text-sm font-semibold transition-colors ${
                            positive
                              ? "border border-sigil/40 bg-sigil/10 text-sigilsoft hover:bg-sigil/20"
                              : "border border-hexline/70 bg-steel/40 text-mist hover:bg-hex"
                          } ${
                            hasVoted || isPending
                              ? "cursor-not-allowed opacity-40"
                              : ""
                          } ${
                            hasVoted && voted[player.id] === delta
                              ? "opacity-100 ring-1 ring-sigil"
                              : ""
                          }`}
                        >
                          {formatDelta(delta)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        <footer className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-hexline/40 pt-6 text-[11px] uppercase tracking-widest text-mist/70 sm:flex-row">
          <span>Aura Farming · conceito de fã não-oficial</span>
          <span>Farme aura · um voto por sessão</span>
        </footer>
      </div>
    </div>
  );
}
