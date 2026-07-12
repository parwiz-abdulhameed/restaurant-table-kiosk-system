const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const dbPath = path.join(__dirname, 'data', 'kiosk.db');
const db = new sqlite3.Database(dbPath);

const newPassword = 'yeniSifre123'; // değiştirin
const hashed = bcrypt.hashSync(newPassword, 10);

db.run(`UPDATE users SET password = ? WHERE username = 'admin'`, [hashed], function(err) {
  if (err) console.error(err);
  else console.log(`✅ Admin şifresi "${newPassword}" olarak güncellendi.`);
  db.close();
});