# UrbanFlow Portal — Prototype

Smart India Hackathon 2026 · PS ID 26205 · Team Cypher

A single-folder FastAPI + Leaflet.js prototype of the UrbanFlow Portal idea:
a live map where citizens and field staff report road/traffic/transit issues
(with optional photos), traffic police / road crews / transit teams see the
same live view, and a rule-based engine predicts which corridors are at risk
of delay.

## Run it

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

Then open **http://localhost:8000**

The app seeds ~18 realistic issues around Hinjawadi, Katraj, Swargate, and
central Pune on first run, so the map is populated immediately — no setup
step needed before a demo.

## Functionality

1. **Live map** — colored pins for potholes, signal failures, waterlogging,
   and bus breakdowns, clustered around Hinjawadi/Katraj/Swargate.
2. **Click-to-report** — click anywhere on the map, fill the form, optionally
   attach a photo. It appears on the map and in the sidebar list immediately.
3. **10-second live refresh** — the whole map/list/predictions re-poll every
   10s automatically (see the "Live · updated …" pill top-right) — no page
   reload, matching the "live updates without refreshing" claim in the pitch.
4. **Corridor delay forecast** — colored road segments (green/amber/red) in
   the sidebar and on the map, driven by `/api/predictions`, which factors in
   time-of-day (peak hour) + nearby open issues.
5. **Role selector** (top-right) — switching between Traffic Police / Road
   Crew / Transit Team doesn't change the data on purpose: the point is that
   every role is looking at the *same* live map instead of separate systems.
6. **Duplicate handling** — reporting the same issue twice within ~50m merges
   into one pin with a "reported N× by nearby users" note, instead of
   spamming the map.

## Project structure

```
urbanflow-portal/
├── main.py              FastAPI backend: issues, predictions, stats, uploads
├── requirements.txt
├── static/
│   ├── index.html       Dashboard shell
│   ├── style.css        Dark "digital twin" theme
│   └── app.js           Map rendering, polling, report form, filters
├── data/issues.json     Auto-created + auto-seeded on first run
└── uploads/             Uploaded issue photos land here
```

## API quick reference

| Method | Path                         | Purpose                          |
|--------|-------------------------------|-----------------------------------|
| GET    | `/api/issues`                 | List all issues                  |
| POST   | `/api/issues`                 | Report an issue (multipart form) |
| PATCH  | `/api/issues/{id}/resolve`    | Mark an issue resolved           |
| GET    | `/api/predictions`            | Corridor delay-risk forecast     |
| GET    | `/api/stats`                  | Open/resolved counts by category |


