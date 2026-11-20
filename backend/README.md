# Backend-koppeling (Supabase + Render)

## Cloud saves via Supabase

De browsergame ondersteunt nu direct opslaan via Supabase, naast `localStorage`:

- Supabase Anonymous Auth maakt automatisch een persistente speleridentiteit aan.
- `player_saves` bewaart de volledige save als JSONB en is privé per `auth.uid()`.
- De game schrijft eerst lokaal (direct) en synchroniseert daarna met een korte debounce naar Supabase.
- Bij het starten vergelijkt de game de lokale en cloud-save en laadt de nieuwste versie.
- `player_profiles` bevat alleen publieke leaderboardgegevens (username, bedrijfsinkomen, aantal bedrijven en lifetime earned).
- `ah_listings` bevat gedeelde aanbiedingen. Spelers kunnen alleen hun eigen aanbiedingen plaatsen of intrekken.
- `purchase_ah_listing(uuid)` voert een online aankoop atomair uit: controleert saldo en eigenaarschap, betaalt de verkoper, geeft het item aan de koper en markeert de listing als verkocht.

Schakel in Supabase **Authentication → Providers → Anonymous Sign-Ins** in en voer `schema.sql` uit. Vul daarna `SUPABASE_URL` en de publieke anon/publishable key in `config.js` in. Gebruik nooit een `service_role` key in de frontend.

## Render API

De meegeleverde Render API exposeert:

- `GET /api/health`
- `GET /api/leaderboard`
- `GET /api/ah/listings`

Deploy `backend/` als Web Service met Build Command `npm install` en Start Command `npm start`. Environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` en `CORS_ORIGIN`.

Render is voor deze build optioneel. Cloud saves, online Holland_AH-listings en atomaire aankopen werken rechtstreeks via Supabase. Render biedt een losse API-laag voor health checks, leaderboardfeeds en actieve listings.
