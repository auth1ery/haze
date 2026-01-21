const Database = require('better-sqlite3');
const db = new Database('database.db');

db.exec(`
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

const createUser = db.prepare(`
  INSERT INTO users (user_id, username)
  VALUES (?, ?)
`);

const getUser = db.prepare(`
  SELECT * FROM users WHERE user_id = ?
`);

const updateUsername = db.prepare(`
  UPDATE users SET username = ? WHERE user_id = ?
`);

const updateUserStats = db.prepare(`
  UPDATE users 
  SET wins = ?, losses = ?, elo = ?
  WHERE user_id = ?
`);

const createMatch = db.prepare(`
  INSERT INTO matches (match_id, player1_id, player2_id, start_time)
  VALUES (?, ?, ?, ?)
`);

const getMatch = db.prepare(`
  SELECT * FROM matches WHERE match_id = ?
`);

const updateMatchScore = db.prepare(`
  UPDATE matches 
  SET player1_score = ?, player2_score = ?
  WHERE match_id = ?
`);

const endMatch = db.prepare(`
  UPDATE matches 
  SET winner_id = ?, end_time = ?, state = 'finished'
  WHERE match_id = ?
`);

const getLeaderboard = db.prepare(`
  SELECT user_id, username, wins, losses, elo
  FROM users
  ORDER BY elo DESC
  LIMIT 100
`);

const getUserMatchHistory = db.prepare(`
  SELECT * FROM matches 
  WHERE (player1_id = ? OR player2_id = ?)
  AND state = 'finished'
  ORDER BY end_time DESC
  LIMIT 20
`);

module.exports = {
  createUser: (userId) => {
    const username = `player_${userId.slice(-4)}`;
    return createUser.run(userId, username);
  },
  
  getUser: (userId) => {
    return getUser.get(userId);
  },
  
  updateUsername: (userId, username) => {
    return updateUsername.run(username, userId);
  },
  
  updateUserStats: (userId, wins, losses, elo) => {
    return updateUserStats.run(wins, losses, elo, userId);
  },
  
  createMatch: (matchId, player1Id, player2Id) => {
    return createMatch.run(matchId, player1Id, player2Id, Date.now());
  },
  
  getMatch: (matchId) => {
    return getMatch.get(matchId);
  },
  
  updateMatchScore: (matchId, player1Score, player2Score) => {
    return updateMatchScore.run(player1Score, player2Score, matchId);
  },
  
  endMatch: (matchId, winnerId) => {
    return endMatch.run(winnerId, Date.now(), matchId);
  },
  
  getLeaderboard: () => {
    return getLeaderboard.all();
  },
  
  getUserMatchHistory: (userId) => {
    return getUserMatchHistory.all(userId, userId);
  }
};
