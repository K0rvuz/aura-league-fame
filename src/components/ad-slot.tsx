import { useEffect, useRef } from "react";

const ADSENSE_CLIENT = "ca-pub-5530796104075696";

type AdSlotProps = {
  slot: string;
};

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>>;
  }
}

export function AdSlot({ slot }: AdSlotProps) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch (error) {
      console.error("Falha ao inicializar bloco do AdSense:", error);
    }
  }, []);

  return (
    <div className="min-h-[600px] w-full">
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
