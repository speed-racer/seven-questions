import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { QUESTIONS, TOTAL_QUESTIONS } from "@/lib/questions";
import { getPlayerId } from "@/lib/player-id";
import {
  startRound,
  submitAnswer,
  advanceQuestion,
  setRevealPlayer,
  endRound,
  saveRound,
  setTimerEnabled,
  TIMER_DURATION_SECONDS,
  addGhostPlayer,
  ghostAnswerCurrent,
} from "@/lib/game.functions";

export const Route = createFileRoute("/r/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "7 Questions — Room" },
      { name: "description", content: "Play 7 Questions with friends." },
    ],
  }),
  component: RoomPage,
});

type Room = {
  id: string;
  code: string;
  phase: "lobby" | "answer" | "reveal" | "summary";
  current_question: number;
  current_mediator_id: string | null;
  reveal_player_id: string | null;
  reveal_question: number;
  round_seq: number;
  timer_enabled: boolean;
  question_started_at: string | null;
};

type Player = {
  id: string;
  display_name: string;
  player_number: number;
};

type Answer = {
  id: string;
  question_index: number;
  author_id: string;
  assigned_to_id: string | null;
  text: string;
};

function RoomPage() {
  const { code } = Route.useParams();
  const playerId = typeof window !== "undefined" ? getPlayerId() : "";

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // initial load + realtime
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function load() {
      const { data: r } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", code.toUpperCase())
        .maybeSingle();
      if (cancelled) return;
      if (!r) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setRoom(r as Room);

      const refresh = async (roomId: string) => {
        const [{ data: ps }, { data: as }, { data: rr }] = await Promise.all([
          supabase.from("room_players").select("*").eq("room_id", roomId).order("player_number"),
          supabase.from("answers").select("*").eq("room_id", roomId).eq("round_seq", (r as Room).round_seq),
          supabase.from("rooms").select("*").eq("id", roomId).single(),
        ]);
        if (cancelled) return;
        setPlayers((ps as Player[]) ?? []);
        setAnswers((as as Answer[]) ?? []);
        if (rr) setRoom(rr as Room);
      };

      await refresh(r.id);
      setLoading(false);

      channel = supabase
        .channel(`room:${r.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${r.id}` }, () => refresh(r.id))
        .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${r.id}` }, () => refresh(r.id))
        .on("postgres_changes", { event: "*", schema: "public", table: "answers", filter: `room_id=eq.${r.id}` }, () => refresh(r.id))
        .subscribe();
    }
    load();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [code]);

  if (loading) {
    return <CenterScreen>Loading room…</CenterScreen>;
  }
  if (notFound || !room) {
    return (
      <CenterScreen>
        <div className="text-center">
          <p className="text-lg">Room not found.</p>
          <Link to="/" className="mt-4 inline-block text-primary underline">Go home</Link>
        </div>
      </CenterScreen>
    );
  }

  const me = players.find((p) => p.id === playerId);
  const isMediator = room.current_mediator_id === playerId;

  // If not in room and lobby, ask them to join via home
  if (!me) {
    return (
      <CenterScreen>
        <div className="text-center max-w-sm">
          <p className="text-lg">You're not in this room yet.</p>
          <p className="text-sm text-muted-foreground mt-2">Go back and join with code <span className="font-mono">{room.code}</span>.</p>
          <Link to="/" className="mt-6 inline-block rounded-xl bg-primary text-primary-foreground px-6 py-3 font-semibold">
            Go home
          </Link>
        </div>
      </CenterScreen>
    );
  }

  return (
    <main className="min-h-screen px-5 py-6 max-w-md mx-auto flex flex-col">
      <TopBar room={room} />
      {room.phase === "lobby" && (
        <Lobby room={room} players={players} isMediator={isMediator} />
      )}
      {room.phase === "answer" && (
        <AnswerPhase room={room} players={players} answers={answers} me={me} isMediator={isMediator} />
      )}
      {(room.phase === "reveal" || room.phase === "summary") && (
        <RevealPhase room={room} players={players} answers={answers} me={me} isMediator={isMediator} />
      )}
    </main>
  );
}

function CenterScreen({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen flex items-center justify-center px-6">{children}</main>;
}

function TopBar({ room }: { room: Room }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <Link to="/" className="text-muted-foreground text-sm">← Home</Link>
      <div className="text-xs text-muted-foreground">
        Room <span className="font-mono text-foreground">{room.code}</span>
      </div>
      <Link to="/r/$code/history" params={{ code: room.code }} className="text-muted-foreground text-sm">
        History
      </Link>
    </div>
  );
}

// -------------------- LOBBY --------------------
function Lobby({ room, players, isMediator }: { room: Room; players: Player[]; isMediator: boolean }) {
  const start = useServerFn(startRound);
  const toggleTimer = useServerFn(setTimerEnabled);
  const [busy, setBusy] = useState(false);
  const canStart = players.length >= 4;

  async function handleStart() {
    setBusy(true);
    try {
      await start({ data: { playerId: getPlayerId(), roomId: room.id } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleTimer() {
    try {
      await toggleTimer({
        data: { playerId: getPlayerId(), roomId: room.id, enabled: !room.timer_enabled },
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6 flex-1">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">Share the room code</p>
        <div className="display text-6xl text-primary tracking-[0.2em] mt-2">{room.code}</div>
      </div>

      <div>
        <div className="text-sm text-muted-foreground mb-2">
          Players ({players.length}){players.length < 4 && " — need at least 4"}
        </div>
        <ul className="flex flex-col gap-2">
          {players.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3"
            >
              <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                {p.player_number}
              </span>
              <span className="flex-1">{p.display_name}</span>
              {p.id === room.current_mediator_id && (
                <span className="text-xs text-accent uppercase tracking-wider">Mediator</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto pt-4">
        <div className="mb-3 flex items-center justify-between bg-card border border-border rounded-xl px-4 py-3">
          <div>
            <div className="text-sm font-medium">Per-question timer</div>
            <div className="text-xs text-muted-foreground">
              {room.timer_enabled ? "2:00 per question, auto-submits" : "Off"}
            </div>
          </div>
          {isMediator ? (
            <button
              onClick={handleToggleTimer}
              className={`relative h-7 w-12 rounded-full transition ${
                room.timer_enabled ? "bg-primary" : "bg-secondary"
              }`}
              aria-pressed={room.timer_enabled}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-background transition-all ${
                  room.timer_enabled ? "left-6" : "left-1"
                }`}
              />
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {room.timer_enabled ? "On" : "Off"}
            </span>
          )}
        </div>
        {isMediator ? (
          <button
            onClick={handleStart}
            disabled={!canStart || busy}
            className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-lg font-semibold disabled:opacity-50 active:scale-[0.98] transition"
          >
            {busy ? "Starting…" : canStart ? "Start round" : `Waiting for ${4 - players.length} more`}
          </button>
        ) : (
          <div className="text-center text-sm text-muted-foreground py-4">
            Waiting for the mediator to start the round…
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------- ANSWER PHASE --------------------
function AnswerPhase({
  room,
  players,
  answers,
  me,
  isMediator,
}: {
  room: Room;
  players: Player[];
  answers: Answer[];
  me: Player;
  isMediator: boolean;
}) {
  const submit = useServerFn(submitAnswer);
  const advance = useServerFn(advanceQuestion);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // reset input when question changes
  useEffect(() => {
    setText("");
  }, [room.current_question]);

  const qIdx = room.current_question;
  const nonMediators = players.filter((p) => p.id !== room.current_mediator_id);
  const submittedAuthorIds = new Set(answers.filter((a) => a.question_index === qIdx).map((a) => a.author_id));
  const mySubmitted = submittedAuthorIds.has(me.id);
  const allSubmitted = nonMediators.every((p) => submittedAuthorIds.has(p.id));

  // ---- Timer ----
  const timerActive = room.timer_enabled && !!room.question_started_at;
  const startedAtMs = room.question_started_at ? new Date(room.question_started_at).getTime() : 0;
  const deadlineMs = startedAtMs + TIMER_DURATION_SECONDS * 1000;
  const remainingMs = Math.max(0, deadlineMs - now);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const expired = timerActive && remainingMs <= 0;

  useEffect(() => {
    if (!timerActive) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [timerActive]);

  // Auto-submit my answer if I'm a non-mediator who hasn't submitted when timer expires.
  useEffect(() => {
    if (!expired || isMediator || mySubmitted || busy) return;
    const payload = text.trim() || "(no answer)";
    setBusy(true);
    submit({
      data: { playerId: getPlayerId(), roomId: room.id, questionIndex: qIdx, text: payload.slice(0, 500) },
    })
      .catch((e) => {
        // Swallow "wrong question" races silently — the round already advanced.
        const msg = (e as Error).message ?? "";
        if (!/wrong question|not accepting/i.test(msg)) toast.error(msg);
      })
      .finally(() => setBusy(false));
  }, [expired, isMediator, mySubmitted, busy, text, submit, room.id, qIdx]);

  // Mediator auto-advances shortly after timer expires once everyone has submitted.
  useEffect(() => {
    if (!expired || !isMediator || !allSubmitted || busy) return;
    const t = setTimeout(() => {
      setBusy(true);
      advance({ data: { playerId: getPlayerId(), roomId: room.id } })
        .catch(() => {})
        .finally(() => setBusy(false));
    }, 1500);
    return () => clearTimeout(t);
  }, [expired, isMediator, allSubmitted, busy, advance, room.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await submit({
        data: { playerId: getPlayerId(), roomId: room.id, questionIndex: qIdx, text: text.trim() },
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdvance() {
    setBusy(true);
    try {
      await advance({ data: { playerId: getPlayerId(), roomId: room.id } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 flex-1">
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Question {qIdx + 1} of {TOTAL_QUESTIONS}
        </div>
        <h2 className="display text-3xl mt-2 leading-tight">{QUESTIONS[qIdx]}</h2>
        {timerActive && (
          <div className="mt-3 flex items-center gap-2">
            <div
              className={`font-mono text-sm tabular-nums ${
                remainingSec <= 10 ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {Math.floor(remainingSec / 60)}:{String(remainingSec % 60).padStart(2, "0")}
            </div>
            <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full transition-all ${
                  remainingSec <= 10 ? "bg-destructive" : "bg-primary"
                }`}
                style={{
                  width: `${Math.max(0, Math.min(100, (remainingMs / (TIMER_DURATION_SECONDS * 1000)) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {isMediator ? (
        <div className="flex flex-col gap-4 flex-1">
          <p className="text-sm text-muted-foreground">
            You're the mediator. Read the question aloud. Players answer on their devices.
          </p>
          <ul className="flex flex-col gap-2">
            {nonMediators.map((p) => {
              const done = submittedAuthorIds.has(p.id);
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3"
                >
                  <span className="w-7 h-7 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-sm font-bold">
                    {p.player_number}
                  </span>
                  <span className="flex-1">{p.display_name}</span>
                  <span className={`text-xs ${done ? "text-accent" : "text-muted-foreground"}`}>
                    {done ? "✓ Answered" : "Waiting…"}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-auto pt-4">
            <button
              onClick={handleAdvance}
              disabled={!allSubmitted || busy}
              className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-lg font-semibold disabled:opacity-50 active:scale-[0.98] transition"
            >
              {qIdx === TOTAL_QUESTIONS - 1
                ? allSubmitted
                  ? "Finish & shuffle answers"
                  : "Waiting for answers…"
                : allSubmitted
                  ? "Next question →"
                  : `Waiting (${submittedAuthorIds.size}/${nonMediators.length})`}
            </button>
          </div>
        </div>
      ) : mySubmitted ? (
        <div className="flex flex-col items-center justify-center gap-4 flex-1 text-center">
          <div className="display text-4xl text-accent">✓</div>
          <p className="text-lg">Answer submitted!</p>
          <p className="text-sm text-muted-foreground">
            Waiting for the mediator… ({submittedAuthorIds.size}/{nonMediators.length} answered)
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-1">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder="Type your answer…"
            rows={5}
            className="w-full rounded-xl bg-input border border-border px-4 py-3 text-lg outline-none focus:border-primary resize-none"
          />
          <button
            disabled={!text.trim() || busy}
            className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-lg font-semibold disabled:opacity-50 active:scale-[0.98] transition mt-auto"
          >
            {busy ? "Submitting…" : "Submit answer"}
          </button>
        </form>
      )}
    </div>
  );
}

// -------------------- REVEAL PHASE --------------------
function RevealPhase({
  room,
  players,
  answers,
  me,
  isMediator,
}: {
  room: Room;
  players: Player[];
  answers: Answer[];
  me: Player;
  isMediator: boolean;
}) {
  const setReveal = useServerFn(setRevealPlayer);
  const end = useServerFn(endRound);
  const save = useServerFn(saveRound);
  const [busy, setBusy] = useState(false);

  // local reveal state (which cards has the current player tapped)
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  useEffect(() => {
    setRevealed(new Set());
  }, [room.reveal_player_id]);

  const revealPlayer = useMemo(
    () => players.find((p) => p.id === room.reveal_player_id) ?? null,
    [players, room.reveal_player_id],
  );

  const myCards = useMemo(() => {
    // 7 answers assigned to revealPlayer, indexed by question
    const byQ = new Map<number, Answer>();
    for (const a of answers) {
      if (a.assigned_to_id === room.reveal_player_id) byQ.set(a.question_index, a);
    }
    return Array.from({ length: TOTAL_QUESTIONS }, (_, i) => byQ.get(i) ?? null);
  }, [answers, room.reveal_player_id]);

  const isRevealPlayer = revealPlayer?.id === me.id;
  const nonMediators = players.filter((p) => p.id !== room.current_mediator_id);

  async function pickPlayer(targetId: string) {
    setBusy(true);
    try {
      await setReveal({ data: { playerId: getPlayerId(), roomId: room.id, targetPlayerId: targetId } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    setBusy(true);
    try {
      await end({ data: { playerId: getPlayerId(), roomId: room.id } });
      toast.success("Round ended. New mediator selected.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    try {
      await save({ data: { playerId: getPlayerId(), roomId: room.id } });
      toast.success("Round saved to history.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 flex-1">
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Reveal time</div>
        {revealPlayer ? (
          <h2 className="display text-3xl mt-2">
            {isRevealPlayer ? "It's your turn!" : `${revealPlayer.display_name} is up`}
          </h2>
        ) : (
          <h2 className="display text-3xl mt-2">Pick a player</h2>
        )}
      </div>

      {isMediator && (
        <div className="bg-card border border-border rounded-xl p-3">
          <div className="text-xs text-muted-foreground mb-2">Choose who reveals next</div>
          <div className="grid grid-cols-2 gap-2">
            {nonMediators.map((p) => (
              <button
                key={p.id}
                onClick={() => pickPlayer(p.id)}
                disabled={busy}
                className={`rounded-lg px-3 py-2 text-sm font-medium border transition ${
                  p.id === room.reveal_player_id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary text-secondary-foreground border-border"
                }`}
              >
                {p.player_number}. {p.display_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {revealPlayer && (
        <div className="flex flex-col gap-3">
          {QUESTIONS.map((q, i) => {
            const card = myCards[i];
            const isOpen = revealed.has(i);
            const canTap = isRevealPlayer;
            return (
              <div key={i} className="bg-card border border-border rounded-xl p-4">
                <div className="text-xs text-muted-foreground mb-1">Question {i + 1}</div>
                <div className="font-medium">{q}</div>
                <button
                  type="button"
                  disabled={!canTap || isOpen || !card}
                  onClick={() =>
                    setRevealed((prev) => {
                      const next = new Set(prev);
                      next.add(i);
                      return next;
                    })
                  }
                  className={`mt-3 w-full rounded-lg py-3 text-left px-3 transition ${
                    isOpen
                      ? "bg-accent/20 text-foreground border border-accent"
                      : canTap
                        ? "bg-primary text-primary-foreground font-semibold active:scale-[0.98]"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {!card
                    ? "— no answer —"
                    : isOpen
                      ? card.text
                      : canTap
                        ? "Tap to reveal"
                        : "Hidden"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {isMediator && (
        <div className="flex flex-col gap-2 mt-4 sticky bottom-4">
          <button
            onClick={handleSave}
            disabled={busy}
            className="w-full rounded-xl bg-secondary text-secondary-foreground py-3 font-semibold disabled:opacity-50"
          >
            Save round to history
          </button>
          <button
            onClick={handleEnd}
            disabled={busy}
            className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-lg font-semibold disabled:opacity-50 active:scale-[0.98] transition"
          >
            End round & rotate mediator
          </button>
        </div>
      )}
    </div>
  );
}