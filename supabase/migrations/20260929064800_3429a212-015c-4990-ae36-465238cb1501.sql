DELETE FROM public.aura_votes WHERE id IS NOT NULL;
UPDATE public.players SET aura = 0 WHERE id IS NOT NULL;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS puuid text UNIQUE;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS region text;
GRANT ALL ON public.players TO service_role;