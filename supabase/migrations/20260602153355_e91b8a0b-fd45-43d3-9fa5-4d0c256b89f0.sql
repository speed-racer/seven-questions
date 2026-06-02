
-- Rooms
CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  phase text NOT NULL DEFAULT 'lobby' CHECK (phase IN ('lobby','answer','reveal','summary')),
  current_question int NOT NULL DEFAULT 0,
  current_mediator_id uuid,
  reveal_player_id uuid,
  reveal_question int NOT NULL DEFAULT 0,
  round_seq int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Players in a room
CREATE TABLE public.room_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  player_number int NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, player_number)
);

CREATE INDEX idx_room_players_room ON public.room_players(room_id);

-- Answers
CREATE TABLE public.answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_seq int NOT NULL,
  question_index int NOT NULL CHECK (question_index BETWEEN 0 AND 6),
  author_id uuid NOT NULL REFERENCES public.room_players(id) ON DELETE CASCADE,
  assigned_to_id uuid REFERENCES public.room_players(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, round_seq, question_index, author_id)
);

CREATE INDEX idx_answers_room_round ON public.answers(room_id, round_seq);

-- Saved rounds
CREATE TABLE public.saved_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_seq int NOT NULL,
  mediator_name text NOT NULL,
  payload jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_rounds_room ON public.saved_rounds(room_id, saved_at DESC);

-- Grants
GRANT SELECT ON public.rooms TO anon, authenticated;
GRANT SELECT ON public.room_players TO anon, authenticated;
GRANT SELECT ON public.answers TO anon, authenticated;
GRANT SELECT ON public.saved_rounds TO anon, authenticated;
GRANT ALL ON public.rooms TO service_role;
GRANT ALL ON public.room_players TO service_role;
GRANT ALL ON public.answers TO service_role;
GRANT ALL ON public.saved_rounds TO service_role;

-- RLS
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rooms_public_read" ON public.rooms FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "players_public_read" ON public.room_players FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "saved_rounds_public_read" ON public.saved_rounds FOR SELECT TO anon, authenticated USING (true);

-- Answers: visible only once the round is in reveal/summary phase
CREATE POLICY "answers_reveal_read" ON public.answers FOR SELECT TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.id = answers.room_id
      AND r.round_seq = answers.round_seq
      AND r.phase IN ('reveal','summary')
  )
);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.answers;
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_players REPLICA IDENTITY FULL;
ALTER TABLE public.answers REPLICA IDENTITY FULL;
