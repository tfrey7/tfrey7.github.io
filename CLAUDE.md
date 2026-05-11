# personal-profile

Tim Frey's personal site, live at https://tfrey7.com. Built with Astro + Tailwind, deployed via GitHub Pages.

## What this site is

A resume that doubles as a Mario-Paint-inspired toy. Anyone who just wants the resume gets a clean resume. Anyone who pokes at the page finds little surprises scattered through it.

## Tone

Playful but professional. No violence, no crude humor. The site is a resume about being a computer programmer, so the playfulness should stay on-brand for that.

## Core motif: things break, I fix them

Most interactions follow the same shape: the user clicks something, it visibly breaks, then it gets fixed. This is what programmers do, so the motif is self-justifying — and it keeps the playfulness from feeling random.

For now, fixes happen automatically (the page appears to repair itself). Once the avatar art is ready, the avatar can start appearing to do the fixing himself, and earlier auto-fixing interactions can be retrofitted to involve him where it makes sense.

## Interaction principles

- **Distributed, not clustered.** One interaction per element, scattered across the page. Not many interactions on a single word.
- **Non-blocking for skim-readers.** A recruiter glancing for 20 seconds should never be interrupted. No autoplay sound, no layout-shifting animation, no required dismissals.
- **Info preserved.** A click never destroys real resume content. If something "breaks," it always lands back where it started.
- **Each element has its own personality.** Different element types get different reactions, not a shared generic effect — though elements of the same kind (e.g. all year ranges) can share one.
- **Repeatable.** Click again, it happens again. No once-only easter eggs that punish curiosity.

## Reserved / off-limits

- **Sound** only on user gesture (hover, click, etc.) — never on page load, never long enough to overlap the next gesture. Keep clips short and quiet so a recruiter clicking once isn't startled.
- **No layout shifts** that affect surrounding content. Animations stay within the element's bounding box.

## Avatar animations

Every avatar animation slots into one of three parts:

1. **Arrival** — how Tim gets on screen (jetpack, portal, slide-in, drop-in, somersault, etc.).
2. **Core** — what he actually does once he's there (hammer-fix, wave, peek, peace-sign, etc.). This is the gag the interaction is built around.
3. **Departure** — how he leaves. Optional; many interactions won't need a bespoke one.

Arrivals and departures are **shared, randomized libraries** — at runtime, pick a random arrival when Tim appears and (optionally) a random departure when he leaves. Cores are interaction-specific and named after the gag.

**Spawn point is per-interaction.** Sometimes Tim should appear at the clicked element; sometimes he should appear elsewhere (e.g. off-screen left of the section he's about to sweep across). Don't assume click-position — each Easter egg decides where its arrival lands.

**Seam contract.** Every segment hits the Original standing pose at the seams so any arrival can chain into any core into any departure without a visible pop:
- Arrivals: any first frame, **last frame locked to Original**.
- Cores: **first frame locked to Original**, **last frame locked to Original**.
- Departures: **first frame locked to Original**, any last frame.

**Cost note.** Locking the last frame forces AutoSprite to legendary quality (slower, more credits than standard). Keep each library small (2–3 arrivals, 2–3 departures) — past that they blur together and the cost stops paying off.

**When asked to add a new avatar animation, clarify which slot it fills (arrival / main / departure) before queueing.**
