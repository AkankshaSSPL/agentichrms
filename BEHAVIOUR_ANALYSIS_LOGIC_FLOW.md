# Behaviour Analysis — Logic Flow (two options)

> **Not an execution plan.** This describes *how the behaviour-analysis logic flows* —
> inputs, reasoning, outputs, decision points — so we can agree the logic with sir
> before building. Two options are presented: **A — Kickass** (rich, event-aware) and
> **B — Plain & Simple** (minimal, just works). Both satisfy the same locked rules.

## The shift (what changed)

**Old engine:** count document opens per category, cross a number → fire an HR alert.
**Sir's new engine:** *no counters, no thresholds.* An AI **reads the employee's actual
chat history**, judges their **behaviour / attitude / mood and how it changed over
time**, and turns that into (1) private supportive nudges for the employee and (2) an
**opt-in, summary-only** view the admin can choose to open.

> Example: an employee gets a **hike**, keeps chatting with the assistant, and the AI
> notices his **tone shifted after the raise** (disengaged / frustrated). The employee
> gets gentle support in chat; an admin *can* look at the summary if they want to.

## Locked rules (apply to BOTH options)

| Rule | Decision |
|---|---|
| **Engine** | Chat-history AI analysis — **replaces** the document-threshold logic entirely. |
| **Outputs** | **Both** — private employee nudge **and** an admin view. |
| **Admin trigger** | **On-demand** — the admin clicks "Analyse" for an employee; nothing is pushed, emailed, or belled. |
| **Admin depth** | **Summary / insight only** — sentiment, attitude trend, signals, suggested talking points. **No raw chat quotes.** Access is logged. |
| **Privacy** | Employee chats are never shown verbatim to admin; analysis is an inferred *signal to start a human conversation*, never fact. |

## Inputs & engine (shared)

- **Raw material:** the employee's stored conversations (`ChatSession` + `ChatMessage`,
  role / content / timestamps). Already captured — nothing new to collect.
- **Brain:** the same LLM the agent uses (`gpt-4o-mini`). It *reads* the conversation
  and *reasons* about behaviour. No keyword counting, no thresholds.
- **Two moments the brain runs:**
  - **Employee nudge** → at **chat time** (the assistant, already seeing the
    conversation, offers supportive next steps when it senses something).
  - **Admin analysis** → **on-demand** when an admin clicks, producing a stored summary.

---

## OPTION A — "Kickass" (rich, event-aware engine)

A dedicated **Behaviour Analyzer** that produces a structured, multi-dimensional read,
tracks change **over time**, and ties attitude shifts to **life events** the employee
mentions (hike, appraisal, promotion, manager change, workload).

```
                 ┌──────────────────────────────────────────────┐
                 │  EMPLOYEE CHATS NORMALLY (no idea it's read)   │
                 └───────────────────────┬──────────────────────┘
                                         │ stored ChatMessages
        ┌────────────────────────────────┴─────────────────────────────┐
        │                                                               │
   (chat-time, light)                                          (on-demand, deep)
        │                                                               │
        ▼                                                               ▼
┌───────────────────────┐                        ┌──────────────────────────────────┐
│ EMPLOYEE NUDGE PASS    │                        │ ADMIN ANALYSIS PASS (admin clicks)│
│ • last N messages      │                        │ 1. Pull full history, split into  │
│ • LLM: "sense mood;    │                        │    time windows (e.g. weekly)     │
│   if distress/         │                        │ 2. Detect EVENTS mentioned        │
│   disengagement/       │                        │    (hike, appraisal, conflict)    │
│   exit/POSH cue →      │                        │ 3. LLM scores each window:         │
│   offer next steps"    │                        │    sentiment, attitude_trend,     │
│ • delivered as a       │                        │    engagement, risk_signals,      │
│   private assistant    │                        │    confidence                     │
│   message + follow-up  │                        │ 4. Compare windows → "shift after │
└──────────┬────────────┘                        │    <event>" narrative             │
           │                                       │ 5. Produce SUMMARY ONLY:          │
           ▼                                       │    trend graph + signals +        │
   employee sees support                           │    suggested talking points       │
   in their own chat                               │ 6. Store snapshot (history kept)  │
                                                    └──────────────┬───────────────────┘
                                                                   ▼
                                                   ┌──────────────────────────────────┐
                                                   │ ADMIN VIEW (opt-in, access-logged)│
                                                   │ • sentiment trajectory over time  │
                                                   │ • "attitude changed after hike"   │
                                                   │ • risk signals + confidence       │
                                                   │ • suggested conversation starters │
                                                   │ • NO raw quotes                   │
                                                   └──────────────────────────────────┘
```

**What makes it kickass:**
- **Event-aware:** explicitly looks for things the employee references (got a raise,
  bad appraisal, new manager) and analyses attitude **around** that event — directly
  serves sir's "after the hike his attitude changed" example.
- **Trajectory, not a snapshot:** windows the history over time so admin sees a
  *trend line* (improving / stable / declining), not a single label.
- **Structured signals + confidence:** every insight carries a confidence and is framed
  as "worth a human chat", never as proof.
- **History of snapshots:** re-analysing later shows how the read itself evolved.
- **Curated employee solutions:** nudges suggest concrete, category-aware next steps
  (talk to manager, take leave, POSH guidance, growth path) — reusing existing tools
  (`apply_leave`, etc.) where a real action exists.

**Cost/complexity:** multiple LLM calls per analysis, a storage model for snapshots,
event extraction, and a richer admin UI (trend chart).

---

## OPTION B — "Plain & Simple" (just works)

One LLM call, one summary, minimal moving parts. Same rules, far less machinery.

```
 EMPLOYEE CHATS  ──►  ChatMessages stored
        │
        ├──────────────► EMPLOYEE SIDE (chat-time):
        │                the agent's system prompt always says
        │                "be emotionally aware; if you notice distress,
        │                 frustration, disengagement or a concern, gently
        │                 offer help and next steps." → support appears
        │                naturally in chat. No separate storage.
        │
        └──────────────► ADMIN SIDE (admin clicks "Analyse <employee>"):
                         1. grab the last ~50 messages
                         2. ONE LLM call → { overall_sentiment,
                            attitude_trend, short_summary,
                            suggested_talking_points }   (summary only)
                         3. show it in the admin view, log the access
                            (optionally cache the last result; recompute on click)
```

**What makes it simple:**
- **No new "events" logic, no time-windowing, no trend chart** — just a single
  holistic read returned as a short, human summary.
- **Employee support is prompt-driven**, not a separate pipeline — the agent simply
  behaves with emotional awareness during normal chat.
- **Admin view is one card:** sentiment + trend word + 3-line summary + a couple of
  suggested talking points. Summary only, access logged.
- **Cheapest to run and to reason about**; easy to demo to sir quickly.

**Trade-off:** coarser — gives a *current read*, not a rich "before vs after the hike"
narrative, and no stored history of how the read changed.

---

## Side-by-side

| Aspect | A — Kickass | B — Plain & Simple |
|---|---|---|
| LLM calls per admin analysis | Several (windowed + event) | One |
| "Attitude changed after hike" narrative | ✅ explicit, event-anchored | ⚠️ only if obvious in one read |
| Trend over time | ✅ trajectory + stored snapshots | ❌ current snapshot only |
| Employee nudge | Curated, category-aware + real actions | Prompt-driven emotional awareness |
| Admin view | Trend chart + signals + starters | One summary card |
| New storage | `behaviour_analysis` snapshots | None (or a tiny cache) |
| Build effort | High | Low |
| Demo-ready speed | Slower | Fast |
| Privacy posture | Summary-only, logged | Summary-only, logged |

Both keep chats private, both are admin-**opt-in**, both **replace** the threshold
engine, both serve **employee + admin**.

## Privacy & ethics (raise with sir, applies to both)
- Reading private chats to infer "attitude" is workplace monitoring — it generally
  needs **employee transparency/consent** ("conversations may be analysed") to be safe.
- Admin sees **summaries, never raw messages**; every admin view is **access-logged**.
- The analysis is **probabilistic** — present it as a prompt to start a *human*
  conversation, never as evidence or a performance judgement.

## Recommendation
Show sir both. If he wants the "wow" (the hike → attitude-shift story, trend over
time) → **Option A**. If he wants something private, cheap, and shippable now →
**Option B**. They share the same data, rules, and privacy model, so **B can ship
first and grow into A** without rework.
