import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { QUESTIONS } from "@/lib/questions";

export const Route = createFileRoute("/r/$code/history")({
  ssr: false,
  head: () => ({ meta: [{ title: "7 Questions — History" }] }),
  component: HistoryPage,
});

type SavedRound = {
  id: string;
  round_seq: number;
  mediator_name: string;
  saved_at: string;
  payload: {
    players: { id: string; display_name: string; player_number: number }[];
    answers: { question_index: number; author_id: string; assigned_to_id: string | null; text: string }[];
  };
};

function HistoryPage() {
  const { code } = Route.useParams();
  const [rounds, setRounds] = useState<SavedRound[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: room } = await supabase.from("rooms").select("id").eq("code", code.toUpperCase()).maybeSingle();
      if (!room) return;
      const { data } = await supabase
        .from("saved_rounds")
        .select("*")
        .eq("room_id", room.id)
        .order("saved_at", { ascending: false });
      setRounds((data as SavedRound[]) ?? []);
    })();
  }, [code]);

  return (
    <main className="min-h-screen px-5 py-6 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Link to="/r/$code" params={{ code }} className="text-muted-foreground text-sm">← Back to room</Link>
        <div className="text-xs text-muted-foreground">History</div>
      </div>
      <h1 className="display text-3xl mb-4">Saved rounds</h1>
      {rounds.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rounds saved yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rounds.map((r) => {
            const open = openId === r.id;
            return (
              <li key={r.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenId(open ? null : r.id)}
                  className="w-full text-left px-4 py-3 flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold">Round #{r.round_seq}</div>
                    <div className="text-xs text-muted-foreground">
                      Mediator: {r.mediator_name} · {new Date(r.saved_at).toLocaleString()}
                    </div>
                  </div>
                  <span className="text-muted-foreground">{open ? "−" : "+"}</span>
                </button>
                {open && <RoundDetail round={r} />}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function RoundDetail({ round }: { round: SavedRound }) {
  const playerById = new Map(round.payload.players.map((p) => [p.id, p]));
  const byPlayer = new Map<string, typeof round.payload.answers>();
  for (const a of round.payload.answers) {
    if (!a.assigned_to_id) continue;
    const arr = byPlayer.get(a.assigned_to_id) ?? [];
    arr.push(a);
    byPlayer.set(a.assigned_to_id, arr);
  }
  return (
    <div className="px-4 pb-4 border-t border-border flex flex-col gap-4 pt-3">
      {Array.from(byPlayer.entries()).map(([pid, ans]) => {
        const p = playerById.get(pid);
        const sorted = [...ans].sort((a, b) => a.question_index - b.question_index);
        return (
          <div key={pid}>
            <div className="text-sm font-semibold text-accent mb-2">{p?.display_name ?? "Player"}</div>
            <ol className="flex flex-col gap-2">
              {sorted.map((a) => (
                <li key={a.question_index} className="text-sm">
                  <div className="text-muted-foreground">Q{a.question_index + 1}. {QUESTIONS[a.question_index]}</div>
                  <div>{a.text}</div>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}