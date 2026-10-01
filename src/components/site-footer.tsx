import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-hexline/40 pt-6 text-[11px] uppercase tracking-widest text-mist/70">
      <div className="grid grid-cols-1 items-center gap-4 text-center sm:grid-cols-[1fr_auto_1fr] sm:text-left">
        <span className="sm:justify-self-start">
          Aura Farming · ranking comunitário não oficial
        </span>

        <a
          href="https://ko-fi.com/korvuzdev"
          target="_blank"
          rel="noopener noreferrer"
          className="justify-self-center transition-colors hover:text-sigilsoft"
        >
          Ko-fi · KorvuzDev
        </a>

        <nav
          aria-label="Links institucionais"
          className="flex flex-wrap justify-center gap-x-5 gap-y-2 sm:justify-self-end"
        >
          <Link to="/about" className="transition-colors hover:text-sigilsoft">
            Sobre
          </Link>
          <Link to="/artists" className="transition-colors hover:text-sigilsoft">
            Artistas
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


