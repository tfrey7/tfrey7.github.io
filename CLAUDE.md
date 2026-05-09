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

- **The name** ("Tim Frey") is reserved for the avatar reveal. No generic interaction on it in the meantime.
- **Sound** off by default. If added later, it's opt-in or only triggered on direct click — never autoplay.
- **No layout shifts** that affect surrounding content. Animations stay within the element's bounding box.

## Interaction catalog

Element → idea → status (`proposed` / `building` / `built` / `retired`).

- **Technical Skills block** → click *anywhere* in the block (heading, gap, comma, item) triggers a single radial cascade: every item falls in a wave that ripples outward from the click point. ~1.2s after the wave settles, a stage curtain slides in from both sides, smoke puffs erupt at the seam, items snap back upright behind the curtain, then the curtain opens. → `building` (curtain stands in for the avatar's eventual fix routine — once he's ready, he should run out and "bring" the curtain rather than it appearing on its own)
- **Year / date range** → digits scramble or glitch briefly, then snap back to the correct value → `proposed`
- **Name "Tim Frey"** → avatar pokes out from behind the text → `blocked on avatar art`

Add new ideas here as we discuss them.
