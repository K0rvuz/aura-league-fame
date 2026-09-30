import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { addRiotPlayer, getPlayers, REGIONS, voteAura } from "@/lib/players.functions";
import { AdSlot } from "@/components/ad-slot";
import { SiteFooter } from "@/components/site-footer";

const DELTAS = [-5000, -1000, 1000, 5000] as const;
const PAGE_SIZE = 10;

type Player = {
  id: string;
  name: string;
  rank_label: string;
  icon: string;
  aura: number;
  quote: string | null;
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aura Farming — Ranking de aura dos jogadores de LoL" },
      {
        name: "description",
        content:
          "Vote nos jogadores de League of Legends e acompanhe o ranking de aura da comunidade em tempo real.",
      },
      { property: "og:title", content: "Aura Farming — Ranking de aura dos jogadores de LoL" },
      {
        property: "og:description",
        content:
          "Vote nos jogadores de League of Legends e acompanhe o ranking de aura da comunidade em tempo real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});


function formatAura(n: number): string {
  return n.toLocaleString("pt-BR");
}

function formatDelta(d: number): string {
  return d > 0 ? `+${d / 1000}k` : `−${Math.abs(d) / 1000}k`;
}

function Index() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [playerCount, setPlayerCount] = useState(0);
  const [totalAura, setTotalAura] = useState(0);
  const [voted, setVoted] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [riotId, setRiotId] = useState("");
  const [region, setRegion] = useState("BR1");
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const quoteCache = useRef<Record<string, string | null>>({});

  const getPlayersFn = useServerFn(getPlayers);
  const addPlayerFn = useServerFn(addRiotPlayer);
  const voteAuraFn = useServerFn(voteAura);
  const deferredSearch = useDeferredValue(search.trim());
  const pageCount = Math.max(1, Math.ceil(totalPlayers / PAGE_SIZE));


  useEffect(() => {
    let cancelled = false;

    const refreshPlayers = async () => {
      try {
        const result = await getPlayersFn({ data: { search: deferredSearch, page } });

        if (!cancelled) {
          const stableQuotes = result.players.map((player) => {
            if (!(player.id in quoteCache.current)) {
              const quotes = player.quotes ?? [];
              quoteCache.current[player.id] =
                quotes.length > 0
                  ? quotes[Math.floor(Math.random() * quotes.length)] ?? null
                  : null;
            }

            return {
              id: player.id,
              name: player.name,
              rank_label: player.rank_label,
              icon: player.icon,
              aura: player.aura,
              quote: quoteCache.current[player.id] ?? null,
            };
          });

          setPlayers(stableQuotes);
          setTotalPlayers(result.total);
          setPlayerCount(result.playerCount);
          setTotalAura(result.totalAura);
        }
      } catch {
        if (!cancelled) setError("Não foi possível carregar os jogadores.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void refreshPlayers();

    const interval = window.setInterval(() => {
      if (!document.hidden) void refreshPlayers();
    }, 15_000);

    const handleVisibilityChange = () => {
      if (!document.hidden) void refreshPlayers();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [deferredSearch, getPlayersFn, page]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  async function vote(player: Player, delta: number) {
    if (voted[player.id] !== undefined || pending) return;
    setPending(player.id);
    setError(null);

    try {
      const aura = await voteAuraFn({
        data: { playerId: player.id, delta },
      });
      setVoted((v) => ({ ...v, [player.id]: delta }));
      setPlayers((prev) =>
        prev.map((p) => (p.id === player.id ? { ...p, aura } : p)).sort((a, b) => b.aura - a.aura),
      );
      setTotalAura((current) => current + delta);
      setTicked(player.id);
      setTimeout(() => setTicked(null), 700);
    } catch {
      setError("Não foi possível registrar o voto. Tente novamente.");
    } finally {
      setPending(null);
    }
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
        setAddMsg({ ok: true, text: `${res.name} foi adicionado ao ranking.` });
        setRiotId("");
      } else setAddMsg({ ok: false, text: res.error });
    } catch {
      setAddMsg({ ok: false, text: "Não foi possível adicionar o jogador. Tente novamente." });
    } finally {
      setAdding(false);
    }
  }

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

      <div className="relative mx-auto grid w-full max-w-[1540px] grid-cols-1 gap-6 px-5 py-6 sm:px-8 xl:grid-cols-[180px_minmax(0,72rem)_180px] xl:items-start xl:justify-center">
        <aside className="hidden xl:block" aria-label="Publicidade lateral esquerda">
          <div className="sticky top-6">
            <AdSlot slot="8146812198" />
          </div>
        </aside>

        <main className="min-w-0">
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
                Ranking de aura da comunidade
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs uppercase tracking-widest text-mist sm:flex">
            <span className="size-1.5 animate-aurglow rounded-full bg-crest" />
            Ranking ao vivo
          </div>
        </header>

        <section className="mb-8 mt-10 max-w-2xl">
          <div className="mb-3 text-xs uppercase tracking-[0.4em] text-crest">
            Temporada 2026 · Ranking
          </div>
          <h1 className="font-display text-4xl leading-[1.05] sm:text-5xl">
            Quem tem mais <span className="text-sigil">aura?</span>
            <br />
            <span className="text-mist">A comunidade decide.</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-mist/90 sm:text-base">
            Vote nos jogadores e acompanhe o ranking em tempo real.

          </p>
        </section>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="flex items-end gap-6 border-t-2 border-sigil/70 pt-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.25em] text-mist">
                Aura total
              </div>
              <div className="text-3xl font-bold tabular-nums text-sigilsoft">
                {formatAura(totalAura)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.25em] text-mist">Jogadores no ranking</div>
              <div className="text-3xl font-bold tabular-nums">{playerCount}</div>
            </div>
          </div>
          <div className="flex items-center border border-hexline/60 bg-abyss/40 p-4 lg:col-span-2">
            <div className="text-xs leading-relaxed text-mist">
              <span className="font-semibold text-sigil">Como funciona:</span> cada rodada permite
              um voto por jogador. O ranking é público e atualizado automaticamente.
            </div>
          </div>
        </section>

        <form
          onSubmit={submitPlayer}
          className="mt-10 flex flex-col gap-2 border border-sigil/40 bg-abyss/50 p-4 sm:flex-row sm:items-center"
        >
          <div className="text-xs uppercase tracking-[0.25em] text-sigil sm:mr-2">
            Adicionar jogador
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
              <option key={r} value={r}>
                {r}
              </option>
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

        <div className="mb-6 mt-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm uppercase tracking-[0.35em] text-mist">Ranking de aura</h2>
            <div className="mt-2 text-xs uppercase tracking-widest text-mist/70">
              Maior pontuação primeiro
            </div>
          </div>
          <label className="relative block w-full sm:max-w-xs">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist/70"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar nick"
              aria-label="Buscar jogador pelo nick"
              className="w-full border border-hexline/70 bg-steel/40 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-mist/60 focus:border-sigil focus:outline-none"
            />
          </label>
        </div>

        {error && (
          <div className="mb-4 border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm uppercase tracking-[0.3em] text-mist">
            Carregando ranking…
          </div>
        ) : players.length === 0 ? (
          <div className="border-t border-hexline/50 py-10 text-center text-sm text-mist">
            {deferredSearch ? "Nenhum jogador encontrado." : "Nenhum jogador no ranking ainda."}
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
                      src={player.icon}
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

                  {player.quote && (
                    <div className="mx-4 mt-3 border-l-2 border-sigil/35 pl-3">
                      <p className="text-sm italic leading-relaxed text-mist/90">
                        “{player.quote}”
                      </p>
                    </div>
                  )}

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
                      <span className="text-[11px] uppercase tracking-widest text-crest">aura</span>
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
                          } ${hasVoted || isPending ? "cursor-not-allowed opacity-40" : ""} ${
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

        {!loading && totalPlayers > 0 && (
          <div className="mt-6 flex flex-col gap-3 border-t border-hexline/40 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-mist">
              Mostrando {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + players.length} de{" "}
              {totalPlayers} jogadores
            </span>
            <nav aria-label="Paginação de jogadores" className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="inline-flex h-9 items-center gap-1 border border-hexline/70 px-3 text-mist transition-colors hover:bg-steel/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
                Anterior
              </button>
              <span aria-live="polite" className="min-w-16 text-center tabular-nums text-ink">
                {page} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={page >= pageCount}
                className="inline-flex h-9 items-center gap-1 border border-hexline/70 px-3 text-mist transition-colors hover:bg-steel/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Próxima
                <ChevronRight aria-hidden="true" className="size-4" />
              </button>
            </nav>
          </div>
        )}

          <SiteFooter />
        </main>

        <aside className="hidden xl:block" aria-label="Publicidade lateral direita">
          <div className="sticky top-6">
            <AdSlot slot="6162898255" />
          </div>
        </aside>
      </div>
    </div>
  );
}

