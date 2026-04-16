
CREATE TABLE messaggi (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_sessione INT,
    ruolo ENUM('utente', 'ia') NOT NULL,
    contenuto TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_sessione) REFERENCES sessioni(id)
); 

CREATE TABLE comandi (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_sessione INT,
    tipo_comando VARCHAR(50),
    payload JSON,
    contesto TEXT,
    stato ENUM('in_attesa', 'eseguito', 'errore') DEFAULT 'in_attesa',
    data_creazione TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_esecuzione TIMESTAMP NULL,
    FOREIGN KEY (id_sessione) REFERENCES sessioni(id),
    INDEX idx_stato (stato),
    INDEX idx_data (data_creazione)
);

CREATE TABLE eventi_gioco (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_comando INT,
    descrizione TEXT,
    esito ENUM('successo', 'fallimento'),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_comando) REFERENCES comandi(id),
    INDEX idx_comando (id_comando)
);

CREATE TABLE errori (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_comando INT,
    messaggio TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_comando) REFERENCES comandi(id)
);

