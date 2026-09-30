import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-hexline/40 pt-6 text-[11px] uppercase tracking-widest text-mist/70">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <span>Aura Farming · projeto de fã não-oficial</span>

        <nav aria-label="Links institucionais" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link to="/about" className="transition-colors hover:text-sigilsoft">
            Sobre
          </Link>
          <Link to="/privacy" className="transition-colors hover:text-sigilsoft">
            Privacidade
          </Link>
          <Link to="/terms" className="transition-colors hover:text-sigilsoft">
            Termos
          </Link>
        </nav>
      </div>
    </footer>
  );
}
