# 7 Questions — Multiplayer Game Plan

A mobile-first web app (works great on iPhone via Safari; can be added to home screen). Players join a shared room by ID, take turns as mediator, answer 7 fixed questions one at a time, then reveal each other's shuffled answers one tap at a time.

## Core flow

1. **Lobby** — Create a room (get a 6-char room code) or Join with a code. Each player enters their own display name on their own device when joining. Players are auto-numbered 1, 2, 3… in join order. Min 4 players to start.
2. **Answer phase (one question at a time)** — Mediator controls advance. For every non-mediator:
   - Only the current question is shown on screen, with a text input and Submit.
   - Once submitted, that screen disappears and the player sees a "Waiting for others…" view.
   - The next question's input screen only appears after the mediator advances (which they can only do once everyone has submitted the current question).
   - Players never see a list of upcoming questions or their previous answers during the answer phase.
3. **Reveal phase** — After all 7 questions are answered by everyone, the server shuffles answers within each question so each player is assigned one answer per question (never their own when possible). Only now does each player's screen show the 7 hidden-answer cards. Mediator picks a starting player, walks Q1→Q7; that player taps each hidden card to reveal the assigned answer aloud. Repeats for every player.
4. **Round end** — Mediator ends the round; answers cleared; next player (round-robin by player number) becomes mediator. Round can be saved to history.
5. **Saved rounds** — Any player in the room can browse saved rounds (questions + each player's revealed answers).

## The 7 questions (fixed)
1. Who are you?
2. Where are you going?
3. What are you doing there?
4. Who did you meet there?
5. What did they say to you?
6. What did you say in return?
7. What was the final outcome?

## Screens

- **Home** — App title, Create Room, Join Room.
- **Join** — Enter room code + your display name.
- **Lobby** — Room code (big, shareable), live player list with numbers and names, "Start round" (mediator only, disabled <4 players).
- **Answer screen (player)** — Only the current question, input, Submit. After submit: "Waiting for others…" with a small progress indicator (e.g. 3/5 answered).
- **Answer screen (mediator)** — Current question, list of who has answered, "Next question" button (enabled only when all have submitted).
- **Reveal screen (player)** — 7 hidden cards labeled Q1–Q7; tap to reveal one at a time (only appears once the answer phase is fully complete).
- **Reveal screen (mediator)** — Pick next player, navigate question pointer, end round.
- **Round summary** — All revealed answers grouped by player, "Save round" + "Start next round" (rotates mediator).
- **Saved rounds** — List + detail view.

## Design

Playful party-game energy. Bold display type, high-contrast cards, big tap targets, soft confetti on reveal. Warm accent palette (coral/amber) on near-black background — readable in a room with friends. Mobile viewport set by default.

## Technical details

- **Lovable Cloud** for backend: rooms, players, rounds, answers, saved rounds — Postgres + realtime subscriptions so every device stays in sync.
- **Anonymous auth** so each device has a stable identity without forcing accounts.
- **Realtime** via Supabase channels per room — broadcasts player join, answer submitted, question advance, reveal pointer.
- **Server functions** (`createServerFn`) for sensitive transitions: create room, join room, submit answer, advance question (validates all answered), finalize answer phase + shuffle, set reveal pointer, save round, rotate mediator. Shuffle runs server-side only.
- **RLS**: only room members read/write their room's rows. During answer phase, a player can only read their own pending answer rows; mediator sees only who has/hasn't submitted (counts, not contents). Once phase flips to `reveal`, members can read all answers for that round.
- **Routes**: `/` (home), `/join` (join form), `/r/$code` (lobby + game — single route, UI switches on room phase), `/r/$code/history` (saved rounds).
- **Tables**: `rooms(id, code, phase, current_question, current_mediator_id, reveal_player_id, round_seq, created_at)`, `room_players(id, room_id, user_id, display_name, player_number, joined_at)`, `answers(id, room_id, round_seq, question_index, author_id, assigned_to_id, text)`, `saved_rounds(id, room_id, round_seq, mediator_id, payload jsonb, saved_at)`.
- Mobile preview set automatically.

## Out of scope (v1)
- Custom question packs (questions are fixed).
- Spectator mode.
- Native iOS build — mobile web app; Add-to-Home-Screen gives an app-like feel.

Approve and I'll enable Lovable Cloud and build it.