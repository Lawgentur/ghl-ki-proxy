'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const {
  createApp,
  createCacheKey,
  normalizeAnalysis,
  riskLevelFor,
  validateJobTitle,
  validateLinkedInProfile
} = require('./proxy_backend_server');

const config = {
  port: 3000,
  apiKey: 'test-only',
  model: 'test-model',
  allowedOrigins: ['https://ki.berufsumstieg.de'],
  rateLimitWindowMs: 60_000,
  rateLimitMaxRequests: 100,
  requestTimeoutMs: 1_000,
  cacheTtlMs: 60_000
};

function fixture(jobTitle = 'Buchhalter') {
  return {
    riskLevel: 'mittel',
    riskPercentage: 45,
    jobTitle,
    summary: 'Ein Teil der wiederkehrenden Aufgaben ist automatisierbar, während Verantwortung und Beratung menschlich bleiben.',
    details: {
      automation_potential: 'Standardisierte Datenerfassung und Vorprüfung lassen sich automatisieren; Bewertung, Verantwortung und Kommunikation bleiben menschlich geprägt.',
      affected_tasks: ['Belege erfassen', 'Standardberichte erstellen', 'Konten vorprüfen'],
      safe_skills: ['Beratung', 'Urteilsvermögen', 'Regelwissen'],
      recommendations: ['Beratungskompetenz ausbauen', 'KI-gestützte Werkzeuge sicher einsetzen', 'Spezialwissen vertiefen']
    },
    alternativeJobs: [
      { title: 'Controller', description: 'Verbindet Zahlenanalyse mit geschäftlicher Beratung und Verantwortung.', riskPercentage: 35, transitionDifficulty: 'mittel', requiredSkillsGap: 'Planung und Business Partnering' },
      { title: 'Steuerberater', description: 'Erfordert komplexe Einordnung, Haftung und persönliche Mandantenberatung.', riskPercentage: 28, transitionDifficulty: 'schwierig', requiredSkillsGap: 'Examen und vertieftes Steuerrecht' },
      { title: 'Compliance Manager', description: 'Kombiniert Regelwissen mit Risikoabwägung und interner Kommunikation.', riskPercentage: 30, transitionDifficulty: 'mittel', requiredSkillsGap: 'Compliance-Prozesse und Branchenwissen' }
    ]
  };
}

test('validiert Jobtitel und entfernt unnötige Profildaten', () => {
  assert.deepEqual(validateJobTitle('  Data   Scientist  '), { valid: true, jobTitle: 'Data Scientist' });
  assert.equal(validateJobTitle(' ').valid, false);
  assert.equal(validateJobTitle('<script>alert(1)</script>').valid, false);
  assert.deepEqual(validateLinkedInProfile({ headline: 'Leitung', firstName: 'Nicht speichern' }), { headline: 'Leitung' });
});

test('ordnet auch null Prozent korrekt als niedrig ein', () => {
  assert.equal(riskLevelFor(0), 'niedrig');
  assert.equal(riskLevelFor(26), 'mittel');
  assert.equal(riskLevelFor(61), 'hoch');
  assert.equal(normalizeAnalysis({ ...fixture(), riskLevel: 'hoch', riskPercentage: 0 }, 'Test').riskLevel, 'niedrig');
  assert.equal(normalizeAnalysis({ ...fixture(), summary: '<b>Text</b>' }, 'Test').summary, 'Text');
});

test('Cache-Schlüssel enthält weder Jobtitel noch Profildaten', () => {
  const key = createCacheKey('Buchhalter', { headline: 'Geheime Position' });
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key.includes('buchhalter'), false);
  assert.equal(key.includes('Geheime'), false);
});

test('Healthcheck und CORS funktionieren für die Produktiv-Domain', async () => {
  const app = createApp({ config, analyzeJobRisk: async (title) => fixture(title) });
  const response = await request(app).get('/health').set('Origin', 'https://ki.berufsumstieg.de');
  assert.equal(response.status, 200);
  assert.equal(response.headers['access-control-allow-origin'], 'https://ki.berufsumstieg.de');
  assert.equal(response.body.model, 'test-model');
});

test('Analyse wird validiert und wiederholte Anfrage aus dem Cache bedient', async () => {
  let calls = 0;
  const app = createApp({
    config,
    analyzeJobRisk: async (title) => {
      calls += 1;
      return fixture(title);
    }
  });

  const first = await request(app).post('/api/analyze-job-risk').send({ jobTitle: 'Buchhalter' });
  const second = await request(app).post('/api/analyze-job-risk').send({ jobTitle: 'Buchhalter' });
  assert.equal(first.status, 200);
  assert.equal(first.body.cached, false);
  assert.equal(second.body.cached, true);
  assert.equal(calls, 1);
});

test('ungültige Eingabe und Upstream-Authentifizierungsfehler liefern sichere Antworten', async () => {
  const authError = Object.assign(new Error('secret detail'), { status: 401 });
  const app = createApp({ config, analyzeJobRisk: async () => { throw authError; } });

  assert.equal((await request(app).post('/api/analyze-job-risk').send({ jobTitle: '' })).status, 400);
  const response = await request(app).post('/api/analyze-job-risk').send({ jobTitle: 'Buchhalter' });
  assert.equal(response.status, 503);
  assert.equal(response.text.includes('secret detail'), false);
});

test('alter Statistik-Endpunkt gibt keine Cache- oder Nutzerdaten mehr preis', async () => {
  const app = createApp({ config, analyzeJobRisk: async (title) => fixture(title) });
  await request(app).post('/api/analyze-job-risk').send({ jobTitle: 'Buchhalter' });
  const response = await request(app).get('/api/stats');
  assert.equal(response.status, 404);
});

test('fehlerhaftes JSON wird als Clientfehler behandelt', async () => {
  const app = createApp({ config, analyzeJobRisk: async (title) => fixture(title) });
  const response = await request(app)
    .post('/api/analyze-job-risk')
    .set('Content-Type', 'application/json')
    .send('{');
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Die Anfrage enthält ungültiges JSON.');
});
