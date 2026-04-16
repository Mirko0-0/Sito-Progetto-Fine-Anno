const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const GEMINI_API_KEY = '';
const MODEL = 'gemini-2.5-flash';

const app = express();
const PORT = 3000;

const SESSION_ID = 1; // single player

app.use(express.json());
app.use(express.static('public'));

// ======================
// API KEY (SICUREZZA)
// ======================
app.use((req, res, next) => {
  const key = req.headers['x-api-key'];
  if (key !== 'maturita2025') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
});

// ======================
// DB POOL
// ======================
const db = mysql.createPool({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'progettomaturita',
  waitForConnections: true,
  connectionLimit: 10
});

// ======================
// GEMINI
// ======================
async function sendMessageToGemini(message, instructions) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': GEMINI_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: instructions }]
      },
      contents: {
        parts: [{ text: message }]
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

// ======================
// UTIL
// ======================
function extractCommand(text) {
  const matches = [...text.matchAll(/\$\^\{\{!(.*?)!\}\}\^\$/g)];
  if (matches.length === 0) return null;

  try {
    return JSON.parse(matches[0][1]);
  } catch {
    return null;
  }
}

function removeCommand(text) {
  return text
    .replace(/\$\^\{\{!(.*?)!\}\}\^\$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ======================
// DB FUNCTIONS
// ======================
async function saveMessage(sessionId, ruolo, contenuto) {
  await db.execute(`
    INSERT INTO messaggi (id_sessione, ruolo, contenuto)
    VALUES (?, ?, ?)
  `, [sessionId, ruolo, contenuto]);
}

async function saveCommand(commandObj) {
  const [result] = await db.execute(`
    INSERT INTO comandi 
    (id_sessione, tipo_comando, payload, stato)
    VALUES (?, ?, ?, 'in_attesa')
  `, [
    SESSION_ID,
    commandObj.action || 'ai_command',
    JSON.stringify(commandObj)
  ]);

  return result.insertId;
}

async function logError(id_comando, message) {
  await db.execute(`
    INSERT INTO errori (id_comando, messaggio)
    VALUES (?, ?)
  `, [id_comando, message]);
}

// ======================
// CHAT
// ======================
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Messaggio non valido'
      });
    }

    // salva utente
    await saveMessage(SESSION_ID, 'utente', message);

    const instructions = `
Se devi eseguire un'azione nel gioco, restituisci SOLO un comando JSON nel formato:

$^{{!{"action":"nome","parametri":{}}!}}^$

Esempio:
$^{{!{"action":"accendi_luce","id":12}!}}^$

Regole:
- JSON valido
- massimo un comando
- niente testo dentro il JSON

Se non serve azione, rispondi normalmente.
`;

    const result = await sendMessageToGemini(message, instructions);

    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const command = extractCommand(text);
    const responseText = removeCommand(text);

    // salva risposta AI
    await saveMessage(SESSION_ID, 'ia', responseText);

    let commandId = null;

    if (command) {
      commandId = await saveCommand(command);
      console.log('Comando salvato:', command);
    }

    return res.json({
      success: true,
      response: responseText,
      hasCommand: !!command,
      commandId
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================
// ROBLOX POLLING (SAFE)
// ======================
app.get('/api/comando', async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(`
      SELECT *
      FROM comandi
      WHERE stato = 'in_attesa'
      ORDER BY data_creazione ASC
      LIMIT 1
      FOR UPDATE
    `);

    if (rows.length === 0) {
      await connection.commit();
      return res.json({ success: false, message: 'Nessun comando' });
    }

    const comando = rows[0];

    await connection.execute(`
      UPDATE comandi
      SET stato = 'eseguito',
          data_esecuzione = NOW()
      WHERE id = ?
    `, [comando.id]);

    await connection.commit();

    return res.json({
      success: true,
      comando: {
        id: comando.id,
        tipo: comando.tipo_comando,
        payload: JSON.parse(comando.payload),
        sessione: comando.id_sessione
      }
    });

  } catch (err) {
    await connection.rollback();
    return res.status(500).json({
      success: false,
      error: err.message
    });
  } finally {
    connection.release();
  }
});

// ======================
// EVENTO DA ROBLOX
// ======================
app.post('/api/evento', async (req, res) => {
  try {
    const { id_comando, descrizione, esito } = req.body;

    await db.execute(`
      INSERT INTO eventi_gioco (id_comando, descrizione, esito)
      VALUES (?, ?, ?)
    `, [id_comando, descrizione, esito]);

    if (esito === 'fallimento') {
      await logError(id_comando, descrizione);
    }

    return res.json({ success: true });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ======================
// CHAT PAGE
// ======================
app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// ======================
// START SERVER
// ======================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server avviato`);
  console.log(`📡 API: http://localhost:${PORT}/api/comando`);
  console.log(`💬 Chat: http://localhost:${PORT}/chat`);
});
