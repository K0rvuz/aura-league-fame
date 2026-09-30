import { createFileRoute } from "@tanstack/react-router";
import { ContentPage, PolicySection } from "@/components/content-page";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — Aura Farming" },
      {
        name: "description",
        content: "Termos de Uso do Aura Farming.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <ContentPage
      eyebrow="Termos"
      title="Termos de Uso"
      intro="Ao usar o Aura Farming, você concorda em utilizar o site como uma experiência comunitária e recreativa, respeitando as regras exibidas na interface."
    >
      <PolicySection title="Natureza do ranking">
        <p>
          A pontuação de aura é uma métrica fictícia criada para entretenimento. Ela não representa
          habilidade, desempenho profissional, reputação real ou qualquer avaliação oficial dos
          jogadores exibidos.
        </p>
      </PolicySection>

      <PolicySection title="Uso aceitável">
        <p>
          Não é permitido tentar prejudicar a disponibilidade do serviço, manipular o banco de dados,
          automatizar abuso do sistema de votação, explorar falhas para alterar resultados ou usar o
          site de forma que prejudique outros visitantes.
        </p>
      </PolicySection>

      <PolicySection title="Jogadores, citações e conteúdo">
        <p>
          Jogadores podem aparecer no ranking a partir de identificadores públicos relacionados ao jogo.
          Citações, memes e referências exibidos nos cards são selecionados manualmente pelo
          responsável pelo projeto e podem ser alterados ou removidos a qualquer momento.
        </p>
      </PolicySection>

      <PolicySection title="Disponibilidade">
        <p>
          O serviço é fornecido como está e pode sofrer alterações, interrupções, manutenção ou
          mudanças de regras. Não há garantia de disponibilidade contínua ou preservação permanente de
          pontuações.
        </p>
      </PolicySection>

      <PolicySection title="Projeto não oficial">
        <p>
          Aura Farming é um projeto independente de fã. Não é afiliado, patrocinado ou endossado pela
          Riot Games, organizações profissionais ou jogadores exibidos.
        </p>
      </PolicySection>

      <p className="text-xs uppercase tracking-widest text-mist/60">
        Última atualização: 30 de setembro de 2026.
      </p>
    </ContentPage>
  );
}

