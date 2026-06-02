import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { createRoom, joinRoom } from "@/lib/game.functions";
import { getPlayerId } from "@/lib/player-id";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "7 Questions — A Party Game" },
      {
        name: "description",
        content: "A party storytelling game for 4+ players. Create a room, share the code, and let the questions begin.",
      },
      { property: "og:title", content: "7 Questions — A Party Game" },
      {
        property: "og:description",
        content: "A party storytelling game for 4+ players.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const create = useServerFn(createRoom);
  const join = useServerFn(joinRoom);

  const [mode, setMode] = useState<"home" | "create" | "join">("home");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await create({ data: { playerId: getPlayerId(), displayName: name.trim() } });
      navigate({ to: "/r/$code", params: { code: res.code } });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    setBusy(true);
    try {
      const res = await join({
        data: { playerId: getPlayerId(), displayName: name.trim(), code: code.trim().toUpperCase() },
      });
      navigate({ to: "/r/$code", params: { code: res.code } });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-between px-6 py-10">
      <div className="w-full max-w-md flex-1 flex flex-col items-center justify-center gap-10">
        <header className="text-center">
          <div className="display text-7xl text-primary leading-none">7</div>
          <h1 className="display text-3xl mt-2">Questions</h1>
          <p className="mt-3 text-muted-foreground text-sm">
            A storytelling party game for 4 or more.
          </p>
        </header>

        {mode === "home" && (
          <div className="w-full flex flex-col gap-3">
            <button
              onClick={() => setMode("create")}
              className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-lg font-semibold shadow-lg active:scale-[0.98] transition"
            >
              Create a room
            </button>
            <button
              onClick={() => setMode("join")}
              className="w-full rounded-xl bg-card border border-border text-foreground py-4 text-lg font-semibold active:scale-[0.98] transition"
            >
              Join a room
            </button>
          </div>
        )}

        {mode === "create" && (
          <form onSubmit={handleCreate} className="w-full flex flex-col gap-3">
            <label className="text-sm text-muted-foreground">Your name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="e.g. Alex"
              className="w-full rounded-xl bg-input border border-border px-4 py-4 text-lg outline-none focus:border-primary"
            />
            <button
              disabled={busy || !name.trim()}
              className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-lg font-semibold disabled:opacity-50 active:scale-[0.98] transition"
            >
              {busy ? "Creating…" : "Create room"}
            </button>
            <button type="button" onClick={() => setMode("home")} className="text-sm text-muted-foreground py-2">
              ← Back
            </button>
          </form>
        )}

        {mode === "join" && (
          <form onSubmit={handleJoin} className="w-full flex flex-col gap-3">
            <label className="text-sm text-muted-foreground">Room code</label>
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={10}
              placeholder="ABC123"
              className="w-full rounded-xl bg-input border border-border px-4 py-4 text-2xl font-mono tracking-[0.3em] text-center outline-none focus:border-primary uppercase"
            />
            <label className="text-sm text-muted-foreground mt-2">Your name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="e.g. Sam"
              className="w-full rounded-xl bg-input border border-border px-4 py-4 text-lg outline-none focus:border-primary"
            />
            <button
              disabled={busy || !name.trim() || !code.trim()}
              className="w-full rounded-xl bg-primary text-primary-foreground py-4 text-lg font-semibold disabled:opacity-50 active:scale-[0.98] transition"
            >
              {busy ? "Joining…" : "Join room"}
            </button>
            <button type="button" onClick={() => setMode("home")} className="text-sm text-muted-foreground py-2">
              ← Back
            </button>
          </form>
        )}
      </div>

      <footer className="text-xs text-muted-foreground/70 mt-6">Best played in the same room.</footer>
    </main>
  );
}
