CREATE TABLE public.players (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rank_label TEXT NOT NULL DEFAULT 'Challenger',
  icon TEXT NOT NULL DEFAULT 'faker',
  aura BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.players TO anon;
GRANT SELECT ON public.players TO authenticated;
GRANT ALL ON public.players TO service_role;

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view players" ON public.players FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.players (name, rank_label, icon, aura) VALUES
  ('Faker', 'Challenger', 'faker', 84210),
  ('Caps', 'Grandmaster', 'caps', 71905),
  ('Chovy', 'Grandmaster', 'chovy', 66440),
  ('Knight', 'Master', 'knight', 58120),
  ('Gumayusi', 'Master', 'gumayusi', 49870),
  ('Doublelift', 'Diamond', 'doublelift', 44310);

CREATE TABLE public.aura_votes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  delta INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, session_id)
);

GRANT ALL ON public.aura_votes TO service_role;

ALTER TABLE public.aura_votes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.vote_aura(p_player_id UUID, p_session_id TEXT, p_delta INT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_aura BIGINT;
BEGIN
  IF p_delta NOT IN (-5000, -1000, 1000, 5000) THEN
    RAISE EXCEPTION 'invalid delta';
  END IF;
  IF p_session_id IS NULL OR length(p_session_id) < 8 OR length(p_session_id) > 128 THEN
    RAISE EXCEPTION 'invalid session';
  END IF;

  INSERT INTO public.aura_votes (player_id, session_id, delta)
  VALUES (p_player_id, p_session_id, p_delta);

  UPDATE public.players
  SET aura = aura + p_delta
  WHERE id = p_player_id
  RETURNING aura INTO v_aura;

  RETURN v_aura;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already_voted';
END;
$$;

GRANT EXECUTE ON FUNCTION public.vote_aura(UUID, TEXT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.vote_aura(UUID, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vote_aura(UUID, TEXT, INT) TO service_role;