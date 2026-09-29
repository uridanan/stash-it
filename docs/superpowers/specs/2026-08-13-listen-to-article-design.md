# Listen to an article — design

Date: 2026-08-13
Status: approved, ready for implementation planning

## Goal

Let a reader listen to a saved article instead of reading it. The narrated text
follows whatever the reader currently has on screen, and a persistent player
gives play/pause, stop, rewind 10 seconds, and reading speed.

## Decisions

Three choices were settled before this design was written:

1. **Engine: browser-native first, cloud-ready.** Phase 1 uses the Web Speech
   API only, behind a `TtsEngine` interface so a server-side neural TTS engine
   can be added later without touching the UI. Native is free, needs no API
   key, works offline, and starts instantly. The cost is that rewind-10s is an
   estimate rather than a true seek, and voice quality depends on the device.
2. **UI: docked mini-player.** Bottom-fixed on mobile; docked to the bottom of
   the reader pane on desktop so it never covers the article list in split view.
3. **Highlighting: yes, with auto-scroll.** The active sentence is washed in
   `violet-100` and kept in view, so a listener can glance down to find their
   place or stop listening and keep reading from the same spot.

## What gets read

The narrated source depends on the reader's current display state. The
`summaryView` user setting already selects between two layouts (see
`article-reader.tsx`), and the tab within the `tabs` layout is a third input.

| View state                     | Chunk sources                    |
| ------------------------------ | -------------------------------- |
| `tabs` + Summary tab active    | title → summary                  |
| `tabs` + Full article active    | title → article                  |
| `card` (summary above article) | title → summary → article        |

The article title is always chunk 0.

**This is implemented by reading `[data-listen]` containers in DOM order**, not
by passing the layout and tab into the player. The tabs layout renders only the
active panel, so DOM order already encodes all three rows of that table. A
collapsed summary card is absent from the DOM and therefore not narrated —
correct, since narration follows what is displayed.

### Interruptions

Three distinct events, easily conflated:

| Event                                                | Behavior                                                  |
| ---------------------------------------------------- | --------------------------------------------------------- |
| Summary ⇄ Full article tab switch (in-reader tabs)   | Session stops; reader presses Listen again                |
| Navigating to a different article                    | Unmount → `cancel()` in cleanup                           |
| Browser tab switch, app backgrounded, or screen lock  | Outside our control with the native engine — see below    |

**Switching the in-reader Summary/Full article tab mid-playback stops the
session.** The summary DOM unmounts on switch, so sentence highlighting cannot
survive it; stopping is more predictable than silently re-seeking into a
different body of text. The player collapses and the reader presses Listen
again for the new selection.

### Backgrounding and screen lock — a known phase-1 limitation

With the Web Speech engine, background playback is largely not ours to control:

- Desktop browsers generally keep speaking across a browser tab switch.
- **iOS Safari suspends speech when the app is backgrounded or the screen
  locks.**
- Android Chrome is inconsistent.

So on mobile, phase 1 realistically means listening with the screen on and the
app in the foreground. True background audio requires the MediaSession API,
which requires a real `<audio>` element, which requires the cloud engine. If
screen-off listening on a phone turns out to be a primary use case, the cloud
engine stops being a later phase and becomes the first one.

## Architecture

### New modules

```
src/lib/tts/
  segment.ts            pure: text → sentence strings (Intl.Segmenter)
  engine.ts             TtsEngine interface + shared types
  web-speech-engine.ts  the only engine today; absorbs all browser quirks
src/components/listen/
  wrap-sentences.ts     DOM walker: text nodes → <span data-chunk="N">
  listen-provider.tsx   context: active source, chunk list, playback state
  listen-player.tsx     the docked bar
```

Each module has one job and can be understood without reading the others:
`segment.ts` knows about sentences and nothing about the DOM;
`wrap-sentences.ts` knows about the DOM and nothing about speech;
`web-speech-engine.ts` knows about speech and nothing about React;
`listen-provider.tsx` holds state and wires the three together.

### Edits to existing files

- `article-reader.tsx` — wrap the content in `ListenProvider`, pass refs for
  the summary and article containers.
- `summary-view.tsx` — `SummaryTabs` reads and writes its active `tab` from
  context instead of the local `useState` it holds today (line 96). This is the
  state lift that lets the player know what is on screen.
- `reader-controls.tsx` — add the 🎧 Listen button to the existing sticky
  control row.
- `split-panes.tsx` — add `relative` to the reader column so the player can
  position against it.

### The engine seam

```ts
interface TtsChunk {
  index: number;
  text: string;
}

interface TtsVoice {
  id: string;
  label: string;
  lang: string;
}

interface TtsEvents {
  onChunkStart(index: number): void;
  onEnd(): void;
  onError(message: string): void;
}

interface TtsEngine {
  readonly id: string;
  readonly capabilities: { exactSeek: boolean };
  listVoices(): Promise<TtsVoice[]>;
  preview(voiceId: string, sample: string): void;
  play(
    chunks: TtsChunk[],
    fromIndex: number,
    opts: { voiceId: string | null; rate: number },
    events: TtsEvents,
  ): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setRate(rate: number): void;
}
```

`capabilities.exactSeek` is `false` for Web Speech and `true` for a future
cloud engine; the player reads it to decide whether rewind is a real seek or an
estimate.

## The two hard parts

### Sentence wrapping

`Intl.Segmenter` handles segmentation — no new dependency, and far better at
abbreviations than any regex. The difficulty is sentences spanning inline
elements:

```html
He said <em>hello</em>. Then he left.
```

Rule: segment within each text node, and close a chunk only when its text ends
in sentence-final punctuation. Otherwise adjacent text nodes join the same
chunk id. One chunk may therefore own several spans, and all of its spans
highlight together.

Skipped elements: `<script>`, `<style>`, `<figcaption>`. Captions interrupt
narration flow.

Sentences longer than ~280 characters are split at clause boundaries (`,` `;`
`:`) so that rewind stays reasonably granular and no single utterance runs long
enough to hit browser utterance-length limits.

### Web Speech quirks the engine must hide

- `getVoices()` returns an empty array on first call in Chrome. Voices resolve
  on the `voiceschanged` event, and **must be loaded before the play click** —
  iOS Safari requires the first `speak()` to happen inside the user gesture
  with no awaits in front of it.
- `speechSynthesis` is a global singleton. `cancel()` in cleanup is mandatory
  or narration continues after the reader navigates away.
- `pause()` is unreliable on Android Chrome. The engine feature-detects and
  falls back to stop-and-remember-index, with resume replaying from that index.
- Rate cannot change mid-utterance. `setRate` restarts the current sentence —
  one audible sentence restart, accepted as a trade.
- Chunking also sidesteps Chrome's tendency to cut off long utterances and to
  throttle background tabs.

### Rewind 10 seconds

With the native engine this is an estimate, by design. Track wall-clock elapsed
within the current chunk, then walk backwards through prior chunks using
`words / (rate × 2.7 words-per-second)` until roughly 10 seconds is covered,
and restart there. When a cloud engine lands, `capabilities.exactSeek` flips
and this becomes a true audio seek.

## UI

```
┌──────────────────────────────────────────────────────┐
│ Summary · 12/48   ▬▬▬▬▬▬▬▬░░░░░░░░░░░░░░░░░░░░░░░░░ │
│   ⟲10    ⏸    ✕                            1.0× ▾   │
└──────────────────────────────────────────────────────┘
```

The player renders only during an active session; ✕ dismisses it.

Positioning is a single `sticky bottom-0` rule for every breakpoint. The
desktop reader pane (`split-panes.tsx`) is itself the scroll container, so
`absolute bottom-0` would pin the bar to the bottom of the *content* rather
than the visible area; sticky pins to the scrollport on desktop and to the
viewport on the mobile `/article/[id]` page. Consequences:

- **Mobile:** pinned to the bottom of the viewport, full width, with
  `pb-[env(safe-area-inset-bottom)]`.
- **Desktop, split view:** spans only the reader column, never covering the
  article list. No change needed to `split-panes.tsx`.
- **Bottom clearance already exists** — `pb-16` on both the split-view reader
  container and the standalone article page.

Speed chip cycles 0.75 / 1 / 1.25 / 1.5 / 1.75 / 2.

**Voice selection lives in Settings, not the player.** Speed is a per-session
choice and belongs in the transport; voice is chosen once and would be clutter
in the bar.

Desktop keyboard shortcuts: `L` starts listening, space pauses and resumes, `←`
rewinds.

Auto-scroll uses `behavior: "smooth"`, falling back to `"auto"` under
`prefers-reduced-motion`.

### Accessibility

- Player buttons carry `aria-label`s; progress is a `role="progressbar"` with
  `aria-valuenow` / `aria-valuemax`.
- The `violet-100` highlight wash keeps text contrast well within AA against
  the existing `slate-800` body color.
- Wrapping spans are plain and unstyled apart from the highlight, so screen
  reader traversal of the article is unchanged.

### Settings

A new "Listening" section on `/settings`:

- Voice dropdown, grouped by language, populated from `listVoices()`.
- ▸ Preview button that speaks a fixed sample sentence in the selected voice.
- Default speed.
- An explanatory note when the device reports no voices.

This section is **client-only** and does not go through `/api/settings` or the
`User` row, unlike the AI summary settings that sit above it on the same page.
Voice and rate persist to `localStorage` under `stash:tts-voice` and
`stash:tts-rate`, matching how `reader-controls.tsx` already stores font
preferences. This is the correct store rather than the lazy one: OS voices are
per-device, and a voice id available on a phone will not exist on a desktop, so
syncing the choice through the `User` row would actively produce broken state.
**No database migration is needed for phase 1.**

## Failure modes

| Condition                                          | Behavior                                                     |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `window.speechSynthesis` absent                    | Listen button never renders                                  |
| Device reports zero voices                         | Button disabled; tooltip explains installing OS voices       |
| Zero chunks (near-empty `extractionFailed` article) | Player reports "nothing to read on screen" and returns to idle |
| Engine error mid-session                           | Player shows the message inline and stops                    |
| Navigation or unmount mid-session                  | `cancel()` in cleanup                                        |

## Testing

`segment.ts` and `wrap-sentences.ts` are pure and carry most of the edge-case
risk in this feature. Covering them through a browser would be miserable.

**This requires adding a unit runner.** The repo has Playwright only today. Add
`vitest` (one dev dependency, standard for Next projects) with a `jsdom`
environment and the `@/` path alias, exposed as `npm run test:unit`.

The concrete reason to add it rather than reuse Playwright: `playwright.config.ts`
boots a Next dev server on port 3100 and its `globalSetup` resets the
`stash_e2e` database on every run. Pure-function tests dragging that apparatus
along would turn a 50ms sentence-segmentation test into a ~30-second one. A
separate Playwright project config could avoid the server and DB boot — Node 20
has `Intl.Segmenter` and `jsdom` is already a dependency — but that is more
configuration for a worse result.

Unit tests:

- `segment.ts` — abbreviations (`Dr. Smith left.` is one sentence), long
  sentence clause splitting, empty and whitespace-only input, non-Latin text.
- `wrap-sentences.ts` (via the existing `jsdom` dependency) — inline elements
  merging into one chunk, block boundaries forcing new chunks, skipped tags,
  correct chunk ordering.

E2E tests (`e2e/listen.spec.ts`):

Headless Chromium has **no** TTS voices, so real speech is untestable in CI.
`page.addInitScript` installs a fake `speechSynthesis` that reports two voices
and fires `onend` on a timer. The specs then assert real behavior rather than
the fake:

- the correct source is narrated in each of the three view states
- pause and resume
- stop hides the player
- rewind moves the active index backwards
- the speed chip's value reaches the engine
- the highlight class tracks the active chunk

## Out of scope

Deliberately excluded from this phase. Background/lock-screen playback is a
confirmed "nice to have, not blocking", so the requirement on phase 1 is that
the engine seam and the player let the cloud engine land as a self-contained
follow-up with **no UI rework** — the player must never reach past `TtsEngine`
to touch `speechSynthesis` directly, and anything the native engine can only
approximate is gated on `capabilities`, not hardcoded.

All of the following become cheaper once that seam exists:

- Cloud neural TTS (server route, BYO key, audio caching in GCS)
- Downloadable local neural models (Piper, Kokoro via WASM)
- A custom-voice slot for user-supplied voice ids or model URLs
- Background and lock-screen playback via the MediaSession API
- A cross-article listening queue

## Note on celebrity voices

Requested during brainstorming and declined, for the record.

A voice is protected independently of copyright under right-of-publicity law.
*Midler v. Ford* and *Waits v. Frito-Lay* established that **imitating** a
distinctive voice is actionable even when no recording is copied; California
Civil Code §3344 and Tennessee's 2024 ELVIS Act cover AI voice cloning
specifically, and the UK and EU reach comparable outcomes through personality
rights and passing off.

"Personal use" lowers the practical odds of a *user* being sued, but it is not
a statutory exemption, and it does not apply to the app. Shipping a picker that
lists a real person's name, or curating and linking a repository of celebrity
voice clones, is the app distributing and inducing that use — which is both
where the liability sits and a straightforward terms-of-service termination
with every major TTS provider, which would also cost the app its summaries key.

Legitimate alternatives, for a later phase:

- **Character voices rather than impressions.** OpenAI and Gemini TTS accept
  style instructions, so a preset can be "warm, gravelly, unhurried documentary
  narrator" over a licensed voice — the texture, named as a character rather
  than as a person.
- **A custom-voice slot.** Settings exposes a field for the user's own provider
  voice id or their own model URL. The app ships the mechanism and no catalog.
- **ElevenLabs' licensed marketplace** of consenting actors and estates, if
  genuinely famous voices are wanted, plugged into the future cloud engine.
