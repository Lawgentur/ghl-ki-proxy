/**
 * Proxy-Backend für KI-Risikoanalyse
 * 
 * Dieser Node.js/Express Server fungiert als sicherer Proxy zwischen dem GHL Frontend
 * und der OpenAI API. Der API-Schlüssel wird hier sicher gespeichert und nicht im
 * Frontend exponiert.
 * 
 * Installation:
 * npm install express cors dotenv openai
 * 
 * Umgebungsvariablen (.env):
 * OPENAI_API_KEY=sk-...
 * PORT=3000
 * ALLOWED_ORIGINS=https://ki.berufsumstieg.de,http://localhost:3000
 * 
 * Start:
 * node proxy_backend_server.js
 */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');

// Laden der Umgebungsvariablen
dotenv.config();

// ============================================================================
// KONFIGURATION
// ============================================================================

const CONFIG = {
  PORT: process.env.PORT || 3000,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  RATE_LIMIT_WINDOW: 60 * 60 * 1000, // 1 Stunde
  RATE_LIMIT_MAX_REQUESTS: 100, // Max 100 Anfragen pro Stunde pro IP
  REQUEST_TIMEOUT: 30000, // 30 Sekunden
  CACHE_TTL: 24 * 60 * 60 * 1000, // 24 Stunden
};

// ============================================================================
// VALIDIERUNG UND SETUP
// ============================================================================

if (!CONFIG.OPENAI_API_KEY) {
  console.error('FEHLER: OPENAI_API_KEY ist nicht gesetzt!');
  process.exit(1);
}

const app = express();

// ============================================================================
// MIDDLEWARE
// ============================================================================

// CORS-Konfiguration
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || CONFIG.ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS nicht erlaubt'));
    }
  },
  credentials: true,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// JSON Parser
app.use(express.json({ limit: '1mb' }));

// Request Logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

// ============================================================================
// RATE LIMITING
// ============================================================================

const requestCounts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip;

  if (!requestCounts.has(key)) {
    requestCounts.set(key, []);
  }

  const requests = requestCounts.get(key);
  
  // Entferne alte Anfragen außerhalb des Fensters
  const validRequests = requests.filter(time => now - time < CONFIG.RATE_LIMIT_WINDOW);
  requestCounts.set(key, validRequests);

  if (validRequests.length >= CONFIG.RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  validRequests.push(now);
  return true;
}

// ============================================================================
// CACHE-SYSTEM
// ============================================================================

const cache = new Map();

function getCacheKey(jobTitle, linkedInProfile) {
  const profileHash = linkedInProfile ? JSON.stringify(linkedInProfile) : 'null';
  return `${jobTitle.toLowerCase()}:${profileHash}`;
}

function getFromCache(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
    console.log(`[CACHE HIT] ${key}`);
    return cached.data;
  }
  if (cached) {
    cache.delete(key);
  }
  return null;
}

function setCache(key, data) {
  cache.set(key, {
    data,
    timestamp: Date.now()
  });
}

// ============================================================================
// SYSTEM-PROMPT
// ============================================================================

const SYSTEM_PROMPT = `Du bist ein hochspezialisierter Experte für die Bewertung des Automatisierungsrisikos von Berufen durch Künstliche Intelligenz. Deine Aufgabe ist es, eine präzise, datengestützte und personalisierte Analyse zu erstellen, die Berufsumsteiger:innen hilft, ihre Karrierezukunft zu planen.

### Analyseparameter:

**Zeitrahmen**: Bewerte das Automatisierungsrisiko für die nächsten 3-7 Jahre

**Risikoklassifizierung**:
- **NIEDRIG (0-25%)**: Berufe mit hohem Anteil an menschlicher Interaktion, Kreativität, strategischem Denken, emotionaler Intelligenz oder körperlicher Präzision
- **MITTEL (26-60%)**: Berufe mit teilweise automatisierbaren Aufgaben, aber auch Elementen, die menschliche Expertise erfordern
- **HOCH (61-100%)**: Berufe, deren Kernaufgaben bereits automatisierbar sind oder in naher Zukunft sein werden

**Bewertungskriterien**:
1. Automatisierungspotential der Kernaufgaben
2. Notwendigkeit von Kontextverständnis und Judgment
3. Grad der menschlichen Interaktion und emotionalen Intelligenz
4. Spezialisiertes Fachwissen vs. generische Fähigkeiten
5. Regulatorische und ethische Barrieren
6. Markttrends und Branchendynamiken

### Ausgabeformat:

Antworte AUSSCHLIESSLICH mit gültigem JSON (keine Markdown-Blöcke, keine zusätzlichen Erklärungen):

{
  "riskLevel": "niedrig" | "mittel" | "hoch",
  "riskPercentage": <Zahl 0-100>,
  "jobTitle": "<Exakte Berufsbezeichnung>",
  "summary": "<2-3 Sätze: Kernaussage zum Automatisierungsrisiko und warum>",
  "details": {
    "automation_potential": "<Detaillierte Beschreibung: Welche Aspekte des Berufs sind automatisierbar? Welche nicht? Warum?>",
    "affected_tasks": [
      "<Spezifische Aufgabe 1>",
      "<Spezifische Aufgabe 2>",
      "<Spezifische Aufgabe 3>"
    ],
    "safe_skills": [
      "<Fähigkeit 1>",
      "<Fähigkeit 2>",
      "<Fähigkeit 3>"
    ],
    "recommendations": [
      "<Empfehlung 1>",
      "<Empfehlung 2>",
      "<Empfehlung 3>"
    ]
  },
  "alternativeJobs": [
    {
      "title": "<Berufsbezeichnung 1>",
      "description": "<Begründung (max. 150 Zeichen)>",
      "riskPercentage": <Zahl 0-100>,
      "transitionDifficulty": "einfach" | "mittel" | "schwierig",
      "requiredSkillsGap": "<Kurze Beschreibung>"
    },
    {
      "title": "<Berufsbezeichnung 2>",
      "description": "<Begründung (max. 150 Zeichen)>",
      "riskPercentage": <Zahl 0-100>,
      "transitionDifficulty": "einfach" | "mittel" | "schwierig",
      "requiredSkillsGap": "<Kurze Beschreibung>"
    },
    {
      "title": "<Berufsbezeichnung 3>",
      "description": "<Begründung (max. 150 Zeichen)>",
      "riskPercentage": <Zahl 0-100>,
      "transitionDifficulty": "einfach" | "mittel" | "schwierig",
      "requiredSkillsGap": "<Kurze Beschreibung>"
    }
  ]
}

### Anforderungen für alternative Berufe:

1. **Risikoreduzierung**: Jeder alternative Beruf MUSS ein niedrigeres Automatisierungsrisiko haben als der analysierte Beruf
2. **Fähigkeitsübertragbarkeit**: Die Berufe müssen auf den vorhandenen Fähigkeiten aufbauen
3. **Marktrelevanz**: Wähle Berufe mit wachsendem Arbeitsmarkt
4. **Diversität**: Biete eine Mischung aus verwandten Berufen und innovativen Alternativen
5. **Personalisierung**: Wenn LinkedIn-Daten verfügbar sind, nutze diese zur Anpassung`;

// ============================================================================
// VALIDIERUNGSFUNKTIONEN
// ============================================================================

function validateJobTitle(jobTitle) {
  if (!jobTitle || typeof jobTitle !== 'string') {
    return { valid: false, error: 'Jobtitel ist erforderlich' };
  }

  const trimmed = jobTitle.trim();
  
  if (trimmed.length < 2) {
    return { valid: false, error: 'Jobtitel ist zu kurz' };
  }

  if (trimmed.length > 100) {
    return { valid: false, error: 'Jobtitel ist zu lang' };
  }

  // Prüfe auf verdächtige Zeichen
  if (!/^[a-zA-Z0-9äöüßÄÖÜ\s\-\/\(\)]+$/.test(trimmed)) {
    return { valid: false, error: 'Jobtitel enthält ungültige Zeichen' };
  }

  return { valid: true, jobTitle: trimmed };
}

function validateLinkedInProfile(profile) {
  if (!profile) return null;

  if (typeof profile !== 'object') {
    return null;
  }

  // Sanitize die Profile-Daten
  return {
    headline: profile.headline ? String(profile.headline).substring(0, 200) : undefined,
    summary: profile.summary ? String(profile.summary).substring(0, 500) : undefined,
    firstName: profile.firstName ? String(profile.firstName).substring(0, 50) : undefined,
    lastName: profile.lastName ? String(profile.lastName).substring(0, 50) : undefined
  };
}

// ============================================================================
// OPENAI INTEGRATION
// ============================================================================

const openai = new OpenAI({
  apiKey: CONFIG.OPENAI_API_KEY
});

async function analyzeJobRisk(jobTitle, linkedInProfile = null) {
  try {
    // Konstruiere den User-Prompt
    let userPrompt = `Analysiere das KI-Automatisierungsrisiko für den Beruf: ${jobTitle}`;
    
    if (linkedInProfile) {
      userPrompt += `\n\nZusätzliche Informationen aus dem Profil:`;
      if (linkedInProfile.headline) {
        userPrompt += `\nPosition: ${linkedInProfile.headline}`;
      }
      if (linkedInProfile.summary) {
        userPrompt += `\nZusammenfassung: ${linkedInProfile.summary}`;
      }
      if (linkedInProfile.firstName && linkedInProfile.lastName) {
        userPrompt += `\nName: ${linkedInProfile.firstName} ${linkedInProfile.lastName}`;
      }
      userPrompt += `\n\nNutze diese Informationen für eine personalisierte Analyse.`;
    } else {
      userPrompt += `\n\nBitte schlage drei alternative Berufe vor, die zu den typischen Fähigkeiten dieses Berufs passen.`;
    }

    console.log(`[OpenAI] Starte Analyse für: ${jobTitle}`);

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      timeout: CONFIG.REQUEST_TIMEOUT
    });

    const analysisText = response.choices[0].message.content;
    console.log(`[OpenAI] Antwort erhalten`);

    // Parse die JSON-Antwort
    let analysis;
    try {
      // Versuche zuerst, direkt zu parsen
      analysis = JSON.parse(analysisText);
    } catch (e) {
      // Versuche, JSON aus Markdown-Blöcken zu extrahieren
      const jsonMatch = analysisText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[1].trim());
      } else {
        throw new Error('Konnte JSON nicht aus der OpenAI-Antwort extrahieren');
      }
    }

    // Validiere die Struktur
    if (!analysis.riskLevel || !analysis.riskPercentage || !analysis.details || !analysis.alternativeJobs) {
      throw new Error('Ungültiges Antwortformat von OpenAI');
    }

    return analysis;

  } catch (error) {
    console.error(`[OpenAI] Fehler: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * Health Check Endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Hauptendpoint für die Risikoanalyse
 */
app.post('/api/analyze-job-risk', async (req, res) => {
  try {
    // Rate Limiting prüfen
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      console.warn(`[RATE LIMIT] IP: ${clientIp}`);
      return res.status(429).json({
        error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.'
      });
    }

    // Validiere den Request
    const { jobTitle, linkedInProfile } = req.body;

    const validation = validateJobTitle(jobTitle);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const validatedProfile = validateLinkedInProfile(linkedInProfile);

    // Prüfe den Cache
    const cacheKey = getCacheKey(validation.jobTitle, validatedProfile);
    const cachedResult = getFromCache(cacheKey);
    if (cachedResult) {
      return res.json({ analysis: cachedResult, cached: true });
    }

    // Rufe die Analyse auf
    const analysis = await analyzeJobRisk(validation.jobTitle, validatedProfile);

    // Speichere im Cache
    setCache(cacheKey, analysis);

    // Rückgabe
    res.json({ analysis, cached: false });

  } catch (error) {
    console.error(`[ERROR] ${error.message}`);

    // Unterscheide zwischen verschiedenen Fehlertypen
    if (error.message.includes('API')) {
      return res.status(503).json({
        error: 'OpenAI API ist nicht erreichbar. Bitte versuchen Sie es später erneut.'
      });
    }

    if (error.message.includes('timeout')) {
      return res.status(504).json({
        error: 'Die Anfrage hat zu lange gedauert. Bitte versuchen Sie es später erneut.'
      });
    }

    res.status(500).json({
      error: 'Ein Fehler ist bei der Analyse aufgetreten.'
    });
  }
});

/**
 * Statistik-Endpoint (optional)
 */
app.get('/api/stats', (req, res) => {
  res.json({
    cacheSize: cache.size,
    cacheEntries: Array.from(cache.keys()),
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`);
  
  if (err.message.includes('CORS')) {
    return res.status(403).json({ error: 'CORS nicht erlaubt' });
  }

  res.status(500).json({
    error: 'Ein interner Fehler ist aufgetreten.'
  });
});

// ============================================================================
// SERVER START
// ============================================================================

app.listen(CONFIG.PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   KI-Risikoanalyse Proxy-Backend                          ║
║   Server läuft auf Port ${CONFIG.PORT}                            ║
║   Umgebung: ${process.env.NODE_ENV || 'development'}                        ║
║   Erlaubte Origins: ${CONFIG.ALLOWED_ORIGINS.join(', ')}  ║
╚════════════════════════════════════════════════════════════╝
  `);

  // Cleanup alte Cache-Einträge alle 6 Stunden
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, value] of cache.entries()) {
      if (now - value.timestamp > CONFIG.CACHE_TTL) {
        cache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[CACHE] ${cleaned} alte Einträge gelöscht`);
    }
  }, 6 * 60 * 60 * 1000);
});

module.exports = app;
