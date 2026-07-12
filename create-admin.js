const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'kiosk.db');
const db = new sqlite3.Database(dbPath);

const username = 'admin';
const password = 'admin123';

bcrypt.hash(password, 10, (err, hash) => {
  if (err) throw err;
  db.run(`INSERT OR REPLACE INTO users (username, password, email) VALUES (?, ?, ?)`, 
    [username, hash, 'admin@chefistanbul.com'], 
    function(err) {
      if (err) console.error(err);
      else console.log(` Admin kullanıcısı eklendi/güncellendi: ${username} / ${password}`);
      db.close();
    });
});