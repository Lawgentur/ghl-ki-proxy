# KI-Risikoanalyse-Backend

Dieses Backend stellt die serverseitige API für die Risikoanalyse auf
`https://ki.berufsumstieg.de` bereit. Es hält den OpenAI-Schlüssel aus dem Browser
heraus, validiert Eingaben und Ausgaben und liefert das vom GoHighLevel-Frontend
erwartete Format `{ "analysis": ..., "cached": false }`.

## Konfiguration

`.env.example` nach `.env` kopieren und die Werte lokal setzen. Geheimnisse dürfen
nicht committed werden. In Render werden mindestens diese Variablen benötigt:

- `OPENAI_API_KEY`: eigener, aktiver Project API Key
- `OPENAI_MODEL`: standardmäßig `gpt-5.6-terra`
- `ALLOWED_ORIGINS`: `https://ki.berufsumstieg.de`

Build-Befehl: `npm ci`  
Start-Befehl: `npm start`

## Entwicklung

```bash
npm install
npm test
npm run dev
```

Healthcheck: `GET /health`  
Analyse: `POST /api/analyze-job-risk` mit `{ "jobTitle": "Buchhalter" }`

Die Prozentzahl ist eine modellgestützte Orientierung für einen Zeitraum von drei
bis sieben Jahren und keine exakte arbeitsmarktökonomische Prognose.
