import { createFileRoute } from "@tanstack/react-router";
import { ContentPage, PolicySection } from "@/components/content-page";

export const Route = createFileRoute("/artists")({
  head: () => ({
    meta: [
      { title: "Artistas — Aura Farming" },
      {
        name: "description",
        content: "Créditos dos artistas que contribuíram com a identidade visual do Aura Farming.",
      },
    ],
  }),
  component: ArtistsPage,
});

const links = [
  { label: "Linktree", href: "https://linktr.ee/Kanu_M" },
  { label: "ArtStation", href: "https://www.artstation.com/k4nu" },
  { label: "Instagram", href: "https://www.instagram.com/miau_c00kies/" },
  { label: "TikTok", href: "https://www.tiktok.com/@miau_c00kies" },
  { label: "X", href: "https://x.com/Miau_c00kies" },
];

function ArtistsPage() {
  return (
    <ContentPage
      eyebrow="Créditos"
      title="Artistas"
      intro="Esta página reúne os créditos de quem contribuiu com a identidade visual do Aura Farming."
    >
      <PolicySection title="Kanu / Miau_c00kies">
        <p>
          Responsável pelo ícone do Aura Farming.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-hexline/70 bg-steel/40 px-4 py-2 text-sm text-ink transition-colors hover:border-sigil/70 hover:text-sigilsoft"
            >
              {link.label}
            </a>
          ))}
        </div>
      </PolicySection>

      <PolicySection title="Créditos futuros">
        <p>
          Novos artistas e colaboradores visuais poderão ser adicionados aqui conforme o projeto evoluir.
        </p>
      </PolicySection>
    </ContentPage>
  );
}
