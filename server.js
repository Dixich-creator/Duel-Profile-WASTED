const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Ошибка БД:', err.message);
    else console.log('📦 База данных SQLite успешно подключена.');
});

db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT,
    avatar TEXT,
    bio TEXT,
    coins INTEGER DEFAULT 100,
    wins INTEGER DEFAULT 0,
    inventory TEXT,
    challenges TEXT
)`);

// 1. Обычная авторизация / Регистрация
app.post('/api/auth', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: 'Заполни все поля!' });

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (user) {
            if (user.password !== password) return res.json({ success: false, message: 'Неверный пароль!' });
            user.inventory = JSON.parse(user.inventory || '[]');
            user.challenges = JSON.parse(user.challenges || '[]');
            res.json({ success: true, user });
        } else {
            const defaultAvatar = 'https://i.imgur.com/6VBx3io.png';
            db.run(`INSERT INTO users (username, password, avatar, bio, coins, wins, inventory, challenges) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [username, password, defaultAvatar, 'Привет, я в игре!', 100, 0, '[]', '[]'], (err) => {
                    if (err) return res.json({ success: false, message: 'Ошибка создания аккаунта' });
                    res.json({
                        success: true,
                        user: { username, password, avatar: defaultAvatar, bio: 'Привет, я в игре!', coins: 100, wins: 0, inventory: [], challenges: [] }
                    });
                });
        }
    });
});

// 2. Авторизация через Яндекс Игры SDK (авто-вход по ID игрока)
app.post('/api/auth-yandex', (req, res) => {
    const { yandexId, username, avatar } = req.body;
    const userId = `ya_${yandexId}`;

    db.get(`SELECT * FROM users WHERE username = ?`, [userId], (err, user) => {
        if (user) {
            user.inventory = JSON.parse(user.inventory || '[]');
            user.challenges = JSON.parse(user.challenges || '[]');
            res.json({ success: true, user });
        } else {
            const defaultBio = 'Игрок Яндекс Игр';
            db.run(`INSERT INTO users (username, password, avatar, bio, coins, wins, inventory, challenges) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, 'yandex_secure', avatar, defaultBio, 150, 0, '[]', '[]'], (err) => {
                    if (err) return res.json({ success: false, message: 'Ошибка создания профиля' });
                    res.json({
                        success: true,
                        user: { username: userId, displayName: username, avatar, bio: defaultBio, coins: 150, wins: 0, inventory: [], challenges: [] }
                    });
                });
        }
    });
});

// Обновление профиля
app.post('/api/profile/update', (req, res) => {
    const { username, avatar, bio } = req.body;
    db.run(`UPDATE users SET avatar = ?, bio = ? WHERE username = ?`, [avatar, bio, username], (err) => {
        if (err) return res.json({ success: false });
        res.json({ success: true });
    });
});

// Список всех пользователей (для таблицы лидеров и базы игроков)
app.get('/api/users', (req, res) => {
    db.all(`SELECT username, avatar, bio, coins, wins, inventory FROM users ORDER BY wins DESC`, [], (err, rows) => {
        if (err) return res.json([]);
        rows.forEach(r => {
            let inv = JSON.parse(r.inventory || '[]');
            inv.forEach(item => { if (item.price === undefined) item.price = 10; });
            r.inventory = inv;
        });
        res.json(rows);
    });
});

// Система прямых вызовов
app.post('/api/challenge/send', (req, res) => {
    const { from, target } = req.body;
    db.get(`SELECT * FROM users WHERE LOWER(username) = LOWER(?)`, [target.trim()], (err, targetUser) => {
        if (err || !targetUser) return res.json({ success: false, message: 'Игрок не найден!' });

        let challenges = JSON.parse(targetUser.challenges || '[]');
        if (!challenges.includes(from)) challenges.push(from);

        db.run(`UPDATE users SET challenges = ? WHERE username = ?`, [JSON.stringify(challenges), targetUser.username], (err) => {
            if (err) return res.json({ success: false });
            res.json({ success: true, exactTarget: targetUser.username });
        });
    });
});

app.get('/api/challenges/:username', (req, res) => {
    db.get(`SELECT challenges FROM users WHERE username = ?`, [req.params.username], (err, row) => {
        if (!row) return res.json([]);
        res.json(JSON.parse(row.challenges || '[]'));
    });
});

app.post('/api/challenge/clear', (req, res) => {
    const { username, challenges } = req.body;
    db.run(`UPDATE users SET challenges = ? WHERE username = ?`, [JSON.stringify(challenges), username], (err) => {
        res.json({ success: !err });
    });
});

// Расчет дуэли на сервере
app.post('/api/duel/fight', (req, res) => {
    const { p1, p2 } = req.body;

    db.all(`SELECT * FROM users WHERE username IN (?, ?)`, [p1, p2], (err, rows) => {
        if (err || rows.length < 2) return res.json({ success: false, message: 'Ошибка участников дуэли' });

        let user1 = rows.find(r => r.username === p1);
        let user2 = rows.find(r => r.username === p2);

        function calculatePower(user) {
            let inv = JSON.parse(user.inventory || '[]');
            let invValue = inv.reduce((sum, item) => sum + (item.price || 10), 0);
            return (user.wins * 15) + (user.coins * 0.2) + (invValue * 0.1) + Math.floor(Math.random() * 30);
        }

        let score1 = Math.floor(calculatePower(user1));
        let score2 = Math.floor(calculatePower(user2));

        let winner = score1 >= score2 ? user1 : user2;
        let loser = score1 >= score2 ? user2 : user1;

        db.run(`UPDATE users SET coins = coins + 10, wins = wins + 1 WHERE username = ?`, [winner.username], (err) => {
            if (err) return res.json({ success: false, message: 'Ошибка записи результатов' });

            db.get(`SELECT * FROM users WHERE username = ?`, [winner.username], (err, updatedWinner) => {
                res.json({
                    success: true,
                    score1,
                    score2,
                    winner: winner.username,
                    loser: loser.username,
                    winnerNewStats: {
                        coins: updatedWinner.coins,
                        wins: updatedWinner.wins
                    }
                });
            });
        });
    });
});

// Кейсы (0 - 10000 Звёзд)
app.post('/api/cases/open', (req, res) => {
    const { username, cost } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (!user || user.coins < cost) {
            return res.json({ success: false, message: 'Недостаточно монет!' });
        }

        const possibleDrops = [
            { name: '🎟️ Купон', rarity: 'common', price: 5 },
            { name: '🌹 Роза', rarity: 'common', price: 15 },
            { name: '☕ Кофе', rarity: 'common', price: 50 },
            { name: '⭐ Звезда', rarity: 'rare', price: 150 },
            { name: '🎮 Геймпад', rarity: 'rare', price: 350 },
            { name: '💎 Бриллиант', rarity: 'epic', price: 1000 },
            { name: '👑 Корона', rarity: 'epic', price: 3500 },
            { name: '🚀 Ракета', rarity: 'legendary', price: 7500 },
            { name: '🌌 Яхта', rarity: 'legendary', price: 10000 }
        ];

        const droppedGift = possibleDrops[Math.floor(Math.random() * possibleDrops.length)];

        let inventory = JSON.parse(user.inventory || '[]');
        inventory.push(droppedGift);
        let newCoins = user.coins - cost;

        db.run(`UPDATE users SET coins = ?, inventory = ? WHERE username = ?`, [newCoins, JSON.stringify(inventory), username], (err) => {
            if (err) return res.json({ success: false, message: 'Ошибка базы данных' });
            res.json({ success: true, droppedGift, newCoins, inventory });
        });
    });
});

// Магазин
app.post('/api/shop/buy', (req, res) => {
    const { username, name, price, rarity } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (!user || user.coins < price) {
            return res.json({ success: false, message: 'Недостаточно монет!' });
        }

        let inventory = JSON.parse(user.inventory || '[]');
        inventory.push({ name, price, rarity });
        let newCoins = user.coins - price;

        db.run(`UPDATE users SET coins = ?, inventory = ? WHERE username = ?`, [newCoins, JSON.stringify(inventory), username], (err) => {
            if (err) return res.json({ success: false, message: 'Ошибка сервера' });
            res.json({ success: true, newCoins, inventory });
        });
    });
});

// Продажа подарков
app.post('/api/gifts/sell', (req, res) => {
    const { username, itemIndex } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (!user) return res.json({ success: false, message: 'Игрок не найден' });

        let inventory = JSON.parse(user.inventory || '[]');
        if (itemIndex < 0 || itemIndex >= inventory.length) {
            return res.json({ success: false, message: 'Предмет не найден' });
        }

        let soldItem = inventory.splice(itemIndex, 1)[0];
        let refund = soldItem.price !== undefined ? soldItem.price : 10;
        let newCoins = user.coins + refund;

        db.run(`UPDATE users SET coins = ?, inventory = ? WHERE username = ?`, [newCoins, JSON.stringify(inventory), username], (err) => {
            if (err) return res.json({ success: false, message: 'Ошибка сервера' });
            res.json({ success: true, newCoins, inventory, refund, soldItem });
        });
    });
});

// Админ-панель Dev
app.post('/api/admin/give-coins', (req, res) => {
    const { adminUsername, targetUsername, amount } = req.body;

    if (!adminUsername || adminUsername.toLowerCase() !== 'dev') {
        return res.json({ success: false, message: 'Доступ запрещен!' });
    }

    db.get(`SELECT * FROM users WHERE LOWER(username) = LOWER(?)`, [targetUsername.trim()], (err, targetUser) => {
        if (err || !targetUser) return res.json({ success: false, message: 'Игрок не найден!' });

        let newCoins = targetUser.coins + parseInt(amount);
        db.run(`UPDATE users SET coins = ? WHERE username = ?`, [newCoins, targetUser.username], (err) => {
            res.json({ success: true, message: `Выдано ${amount} Coins игроку ${targetUser.username}!` });
        });
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});