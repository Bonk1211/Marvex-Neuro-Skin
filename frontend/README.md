# NeuroSkin Frontend

Next.js control room for the deterministic NeuroSkin simulation API.

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

The dashboard expects the FastAPI service at `NEXT_PUBLIC_API_URL`, which defaults to `http://localhost:8000`.

Available scripts:

- `npm run dev` — development server on port 3000.
- `npm run lint` — ESLint validation.
- `npm test` — Vitest component tests.
- `npm run build` — production build and TypeScript verification.

