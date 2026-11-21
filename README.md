# Holland_Game — economy prototype 2.1

Een lichte, mobiele 2D-browsergame die direct werkt op GitHub Pages. De fabriek is voorlopig uitgeschakeld; de eerste focus is geld verdienen, bedrijven kopen en Nederlandse verzamelobjecten verzamelen.

## In deze versie

- Startsaldo is **0 Kaasmunten**.
- Zes tabbladen: **Work**, **Companies**, **Holland_Market**, **Crates**, **Holland_AH** en **Leaderboard**.
- Tien korte minigames (45–90 seconden): vliegtuig-interceptor, tankcommandant, radaroperator, bevoorradingsdropping, tulpen sorteren, Nederland-quiz, penalty challenge, fietskoerier, dijkbewaking en havenlogistiek.
- Drie moeilijkheidsniveaus. Hogere moeilijkheid vermenigvuldigt de beloning.
- **112 bedrijven**, van een limonadekraam van 50 KM (0,50 KM per vijf minuten) tot loodgieters, kappers, horeca, zorg, transport, landbouw, recycling, energie, AI, chipmachines, ruimtevaart en wereldconcerns. Er zijn meerdere opties in iedere prijsklasse.
- Bedrijven betalen iedere vijf minuten automatisch uit. Gemiste uitbetalingsrondes worden bij het opnieuw openen van de game verwerkt.
- Holland_Market is een **fictieve speelgeldmarkt**, met Nederlandse thema-items. Daarin zitten ook Friese items (Pompeblêd/Skûtsje) en Brabantse items (worstenbroodje/Bossche kermis). Koersen bewegen iedere 30 seconden, hebben verschillende volatiliteit, koersschokken en een lichte terugkeer naar de basiswaarde. Koershistorie wordt lokaal bewaard en offline ingehaald bij terugkomst. Geen echte crypto.
- Crates met zichtbare kansen en zes rarities: Common, Uncommon, Rare, Epic, Legendary en Mythic. De collectie loopt van een winkelwagentje tot de Burj Khalifa.
- Holland_AH ondersteunt lokale demo-aanbiedingen en gedeelde spelersaanbiedingen via Supabase; online aankopen betalen de verkoper en leveren het item aan de koper in één database-transactie.
- **Offline-first:** de game blijft volledig speelbaar zonder internet. Voortgang en marktkoersen worden direct in `localStorage` opgeslagen; als je later weer opent, worden bedrijfssalarissen en gemiste marktbewegingen ingehaald. Supabase is optioneel als extra cloudkopie.
- Supabase Anonymous Auth maakt automatisch een speleraccount aan; vrienden hoeven geen wachtwoord of registratieformulier te gebruiken.
- De publieke leaderboardtabel bevat alleen username, bedrijfsinkomen en aantal bedrijven. De volledige save is privé voor de speler. Holland_AH gebruikt een databasefunctie voor een atomaire aankoop: de koper betaalt, krijgt het item en de verkoper ontvangt de Kaasmunten in dezelfde transactie.
- Alleen de Kaasmunten hebben een eigen SVG-illustratie. De overige objecten gebruiken tijdelijke emoji/UI-symbolen die later door eigen tekeningen vervangen kunnen worden.

## Supabase instellen (cloud saves + leaderboard)

1. Maak een project op Supabase.
2. Open **Authentication → Providers** en schakel **Anonymous Sign-Ins** in.
3. Open de **SQL Editor** en voer `backend/schema.sql` volledig uit.
4. Open `config.js` en vul de project-URL en de publieke anon/publishable key in:

```js
window.HOLLAND_CONFIG = {
  SUPABASE_URL: "https://JOUW-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "JOUW-PUBLIEKE-ANON-KEY",
  RENDER_API_URL: ""
};
```

5. Commit `config.js` naar GitHub en herlaad de Pages-site.
6. In de footer moet **Supabase + lokaal opgeslagen** verschijnen. De eerste keer maakt de game automatisch een anonieme speler aan. Iedere wijziging wordt eerst lokaal opgeslagen en daarna naar Supabase gesynchroniseerd.

De Supabase anon/publishable key is bedoeld voor de browser. **Zet nooit de `service_role` key in `config.js`, HTML of JavaScript.** De save-tabel is met Row Level Security afgeschermd: iedere speler kan alleen zijn eigen save lezen en schrijven. De leaderboardprofielen zijn publiek leesbaar, maar bevatten geen wallet of inventaris.

Spelers krijgen automatisch een anoniem account; hun sessie staat in de browseropslag. Wie de browsergegevens wist, kan die anonieme account niet herstellen met alleen de username. Voeg later e-mail-, Discord- of andere accountkoppeling toe als spelers op meerdere apparaten moeten kunnen inloggen.

## Render (optioneel)

De statische game blijft zonder Render volledig werken op GitHub Pages. Supabase verzorgt optioneel cloud saves en de gedeelde online functies. Render is optioneel voor een aparte API-laag en server-side publieke feeds; de offline game en lokale koersmarkt hebben Render niet nodig.

Deploy `backend/` als aparte Render Web Service met Root Directory `backend`, Build Command `npm install` en Start Command `npm start`. Stel daar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` en `CORS_ORIGIN` in (voorbeeld in `backend/.env.example`). Deze kleine API levert momenteel health, leaderboard en actieve Holland_AH-listings. Persoonlijke saves, gedeelde aanbiedingen en de atomaire `purchase_ah_listing`-transactie lopen via de Supabase Auth-sessie en databasefunctie. De service-role key blijft uitsluitend op Render.

## Direct op GitHub Pages publiceren

1. Zet de bestanden en mappen uit deze repository in de **root** van je GitHub-repository (dus `index.html` staat direct naast `styles.css`).
2. Open **Settings → Pages**.
3. Kies bij **Build and deployment** voor **Deploy from a branch**.
4. Selecteer branch `main` en map `/(root)`, en sla op.
5. Open de Pages-URL. Na commits publiceert GitHub Pages de rootbestanden.

Dit is een statische versie en gebruikt geen Vite/React, `npm install` of `dist/`. Verwijder oude Vite/React-workflows die een `dist/`-map publiceren, anders kan een oude deployment de rootversie overschrijven.

## Lokaal testen

Open `index.html` direct in een browser. Voor een lokale server:

```bash
python -m http.server 8080
```

Open vervolgens `http://localhost:8080`. Controleer de catalogus en het opslaan met `node tests-validate.js` en `node tests-runtime.js`.

## Controls

- Vliegtuig: `A` / `D` of pijltjes om te bewegen, muis/klik of `spatie` om te schieten.
- Tank: `W` `A` `S` `D` of pijltjes om te rijden, muis/klik of `spatie` om te vuren.
- Alle spellen zijn ook met knoppen op het scherm te bedienen waar relevant.

## Bestanden

```text
index.html
styles.css
config.js
assets/cheese-coin.svg
js/catalog.js
js/app.js
backend/server.js
backend/schema.sql
```
