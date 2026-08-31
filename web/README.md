This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Local watch editor

The homepage combines a guided 585 × 559 Roblox classic-shirt canvas with a live R6 avatar preview. The colored template guide is display-only; generated and exported textures contain only the underlying shirt and committed watch.

Start the local FLUX.2 Klein renderer in one terminal:

```bash
cd ../modal/flux2-klein
source .venv/bin/activate
uvicorn local_server:app --host 127.0.0.1 --port 8000
```

Then start the web app in a second terminal:

```bash
cd web
npm run dev
```

The Next.js app has one model endpoint: `POST /api/watch_render`. It only contacts the renderer after
the user clicks **Generate Watch**; there is no warm-up or automatic model load. The proxy defaults
to the deployed Modal renderer. Set `WATCH_RENDER_URL=http://127.0.0.1:8000/watch-render` only when
you intentionally want the local backend.

## Getting Started

Create a `.env.local` with the following variables:

```
AUTH_SECRET=change-me-to-a-strong-secret
AUTH_TRUST_HOST=true
NEXTAUTH_URL=http://localhost:3000
AUTH_GOOGLE_ID=your-google-client-id
AUTH_GOOGLE_SECRET=your-google-client-secret

# Existing app variables
GENERATOR_API_URL=http://localhost:8090
GENERATOR_JWT=super-secret-key
```

Then install deps and run the development server:

```bash
npm install && npm run dev
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
