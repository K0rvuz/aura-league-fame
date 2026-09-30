# Aura Farming

League of Legends player aura board. Player scores, votes, and curated player quotes are stored in `data/aura-farming.sqlite` using SQLite.

## Requirements

- Node.js 22.12+
- npm

## Run locally

```powershell
npm install
npm run dev
```

The SQLite database is created under `data/` and persists across restarts.

Player lookup through the Riot API is optional. To enable adding Riot IDs, set `RIOT_API_KEY` in the ignored local `.env` file before starting the development server.

## Curated player quotes

Quotes are admin-only. There is no public form and no server endpoint that allows visitors to create, edit, or delete them.

The app automatically creates the `quotes` table on startup. A player can have any number of active quotes. One random active quote is chosen when that player is first loaded during a page visit, and it stays stable while the 3-second live ranking refresh runs. A full browser refresh can select a different quote.

### Add a quote

Use the exact player name shown on the board, including the Riot tag:

```powershell
npm run quotes -- add "Faker#KR1" "Hide on bush."
```

Add as many as you want:

```powershell
npm run quotes -- add "Faker#KR1" "Outra frase."
npm run quotes -- add "Faker#KR1" "Mais uma piada."
```

### List quotes

```powershell
npm run quotes -- list
```

### Disable or re-enable a quote

```powershell
npm run quotes -- disable 3
npm run quotes -- enable 3
```

Disabling is preferred over deleting so you can restore a quote later.

In production, run these commands from a shell attached to the deployed service so they modify the persistent SQLite database mounted at `data/aura-farming.sqlite`.
