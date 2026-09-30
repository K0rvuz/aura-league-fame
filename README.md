# Aura Farming

Local League of Legends player aura board. Player scores and one-vote-per-player/session records are stored in `data/aura-farming.sqlite` using SQLite. The database is created empty on first run; players are added through the site.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. The SQLite database is created under `data/` and persists across restarts.

Player lookup through the Riot API is optional. To enable adding Riot IDs, set `RIOT_API_KEY` in the ignored local `.env` file before starting the development server. The board and voting work without a Riot API key or network connection.

Each browser creates a persistent session ID in local storage. SQLite enforces one vote per player and session, even if a vote is submitted more than once.
