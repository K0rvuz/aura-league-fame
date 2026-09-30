import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";

type ContentPageProps = {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
};

export function ContentPage({ eyebrow, title, intro, children }: ContentPageProps) {
  return (
    <div className="min-h-screen bg-void text-ink">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(900px 460px at 50% -12%, rgba(10,200,185,0.10), transparent 62%), radial-gradient(700px 420px at 88% 110%, rgba(200,162,74,0.08), transparent 55%)",
        }}
      />

      <div className="relative mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <header className="flex items-center justify-between border-b border-hexline/40 pb-5">
          <Link to="/" className="font-display text-sm font-bold tracking-[0.18em]">
            AURA<span className="text-sigil"> · </span>FARMING
          </Link>
          <Link
            to="/"
            className="text-xs uppercase tracking-widest text-mist transition-colors hover:text-sigilsoft"
          >
            Voltar ao ranking
          </Link>
        </header>

        <main className="py-12">
          <div className="text-xs uppercase tracking-[0.35em] text-crest">{eyebrow}</div>
          <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{title}</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-mist">{intro}</p>

          <div className="mt-10 space-y-8 text-sm leading-7 text-mist/95">{children}</div>
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}

export function PolicySection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
