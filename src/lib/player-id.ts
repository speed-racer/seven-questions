// Stable per-device player identifier (used as room_players.id).
// Generated lazily and persisted in localStorage. Client-only.

const KEY = "sq:player_id";

export function getPlayerId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}