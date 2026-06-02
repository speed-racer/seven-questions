ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS timer_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS question_started_at timestamptz;