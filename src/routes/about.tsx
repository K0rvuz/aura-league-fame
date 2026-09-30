import { createFileRoute } from "@tanstack/react-router";
import { ContentPage, PolicySection } from "@/components/content-page";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "Sobre — Aura Farming" },
      {
        name: "description",
        content: "Entenda como funciona o Aura Farming, um ranking comunitário de aura para jogadores de League of Legends.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <ContentPage
      eyebrow="Sobre o projeto"
      title="Aura é subjetiva. O ranking também."
      intro="Aura Farming é um projeto de fã feito para transformar aquela discussão impossível de medir — quem tem mais aura? — em um ranking público, simples e ao vivo."
    >
      <PolicySection title="Como funciona">
        <p>
          Jogadores podem ser adicionados ao board por Riot ID. A comunidade distribui aura usando
          os valores disponíveis na interface, e o ranking é atualizado conforme os votos chegam.
        </p>
        <p>
          O site também pode exibir citações, memes e referências associadas aos jogadores. Essas
          frases são curadas manualmente pelo responsável pelo projeto e não podem ser enviadas
          diretamente pelo público.
        </p>
      </PolicySection>

      <PolicySection title="O que este site não é">
        <p>
          Aura Farming não é um ranking oficial, não mede habilidade competitiva e não deve ser
          interpretado como avaliação profissional de qualquer jogador. A pontuação representa apenas
          a brincadeira e a participação da comunidade.
        </p>
      </PolicySection>

      <PolicySection title="Projeto de fã">
        <p>
          Este é um projeto independente e não oficial. Não há afiliação, patrocínio ou endosso da
          Riot Games ou das organizações e jogadores exibidos no site.
        </p>
      </PolicySection>
    </ContentPage>
  );
}
