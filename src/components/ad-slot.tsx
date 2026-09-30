export function AdSlot() {
  return (
    <div
      className="flex min-h-[600px] w-full items-center justify-center border border-dashed border-hexline/40 bg-abyss/20 px-3 text-center"
      data-ad-slot="reserved"
    >
      {/* Google AdSense unit will be mounted here after the site is approved. */}
      <span className="text-[10px] uppercase tracking-[0.28em] text-mist/35">
        Publicidade
      </span>
    </div>
  );
}
