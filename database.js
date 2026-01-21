const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'database.db');
let db = null;

async function initDatabase() {
  const SQL = await initSqlJs();
  
  try {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } catch (err) {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT DEFAULT 'player',
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      elo INTEGER DEFAULT 1000,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS matches (
      match_id TEXT PRIMARY KEY,
      player1_id TEXT NOT NULL,
      player2_id TEXT NOT NULL,
      player1_score INTEGER DEFAULT 0,
      player2_score INTEGER DEFAULT 0,
      winner_id TEXT,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      state TEXT DEFAULT 'active',
      FOREIGN KEY (player1_id) REFERENCES users(user_id),
      FOREIGN KEY (player2_id) REFERENCES users(user_id),
      FOREIGN KEY (winner_id) REFERENCES users(user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_matches_state ON matches(state);
    CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(player1_id, player2_id);
    CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
  `);

  saveDatabase();
}

function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

setInterval(saveDatabase, 30000);

function run(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
}

function get(sql, params = []) {
  const results = db.exec(sql, params);
  if (results.length === 0) return null;
  
  const columns = results[0].columns;
  const values = results[0].values[0];
  
  if (!values) return null;
  
  const row = {};
  columns.forEach((col, i) => {
    row[col] = values[i];
  });
  return row;
}

function all(sql, params = []) {
  const results = db.exec(sql, params);
  if (results.length === 0) return [];
  
  const columns = results[0].columns;
  const values = results[0].values;
  
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

module.exports = {
  init: initDatabase,
  
  createUser: (userId) => {
    const username = `player_${userId.slice(-4)}`;
    run(
      'INSERT INTO users (user_id, username) VALUES (?, ?)',
      [userId, username]
    );
  },
  
  getUser: (userId) => {
    return get(
      'SELECT * FROM users WHERE user_id = ?',
      [userId]
    );
  },
  
  updateUsername: (userId, username) => {
    run(
      'UPDATE users SET username = ? WHERE user_id = ?',
      [username, userId]
    );
  },
  
  updateUserStats: (userId, wins, losses, elo) => {
    run(
      'UPDATE users SET wins = ?, losses = ?, elo = ? WHERE user_id = ?',
      [wins, losses, elo, userId]
    );
  },
  
  createMatch: (matchId, player1Id, player2Id) => {
    run(
      'INSERT INTO matches (match_id, player1_id, player2_id, start_time) VALUES (?, ?, ?, ?)',
      [matchId, player1Id, player2Id, Date.now()]
    );
  },
  
  getMatch: (matchId) => {
    return get(
      'SELECT * FROM matches WHERE match_id = ?',
      [matchId]
    );
  },
  
  updateMatchScore: (matchId, player1Score, player2Score) => {
    run(
      'UPDATE matches SET player1_score = ?, player2_score = ? WHERE match_id = ?',
      [player1Score, player2Score, matchId]
    );
  },
  
  endMatch: (matchId, winnerId) => {
    run(
      'UPDATE matches SET winner_id = ?, end_time = ?, state = ? WHERE match_id = ?',
      [winnerId, Date.now(), 'finished', matchId]
    );
  },
  
  getLeaderboard: () => {
    return all(
      'SELECT user_id, username, wins, losses, elo FROM users ORDER BY elo DESC LIMIT 100',
      []
    );
  },
  
  getUserMatchHistory: (userId) => {
    return all(
      'SELECT * FROM matches WHERE (player1_id = ? OR player2_id = ?) AND state = ? ORDER BY end_time DESC LIMIT 20',
      [userId, userId, 'finished']
    );
  }
};
