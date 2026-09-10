# GoHighLevel-Anpassungen

Nach erfolgreichem Render-Deployment sind zwei kleine Änderungen in den Custom-Code-Blöcken nötig.

## Eingabeseite

- API-URL auf `https://ghl-ki-proxy.onrender.com/api/analyze-job-risk` ändern.
- Vor dem Speichern `response.ok` prüfen und eine verständliche API-Fehlermeldung anzeigen.
- Ergebnis nur in `sessionStorage` statt dauerhaft in `localStorage` ablegen.
- Analyseinhalte nicht in die Browser-Konsole schreiben.

Der relevante Aufruf soll so aussehen:

```js
const response = await fetch('https://ghl-ki-proxy.onrender.com/api/analyze-job-risk', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jobTitle })
});

const json = await response.json().catch(() => ({}));
if (!response.ok || !json.analysis) {
  throw new Error(json.error || 'Die Analyse konnte nicht erstellt werden.');
}

sessionStorage.setItem('jobResult', JSON.stringify(json));
sessionStorage.setItem('analyzedJobTitle', jobTitle);
window.location.href = 'https://ki.berufsumstieg.de/results-page';
```

Im `catch`-Block darf `err.message` als nutzerfreundlicher Hinweis angezeigt werden; der Button wird anschließend wieder aktiviert.

## Ergebnisseite

- Daten primär aus `sessionStorage` lesen; einmalig noch auf alte `localStorage`-Daten zurückfallen.
- Beide Speicher nach erfolgreichem Parsen sofort löschen.
- Modelltexte ausschließlich über `textContent` einsetzen. Das aktuelle `innerHTML` für Zusammenfassung, Jobtitel und dynamische Listen muss ersetzt werden, damit Modelltext niemals als ausführbares HTML interpretiert wird.

Übergangslogik für den Speicher:

```js
const stored = sessionStorage.getItem('jobResult') || localStorage.getItem('jobResult');
const jobTitle = sessionStorage.getItem('analyzedJobTitle') ||
  localStorage.getItem('analyzedJobTitle') || 'Beruf';

sessionStorage.removeItem('jobResult');
sessionStorage.removeItem('analyzedJobTitle');
localStorage.removeItem('jobResult');
localStorage.removeItem('analyzedJobTitle');
```
