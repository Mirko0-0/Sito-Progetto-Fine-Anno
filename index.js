const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const GEMINI_API_KEY = '';
const MODEL = 'gemini-3-flash-preview';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

// Configurazione database
const dbConfig = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'test'
};

async function saveMessageToDB(role, content) {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const query = 'INSERT INTO messaggi (ruolo, contenuto) VALUES (?, ?)';
    await connection.execute(query, [role === 'utente' ? 'utente' : 'ia', content]);
  } catch (error) {
    console.error('Errore nel salvataggio del messaggio:', error);
  } finally {
    if (connection) await connection.end();
  }
}

async function saveCommandToDB(commandText) {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const query = 'INSERT INTO comandi (tipo_comando, stato) VALUES (?, ?)';
    const [result] = await connection.execute(query, [commandText, 'in_attesa']);
    
    console.log('Comando salvato con ID:', result.insertId);
    return result.insertId;
  } catch (error) {
    console.error('Errore nel salvataggio del comando:', error);
    throw error;
  } finally {
    if (connection) await connection.end();
  }
}

async function sendMessageToGemini(message, instructions) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const requestBody = {
    system_instruction: {
      parts: [
        {
          text: instructions
        }
      ]
    },
    contents: [
      {
        parts: [
          {
            text: message
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Error: ${response.status} - ${JSON.stringify(data)}`);
    }

    return data;
  } catch (error) {
    console.error('Errore nella richiesta:', error);
    throw error;
  }
}

function extractCommand(text) {
  const pattern = /\$\^\{\{!(.*?)!\}\}\^\$/;
  const match = text.match(pattern);

  if (match && match[1]) {
    return match[1];
  }

  return null;
}

function removeCommand(text) {
  if (!text) return text;
  const pattern = /\$\^\{\{!(.*?)!\}\}\^\$/g;
  let result = text.replace(pattern, '');
  result = result.replace(/\s{2,}/g, ' ').trim();
  return result;
}

// ============================================
// API REST ENDPOINTS
// ============================================

// GET /api/comando - Ottiene il comando più vecchio non eseguito
app.get('/api/comando', async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    
    const [rows] = await connection.execute(
      'SELECT id, tipo_comando FROM comandi WHERE stato = "in_attesa" ORDER BY data_creazione ASC LIMIT 1'
    );
    
    if (rows.length === 0) {
      return res.json({ success: false, message: 'Nessun comando in attesa' });
    }
    
    const comando = rows[0];
    
    // Segna come eseguito
    await connection.execute(
      'UPDATE comandi SET stato = "eseguito", data_esecuzione = NOW() WHERE id = ?',
      [comando.id]
    );
    
    console.log(`Comando inviato a Roblox: ${comando.tipo_comando}`);
    
    return res.json({
      success: true,
      comando: comando.tipo_comando
    });
    
  } catch (error) {
    console.error('Errore nell\'API:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// POST /api/chat - Invia messaggio all'AI
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ success: false, error: 'Messaggio mancante' });
    }

    // Salva il messaggio dell'utente
    await saveMessageToDB('utente', message);

    const instructions = "per accendere le luci alla fine del testo scrivi senza spazi $^{{!on.IDLUCE!}}^$ devi lo stesso rispondere come faresti sempre ma mettendo il comando alla fine. se non è chiesto di accendere niente tu non fare il comando";
    
    const result = await sendMessageToGemini(message, instructions);
    
    if (result.candidates && result.candidates[0]) {
      const text = result.candidates[0].content.parts[0].text;
      const comando = extractCommand(text);
      
      // Rimuovi il comando dalla risposta per salvarla nel DB e inviarla all'utente
      const responseText = removeCommand(text);

      // Salva la risposta dell'AI
      await saveMessageToDB('ia', responseText);
      
      // Salva il comando se presente
      if (comando !== null) {
        await saveCommandToDB(comando);
        console.log('Comando estratto e salvato:', comando);
      }
      
      return res.json({
        success: true,
        response: responseText,
        hasCommand: comando !== null
      });
    } else {
      return res.status(500).json({ success: false, error: 'Nessuna risposta dall\'AI' });
    }
    
  } catch (error) {
    console.error('Errore nella chat:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Rotta per la pagina chat
app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Avvia il server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server avviato!`);
  console.log(`📡 API REST: http://localhost:${PORT}/api/comando`);
  console.log(`💬 Chat UI: http://localhost:${PORT}/chat`);
  console.log(`\n🌐 Da Roblox usa: http://TUO_IP_LOCALE:${PORT}/api/comando`);
});