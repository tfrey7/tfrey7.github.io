# tfrey7.github.io

Personal profile site for Tim Frey — a static Astro + Svelte site deployed to GitHub Pages.

**Live:** https://tfrey7.github.io/

## Stack

- [Astro](https://astro.build/) — static site builder
- [Svelte](https://svelte.dev/) — interactive islands & animations
- [Tailwind CSS](https://tailwindcss.com/) — styling
- GitHub Actions — build & deploy on push to `main`

## Develop

```bash
npm install
npm run dev      # http://localhost:4321/
npm run build    # static build to dist/
npm run preview  # serve the production build locally
```

## Editing content

Site content lives in [`src/data/profile.ts`](src/data/profile.ts) — bio, experience, skills, projects, contact links. Edit that file and the site updates everywhere.

Source materials (resume PDF, etc.) live in `references/` and are not deployed.

## Deploying

Pushes to `main` trigger `.github/workflows/deploy.yml`. One-time setup: in the GitHub repo settings, set **Pages → Source** to **GitHub Actions**.

To use a custom domain later: drop a `public/CNAME` file containing the domain and configure DNS — no other code changes needed.
