import { createFileRoute } from "@tanstack/react-router";
import { ContentPage, PolicySection } from "@/components/content-page";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Aura Farming" },
      {
        name: "description",
        content: "Política de Privacidade do Aura Farming.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <ContentPage
      eyebrow="Privacidade"
      title="Política de Privacidade"
      intro="Esta página explica quais dados técnicos podem ser processados pelo Aura Farming e por serviços externos usados para manter o site funcionando."
    >
      <PolicySection title="Dados armazenados no navegador">
        <p>
          O site pode usar armazenamento local do navegador, como localStorage, para manter
          identificadores técnicos e estados relacionados à experiência de votação. Esses dados ficam
          no dispositivo do visitante até serem removidos pelo próprio navegador ou pelo usuário.
        </p>
      </PolicySection>

      <PolicySection title="Dados do ranking">
        <p>
          O banco do Aura Farming armazena informações públicas necessárias ao funcionamento do
          ranking, como Riot ID, identificadores técnicos do jogador, ícone, pontuação de aura e
          registros de votação.
        </p>
      </PolicySection>

      <PolicySection title="Serviços de terceiros">
        <p>
          O site pode acessar serviços e conteúdos de terceiros para consultar ou exibir informações
          de League of Legends, incluindo serviços relacionados à Riot Games. Ao carregar recursos de
          terceiros, informações técnicas como endereço IP e dados básicos da requisição podem ser
          processadas pelos respectivos provedores.
        </p>
      </PolicySection>

      <PolicySection title="Publicidade e Google AdSense">
        <p>
          O Aura Farming poderá utilizar o Google AdSense para exibir anúncios. Quando esse serviço
          estiver ativo, Google e seus parceiros poderão usar cookies, identificadores e outras
          tecnologias para veicular, medir e personalizar anúncios conforme as configurações,
          consentimentos e regras aplicáveis.
        </p>
        <p>
          As preferências de anúncios e controles disponibilizados pelo Google são gerenciados pelos
          próprios serviços do Google. Esta política poderá ser atualizada quando a integração de
          publicidade for ativada ou alterada.
        </p>
      </PolicySection>

      <PolicySection title="Alterações desta política">
        <p>
          Esta política pode ser atualizada para refletir mudanças técnicas, novos serviços ou novas
          exigências de privacidade. A versão publicada nesta página é a versão vigente.
        </p>
      </PolicySection>

      <p className="text-xs uppercase tracking-widest text-mist/60">
        Última atualização: 30 de setembro de 2026.
      </p>
    </ContentPage>
  );
}
