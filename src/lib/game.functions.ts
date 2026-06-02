import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TOTAL_QUESTIONS = 7;

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no confusing chars
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ---------------- Create room ----------------
export const createRoom = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        playerId: z.string().uuid(),
        displayName: z.string().min(1).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // try a few codes in case of collision
    let code = "";
    let roomId = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      code = generateRoomCode();
      const { data: room, error } = await supabaseAdmin
        .from("rooms")
        .insert({ code })
        .select("id, code")
        .single();
      if (!error && room) {
        roomId = room.id;
        break;
      }
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    }
    if (!roomId) throw new Error("Could not allocate room code");

    // insert creator as player 1
    const { error: pErr } = await supabaseAdmin.from("room_players").insert({
      id: data.playerId,
      room_id: roomId,
      display_name: data.displayName.trim(),
      player_number: 1,
    });
    if (pErr) throw new Error(pErr.message);

    // creator is initial mediator
    await supabaseAdmin
      .from("rooms")
      .update({ current_mediator_id: data.playerId })
      .eq("id", roomId);

    return { roomId, code };
  });

// ---------------- Join room ----------------
export const joinRoom = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        playerId: z.string().uuid(),
        displayName: z.string().min(1).max(40),
        code: z.string().min(4).max(10),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code.trim().toUpperCase();

    const { data: room, error: rErr } = await supabaseAdmin
      .from("rooms")
      .select("id, code, phase")
      .eq("code", code)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!room) throw new Error("Room not found");

    // already in room?
    const { data: existing } = await supabaseAdmin
      .from("room_players")
      .select("id")
      .eq("id", data.playerId)
      .eq("room_id", room.id)
      .maybeSingle();
    if (existing) return { roomId: room.id, code: room.code };

    if (room.phase !== "lobby") throw new Error("Round in progress — wait for the next round");

    // assign next player number
    const { data: maxRow } = await supabaseAdmin
      .from("room_players")
      .select("player_number")
      .eq("room_id", room.id)
      .order("player_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextNumber = (maxRow?.player_number ?? 0) + 1;

    const { error: pErr } = await supabaseAdmin.from("room_players").insert({
      id: data.playerId,
      room_id: room.id,
      display_name: data.displayName.trim(),
      player_number: nextNumber,
    });
    if (pErr) throw new Error(pErr.message);

    return { roomId: room.id, code: room.code };
  });

// ---------------- Start round ----------------
export const startRound = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ playerId: z.string().uuid(), roomId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("id, phase, current_mediator_id")
      .eq("id", data.roomId)
      .single();
    if (!room) throw new Error("Room not found");
    if (room.current_mediator_id !== data.playerId) throw new Error("Only the mediator can start");
    if (room.phase !== "lobby") throw new Error("Round already in progress");

    const { count } = await supabaseAdmin
      .from("room_players")
      .select("id", { count: "exact", head: true })
      .eq("room_id", data.roomId);
    if ((count ?? 0) < 4) throw new Error("Need at least 4 players");

    await supabaseAdmin
      .from("rooms")
      .update({ phase: "answer", current_question: 0, updated_at: new Date().toISOString() })
      .eq("id", data.roomId);

    return { ok: true };
  });

// ---------------- Submit answer ----------------
export const submitAnswer = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        playerId: z.string().uuid(),
        roomId: z.string().uuid(),
        questionIndex: z.number().int().min(0).max(TOTAL_QUESTIONS - 1),
        text: z.string().min(1).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("id, phase, current_question, current_mediator_id, round_seq")
      .eq("id", data.roomId)
      .single();
    if (!room) throw new Error("Room not found");
    if (room.phase !== "answer") throw new Error("Not accepting answers right now");
    if (room.current_question !== data.questionIndex)
      throw new Error("Wrong question — refresh");
    if (room.current_mediator_id === data.playerId)
      throw new Error("Mediator does not answer");

    const { error } = await supabaseAdmin.from("answers").upsert(
      {
        room_id: data.roomId,
        round_seq: room.round_seq,
        question_index: data.questionIndex,
        author_id: data.playerId,
        text: data.text.trim(),
      },
      { onConflict: "room_id,round_seq,question_index,author_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Advance question / finalize answer phase ----------------
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Derangement-ish: try to avoid assigning a player their own answer.
function assignWithoutSelf<T extends { author_id: string }>(items: T[]): T[] {
  const authors = items.map((i) => i.author_id);
  for (let tries = 0; tries < 30; tries++) {
    const shuffled = shuffleInPlace([...items]);
    const ok = shuffled.every((item, idx) => item.author_id !== authors[idx]);
    if (ok) return shuffled;
  }
  // fallback: best-effort swap
  const shuffled = shuffleInPlace([...items]);
  for (let i = 0; i < shuffled.length; i++) {
    if (shuffled[i].author_id === authors[i]) {
      const j = (i + 1) % shuffled.length;
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }
  return shuffled;
}

export const advanceQuestion = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ playerId: z.string().uuid(), roomId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("id, phase, current_question, current_mediator_id, round_seq")
      .eq("id", data.roomId)
      .single();
    if (!room) throw new Error("Room not found");
    if (room.current_mediator_id !== data.playerId) throw new Error("Only the mediator");
    if (room.phase !== "answer") throw new Error("Not in answer phase");

    // verify all non-mediator players have answered the current question
    const { data: players } = await supabaseAdmin
      .from("room_players")
      .select("id")
      .eq("room_id", data.roomId);
    const nonMediators = (players ?? []).filter((p) => p.id !== room.current_mediator_id);

    const { data: ans } = await supabaseAdmin
      .from("answers")
      .select("author_id")
      .eq("room_id", data.roomId)
      .eq("round_seq", room.round_seq)
      .eq("question_index", room.current_question);
    const answered = new Set((ans ?? []).map((a) => a.author_id));
    const allAnswered = nonMediators.every((p) => answered.has(p.id));
    if (!allAnswered) throw new Error("Waiting on players");

    if (room.current_question < TOTAL_QUESTIONS - 1) {
      await supabaseAdmin
        .from("rooms")
        .update({
          current_question: room.current_question + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.roomId);
      return { ok: true, phase: "answer" as const };
    }

    // Finalize: shuffle assignments for each question
    const { data: allAns } = await supabaseAdmin
      .from("answers")
      .select("id, question_index, author_id")
      .eq("room_id", data.roomId)
      .eq("round_seq", room.round_seq);

    const byQuestion = new Map<number, { id: string; author_id: string }[]>();
    for (const a of allAns ?? []) {
      const arr = byQuestion.get(a.question_index) ?? [];
      arr.push({ id: a.id, author_id: a.author_id });
      byQuestion.set(a.question_index, arr);
    }

    const updates: { id: string; assigned_to_id: string }[] = [];
    for (const [, items] of byQuestion) {
      const assigned = assignWithoutSelf(items);
      items.forEach((item, idx) => {
        updates.push({ id: item.id, assigned_to_id: assigned[idx].author_id });
      });
    }
    // bulk update
    for (const u of updates) {
      await supabaseAdmin.from("answers").update({ assigned_to_id: u.assigned_to_id }).eq("id", u.id);
    }

    // pick first reveal player (lowest player_number that isn't the mediator)
    const { data: firstPlayer } = await supabaseAdmin
      .from("room_players")
      .select("id, player_number")
      .eq("room_id", data.roomId)
      .neq("id", room.current_mediator_id)
      .order("player_number", { ascending: true })
      .limit(1)
      .maybeSingle();

    await supabaseAdmin
      .from("rooms")
      .update({
        phase: "reveal",
        reveal_player_id: firstPlayer?.id ?? null,
        reveal_question: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.roomId);

    return { ok: true, phase: "reveal" as const };
  });

// ---------------- Set reveal pointer ----------------
export const setRevealPlayer = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        playerId: z.string().uuid(),
        roomId: z.string().uuid(),
        targetPlayerId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("current_mediator_id, phase")
      .eq("id", data.roomId)
      .single();
    if (!room) throw new Error("Room not found");
    if (room.current_mediator_id !== data.playerId) throw new Error("Only the mediator");
    if (room.phase !== "reveal") throw new Error("Not in reveal phase");
    await supabaseAdmin
      .from("rooms")
      .update({ reveal_player_id: data.targetPlayerId, reveal_question: 0, updated_at: new Date().toISOString() })
      .eq("id", data.roomId);
    return { ok: true };
  });

// ---------------- End round + rotate mediator ----------------
export const endRound = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ playerId: z.string().uuid(), roomId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("current_mediator_id, round_seq")
      .eq("id", data.roomId)
      .single();
    if (!room) throw new Error("Room not found");
    if (room.current_mediator_id !== data.playerId) throw new Error("Only the mediator");

    // rotate mediator to next player_number
    const { data: players } = await supabaseAdmin
      .from("room_players")
      .select("id, player_number")
      .eq("room_id", data.roomId)
      .order("player_number", { ascending: true });
    const list = players ?? [];
    const idx = list.findIndex((p) => p.id === room.current_mediator_id);
    const next = list[(idx + 1) % list.length];

    // clear answers for next round
    await supabaseAdmin.from("answers").delete().eq("room_id", data.roomId).eq("round_seq", room.round_seq);

    await supabaseAdmin
      .from("rooms")
      .update({
        phase: "lobby",
        current_question: 0,
        reveal_player_id: null,
        reveal_question: 0,
        round_seq: room.round_seq + 1,
        current_mediator_id: next?.id ?? room.current_mediator_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.roomId);
    return { ok: true };
  });

// ---------------- Save round to history ----------------
export const saveRound = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ playerId: z.string().uuid(), roomId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("current_mediator_id, round_seq, phase")
      .eq("id", data.roomId)
      .single();
    if (!room) throw new Error("Room not found");
    if (room.current_mediator_id !== data.playerId) throw new Error("Only the mediator");

    const [{ data: players }, { data: ans }, { data: mediator }] = await Promise.all([
      supabaseAdmin.from("room_players").select("id, display_name, player_number").eq("room_id", data.roomId),
      supabaseAdmin
        .from("answers")
        .select("question_index, author_id, assigned_to_id, text")
        .eq("room_id", data.roomId)
        .eq("round_seq", room.round_seq),
      supabaseAdmin.from("room_players").select("display_name").eq("id", room.current_mediator_id).single(),
    ]);

    const payload = {
      players: players ?? [],
      answers: ans ?? [],
    };

    const { error } = await supabaseAdmin.from("saved_rounds").insert({
      room_id: data.roomId,
      round_seq: room.round_seq,
      mediator_name: mediator?.display_name ?? "Mediator",
      payload,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Reveal an assigned answer (player taps card) ----------------
// (Pure read — answers are already exposed via RLS in reveal phase, so this is
// just a no-op marker. Kept as a stub for future server-side reveal tracking.)