const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const matchmakingQueue = new Map();
const activeMatches = new Map();
const connections = new Map();

app.post('/api/user/register', async (req, res) => {
  const userId = 'ARNG-' + Math.random().toString(36).substr(2, 8).toUpperCase();
  
  try {
    db.createUser(userId);
    const user = db.getUser(userId);
    res.json({ userId, user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.get('/api/user/:userId', (req, res) => {
  try {
    const user = db.getUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.post('/api/user/:userId/username', (req, res) => {
  const { username } = req.body;
  
  try {
    db.updateUsername(req.params.userId, username);
    const user = db.getUser(req.params.userId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update username' });
  }
});

app.post('/api/matchmaking/join', (req, res) => {
  const { userId, opponentId } = req.body;
  
  try {
    const user = db.getUser(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const opponentQueue = matchmakingQueue.get(opponentId);
    
    if (opponentQueue && opponentQueue.opponentId === userId) {
      const matchId = Date.now().toString();
      
      const match = {
        player1: userId,
        player2: opponentId,
        player1Score: 0,
        player2Score: 0,
        startTime: Date.now(),
        endTime: Date.now() + 120000,
        state: 'active'
      };
      
      activeMatches.set(matchId, match);
      db.createMatch(matchId, userId, opponentId);
      
      matchmakingQueue.delete(userId);
      matchmakingQueue.delete(opponentId);
      
      notifyPlayer(userId, { type: 'match_found', matchId, opponent: opponentId });
      notifyPlayer(opponentId, { type: 'match_found', matchId, opponent: userId });
      
      res.json({ matched: true, matchId });
    } else {
      matchmakingQueue.set(userId, { opponentId, status: 'waiting' });
      res.json({ matched: false, waiting: true });
    }
  } catch (error) {
    res.status(500).json({ error: 'Matchmaking failed' });
  }
});

app.post('/api/matchmaking/cancel', (req, res) => {
  const { userId } = req.body;
  matchmakingQueue.delete(userId);
  res.json({ success: true });
});

app.post('/api/match/:matchId/roll', (req, res) => {
  const { matchId } = req.params;
  const { userId, rarityDenom } = req.body;
  
  const match = activeMatches.get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  
  if (match.state !== 'active') {
    return res.status(400).json({ error: 'Match is not active' });
  }
  
  if (match.player1 === userId) {
    match.player1Score = Math.max(match.player1Score, rarityDenom);
  } else if (match.player2 === userId) {
    match.player2Score = Math.max(match.player2Score, rarityDenom);
  }
  
  db.updateMatchScore(matchId, match.player1Score, match.player2Score);
  
  const opponentId = match.player1 === userId ? match.player2 : match.player1;
  notifyPlayer(opponentId, {
    type: 'opponent_roll',
    score: rarityDenom
  });
  
  res.json({ success: true });
});

app.get('/api/match/:matchId', (req, res) => {
  const match = activeMatches.get(req.params.matchId);
  if (!match) {
    try {
      const dbMatch = db.getMatch(req.params.matchId);
      if (!dbMatch) return res.status(404).json({ error: 'Match not found' });
      return res.json(dbMatch);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch match' });
    }
  }
  
  if (Date.now() >= match.endTime && match.state === 'active') {
    finishMatch(req.params.matchId);
  }
  
  res.json(match);
});

function finishMatch(matchId) {
  const match = activeMatches.get(matchId);
  if (!match || match.state !== 'active') return;
  
  match.state = 'finished';
  
  const player1 = db.getUser(match.player1);
  const player2 = db.getUser(match.player2);
  
  let winner = null;
  
  if (match.player1Score > match.player2Score) {
    winner = match.player1;
    player1.wins++;
    player2.losses++;
  } else if (match.player2Score > match.player1Score) {
    winner = match.player2;
    player2.wins++;
    player1.losses++;
  } else {
    match.winner = 'draw';
  }
  
  if (winner) {
    match.winner = winner;
    
    const winnerUser = winner === match.player1 ? player1 : player2;
    const loserUser = winner === match.player1 ? player2 : player1;
    
    const expectedWin = 1 / (1 + Math.pow(10, (loserUser.elo - winnerUser.elo) / 400));
    const K = 32;
    
    winnerUser.elo += Math.round(K * (1 - expectedWin));
    loserUser.elo -= Math.round(K * expectedWin);
  }
  
  db.updateUserStats(player1.user_id, player1.wins, player1.losses, player1.elo);
  db.updateUserStats(player2.user_id, player2.wins, player2.losses, player2.elo);
  db.endMatch(matchId, winner || 'draw');
  
  notifyPlayer(match.player1, { type: 'match_end', match });
  notifyPlayer(match.player2, { type: 'match_end', match });
}

app.get('/api/leaderboard', (req, res) => {
  try {
    const leaderboard = db.getLeaderboard().map(user => ({
      userId: user.user_id,
      username: user.username,
      wins: user.wins,
      losses: user.losses,
      elo: user.elo,
      winrate: user.wins + user.losses > 0 
        ? ((user.wins / (user.wins + user.losses)) * 100).toFixed(1)
        : 0
    }));
    
    res.json(leaderboard);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

app.get('/api/user/:userId/history', (req, res) => {
  try {
    const history = db.getUserMatchHistory(req.params.userId);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch match history' });
  }
});

wss.on('connection', (ws) => {
  let userId = null;
  
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    
    if (data.type === 'register') {
      userId = data.userId;
      connections.set(userId, ws);
      ws.send(JSON.stringify({ type: 'registered', userId }));
    }
  });
  
  ws.on('close', () => {
    if (userId) {
      connections.delete(userId);
      matchmakingQueue.delete(userId);
    }
  });
});

function notifyPlayer(userId, data) {
  const ws = connections.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [matchId, match] of activeMatches.entries()) {
    if (match.state === 'active' && now >= match.endTime) {
      finishMatch(matchId);
    }
  }
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
