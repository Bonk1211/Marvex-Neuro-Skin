# NeuroSkin Frontend

Next.js control room for the deterministic NeuroSkin simulation API.

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

The dashboard expects the FastAPI service at `NEXT_PUBLIC_API_URL`, which defaults to `http://localhost:8000`.

### Occupants and daylight demo

Open [the Floor view](http://localhost:3000/dashboard?view=floor) with the backend running and the trained `backend/data/daylight/models/{et,ev}.joblib` files installed. This link enables the daylight model on the initial run; when entering from another view, use **Load Et/Ev predictions**.

Choose North/East/South/West and a floor group (1–2, 3–4, 5–6, or 7) to focus the 3D cutaway. Hover desks, seats, or people for readings. Cards show mean Et and maximum seat Ev; the desk/seat colours use the model's comfort thresholds. Walking and seated people, cyan detection rings, tracking IDs, and counts are scripted mock data. Their counts follow timeline occupancy; **Pause people** freezes walking independently of sun playback. Reduced-motion preferences also freeze walking. Et/Ev stay at fixed probes, and facade control decisions are unchanged.

Available scripts:

- `npm run dev` — development server on port 3000.
- `npm run lint` — ESLint validation.
- `npm test` — Vitest component tests.
- `npm run build` — production build and TypeScript verification.
