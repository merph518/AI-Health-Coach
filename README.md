This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Shared skills (Overmind)

The skills this repository uses come from [merph518/Overmind](https://github.com/merph518/Overmind).
They are vendored into `.claude/att-docs/` and pinned by `.claude/att-docs.lock` (repository, tag,
commit, and root tree SHA). Never edit the vendored copy by hand; a change goes to Overmind first.

- `.claude/skills/implement` and `.claude/skills/implement-with-speech` extend the `general` skills with
  this repository's paths, labels, and the test-artifact verification step. Each starts with a Base line
  that points at the vendored skill.
- `.claude/skills/voice-bridge-hooks/extension.json` holds this repository's values for the `voice` plugin.
  The plugin itself is installed at user scope (`claude plugin install voice@att-docs --scope user`), so
  the repository registers no hooks.
- `.claude/settings.json` turns off the user-scope `general@att-docs` and `att-docs@att-docs` plugins here,
  so each skill loads once, from `.claude/skills`.

```bash
npm run att-docs:check            # fails when the vendored copy differs from the lock (works offline)
npm run att-docs:sync -- v0.14.2  # move the pin: fetch a tag, replace the copy, rewrite the lock
```

After a sync, commit `.claude/att-docs/` and `.claude/att-docs.lock` together in one pull request, and run
`claude plugin update voice@att-docs` so the user-scope voice plugin updates (the pin does not govern the plugin, which runs from its own cache and takes the marketplace's latest).
