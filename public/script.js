let currentUser = null;
let queueInterval = null;

// Твой рабочий сервер в облаке Render
const API_URL = "https://duel-profile-wasted.onrender.com";

function showToast(text) {
    let toast = document.getElementById('toast');
    toast.innerText = text;
    toast.classList.remove('hidden');
    setTimeout(() => { toast.classList.add('hidden'); }, 3000);
}

// Автозапуск: проверка Яндекс SDK или локального сохранения
window.onload = async function() {
    try {
        if (typeof YaGames !== 'undefined') {
            const ysdk = await YaGames.init();
            const player = await ysdk.getPlayer();
            const yandexId = player.getUniqueID();
            const playerName = player.getName() || "Яндекс Игрок";
            const playerPhoto = player.getPhoto('medium') || "https://i.imgur.com/6VBx3io.png";

            let response = await fetch(`${API_URL}/api/auth-yandex`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yandexId, username: playerName, avatar: playerPhoto })
            });
            let data = await response.json();

            if (data.success) {
                currentUser = data.user;
                initAppSession();
                return;
            }
        }
    } catch (e) {
        console.log("Яндекс SDK недоступен, используем стандартную авторизацию ПК.");
    }

    let saved = localStorage.getItem("db_user");
    if (saved) {
        currentUser = JSON.parse(saved);
        initAppSession();
    }
};

function initAppSession() {
    if (typeof currentUser.inventory === 'string') {
        try { currentUser.inventory = JSON.parse(currentUser.inventory); } catch(e) { currentUser.inventory = []; }
    }
    updateInterface();
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    startChallengesPolling();
}

async function handleAuth() {
    let username = document.getElementById('auth-username').value.trim();
    let password = document.getElementById('auth-password').value.trim();

    if (!username || !password) {
        showToast("⚠️ Заполни все поля!");
        return;
    }

    let response = await fetch(`${API_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    let data = await response.json();

    if (data.success) {
        currentUser = data.user;
        localStorage.setItem("db_user", JSON.stringify(currentUser));
        initAppSession();
        showToast(`👋 С возвращением, ${currentUser.username}!`);
    } else {
        showToast("⚠️ " + data.message);
    }
}

function logout() {
    localStorage.removeItem("db_user");
    currentUser = null;
    if (queueInterval) clearInterval(queueInterval);
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    showToast("Выход из профиля");
}

function updateInterface() {
    document.getElementById('menu-username').innerText = currentUser.username;
    document.getElementById('menu-coins').innerText = currentUser.coins;
    document.getElementById('menu-wins').innerText = currentUser.wins;
    document.getElementById('menu-avatar').src = currentUser.avatar;
    document.getElementById('profile-preview-avatar').src = currentUser.avatar;
    document.getElementById('avatar-url-input').value = currentUser.avatar;
    document.getElementById('profile-bio').value = currentUser.bio || "";
    
    let adminBtn = document.getElementById('admin-menu-btn');
    if (adminBtn) {
        if (currentUser.username.toLowerCase() === 'dev' || currentUser.username.toLowerCase() === 'ya_dev') {
            adminBtn.classList.remove('hidden');
        } else {
            adminBtn.classList.add('hidden');
        }
    }

    renderInventory();
}

function switchTab(tabName, btnElement) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');

    if (btnElement) {
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        btnElement.classList.add('active');
    }

    if (tabName === 'leaderboard') loadLeaderboard();
    if (tabName === 'players') loadPlayersGrid();
    if (tabName === 'challenges') loadChallenges();
}

async function saveProfile() {
    let newAvatar = document.getElementById('avatar-url-input').value.trim() || currentUser.avatar;
    let newBio = document.getElementById('profile-bio').value;

    currentUser.avatar = newAvatar;
    currentUser.bio = newBio;

    await fetch(`${API_URL}/api/profile/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, avatar: newAvatar, bio: newBio })
    });

    localStorage.setItem("db_user", JSON.stringify(currentUser));
    updateInterface();
    showToast("💾 Профиль сохранен!");
}

async function buyShopItem(name, price, rarity) {
    if (currentUser.coins < price) {
        showToast("⚠️ Недостаточно Coins!");
        return;
    }

    let res = await fetch(`${API_URL}/api/shop/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, name, price, rarity })
    });
    let data = await res.json();

    if (data.success) {
        currentUser.coins = data.newCoins;
        currentUser.inventory = data.inventory;
        localStorage.setItem("db_user", JSON.stringify(currentUser));
        updateInterface();
        showToast(`🎁 Успешно куплено: ${name}!`);
    } else {
        showToast("⚠️ " + data.message);
    }
}

async function openCase(cost) {
    if (currentUser.coins < cost) {
        showToast("⚠️ Недостаточно Coins!");
        return;
    }

    let res = await fetch(`${API_URL}/api/cases/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, cost })
    });
    let data = await res.json();

    if (!data.success) {
        showToast("⚠️ " + data.message);
        return;
    }

    currentUser.coins = data.newCoins;
    currentUser.inventory = data.inventory;
    localStorage.setItem("db_user", JSON.stringify(currentUser));
    updateInterface();

    let animBox = document.getElementById('case-animation-box');
    let track = document.getElementById('roulette-track');
    let resultMsg = document.getElementById('case-result-msg');
    
    animBox.classList.remove('hidden');
    resultMsg.innerText = "";
    track.innerHTML = "";

    let pool = [
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

    let itemsHtml = "";
    for (let i = 0; i < 15; i++) {
        let randItem = pool[Math.floor(Math.random() * pool.length)];
        if (i === 10) randItem = data.droppedGift;
        itemsHtml += `<div class="roulette-item ${randItem.rarity}"><span>${randItem.name}</span><br><small>${randItem.price} 💰</small></div>`;
    }
    track.innerHTML = itemsHtml;

    setTimeout(() => { track.scrollTo({ left: 450, behavior: 'smooth' }); }, 100);

    setTimeout(() => {
        resultMsg.innerHTML = `🎉 Выпало: <span style="color: #7289da;">${data.droppedGift.name}</span> (${data.droppedGift.price} Coins)!`;
        showToast(`🎁 Добавлено в профиль!`);
        renderInventory();
    }, 2500);
}

function renderInventory() {
    let grid = document.getElementById('my-inventory-grid');
    if (!grid) return;
    
    let inventory = currentUser.inventory || [];
    if (typeof inventory === 'string') {
        try { inventory = JSON.parse(inventory); } catch(e) { inventory = []; }
    }

    if (inventory.length === 0) {
        grid.innerHTML = `<p class="empty-text">Инвентарь пуст</p>`;
        return;
    }

    grid.innerHTML = "";
    inventory.forEach((item, index) => {
        let priceVal = item.price !== undefined ? item.price : 10;
        let div = document.createElement('div');
        div.className = `inventory-item ${item.rarity || 'common'}`;
        div.innerHTML = `<span><b>${item.name}</b></span><small style="color: #f1c40f;">Цена: ${priceVal} 💰</small><button class="sell-btn" onclick="sellGift(${index})">💸 Продать</button>`;
        grid.appendChild(div);
    });
}

async function sellGift(index) {
    let res = await fetch(`${API_URL}/api/gifts/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, itemIndex: index })
    });
    let data = await res.json();

    if (data.success) {
        currentUser.coins = data.newCoins;
        currentUser.inventory = data.inventory;
        localStorage.setItem("db_user", JSON.stringify(currentUser));
        updateInterface();
        showToast(`💸 Продано за ${data.refund} Coins!`);
    } else {
        showToast("⚠️ " + data.message);
    }
}

async function adminGiveCoins() {
    let target = document.getElementById('admin-target-user').value.trim();
    let amount = parseInt(document.getElementById('admin-coins-amount').value);

    let res = await fetch(`${API_URL}/api/admin/give-coins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUsername: currentUser.username, targetUsername: target, amount })
    });
    let data = await res.json();

    if (data.success) {
        showToast("✅ " + data.message);
        if (target.toLowerCase() === currentUser.username.toLowerCase()) {
            currentUser.coins += amount;
            localStorage.setItem("db_user", JSON.stringify(currentUser));
            updateInterface();
        }
    } else {
        showToast("⚠️ " + data.message);
    }
}

let inQueue = false;
function toggleMatchmaking() {
    let btn = document.getElementById('matchmaking-btn');
    inQueue = !inQueue;

    if (inQueue) {
        btn.innerText = "Отменить поиск...";
        btn.style.background = "#e74c3c";
        showToast("🔍 Поиск соперника...");
        
        queueInterval = setInterval(async () => {
            let res = await fetch(`${API_URL}/api/users`);
            let users = await res.json();
            let opponents = users.filter(u => u.username !== currentUser.username);
            if (opponents.length > 0) {
                let opponent = opponents[Math.floor(Math.random() * opponents.length)];
                clearInterval(queueInterval);
                inQueue = false;
                runServerDuel(currentUser.username, opponent.username);
            }
        }, 2000);
    } else {
        if (queueInterval) clearInterval(queueInterval);
        btn.innerText = "Встать в очередь";
        btn.style.background = "#7289da";
        showToast("❌ Поиск отменен");
    }
}

async function joinRandomDuel() {
    let res = await fetch(`${API_URL}/api/users`);
    let users = await res.json();
    let opponents = users.filter(u => u.username !== currentUser.username);

    if (opponents.length === 0) {
        showToast("⚠️ Нет соперников в базе!");
        return;
    }
    let opponent = opponents[Math.floor(Math.random() * opponents.length)];
    runServerDuel(currentUser.username, opponent.username);
}

async function sendDirectChallenge() {
    let target = document.getElementById('target-username').value.trim();
    if (!target) return showToast("⚠️ Введи ник!");

    let res = await fetch(`${API_URL}/api/challenge/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: currentUser.username, target })
    });
    let data = await res.json();
    if (data.success) showToast(`🎯 Вызов отправлен!`);
    else showToast("⚠️ " + data.message);
}

function startChallengesPolling() {
    setInterval(loadChallenges, 3000);
}

async function loadChallenges() {
    let res = await fetch(`${API_URL}/api/challenges/${currentUser.username}`);
    let challenges = await res.json();

    let container = document.getElementById('challenges-list');
    let badge = document.getElementById('pending-badge');
    if (!container) return;

    if (challenges.length > 0) {
        badge.innerText = challenges.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
        container.innerHTML = `<p class="empty-text">Нет активных вызовов</p>`;
        return;
    }

    container.innerHTML = "";
    challenges.forEach((challenger, index) => {
        let div = document.createElement('div');
        div.className = 'challenge-item';
        div.innerHTML = `
            <span><b>${challenger}</b> вызывает тебя!</span>
            <div class="challenge-actions">
                <button class="btn-accept" onclick="acceptChallenge('${challenger}', ${index})">✔</button>
                <button class="btn-decline" onclick="declineChallenge(${index})">✖</button>
            </div>
        `;
        container.appendChild(div);
    });
}

async function acceptChallenge(challenger, index) {
    let res = await fetch(`${API_URL}/api/challenges/${currentUser.username}`);
    let challenges = await res.json();
    challenges.splice(index, 1);
    await fetch(`${API_URL}/api/challenge/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, challenges })
    });
    runServerDuel(challenger, currentUser.username);
}

async function declineChallenge(index) {
    let res = await fetch(`${API_URL}/api/challenges/${currentUser.username}`);
    let challenges = await res.json();
    challenges.splice(index, 1);
    await fetch(`${API_URL}/api/challenge/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, challenges })
    });
    loadChallenges();
}

async function runServerDuel(p1Name, p2Name) {
    document.getElementById('active-arena').classList.remove('hidden');
    
    let res = await fetch(`${API_URL}/api/users`);
    let users = await res.json();
    let u1 = users.find(u => u.username === p1Name) || { username: p1Name, avatar: 'https://i.imgur.com/6VBx3io.png' };
    let u2 = users.find(u => u.username === p2Name) || { username: p2Name, avatar: 'https://i.imgur.com/6VBx3io.png' };

    document.getElementById('f1-img').src = u1.avatar;
    document.getElementById('f2-img').src = u2.avatar;
    document.getElementById('f1-name').innerText = u1.username;
    document.getElementById('f2-name').innerText = u2.username;
    document.getElementById('duel-result-text').innerText = "🔍 Расчет силы бойцов...";

    let fightRes = await fetch(`${API_URL}/api/duel/fight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p1: p1Name, p2: p2Name })
    });
    let fightData = await fightRes.json();

    setTimeout(() => {
        document.getElementById('f1-score').innerText = `Сила: ${fightData.score1}`;
        document.getElementById('f2-score').innerText = `Сила: ${fightData.score2}`;

        if (fightData.winner === p1Name) {
            document.getElementById('fighter-2').classList.add('wasted-fighter');
            document.getElementById('f2-wasted').classList.remove('hidden');
        } else {
            document.getElementById('fighter-1').classList.add('wasted-fighter');
            document.getElementById('f1-wasted').classList.remove('hidden');
        }

        document.getElementById('duel-result-text').innerText = `🎉 Победитель: ${fightData.winner}!`;

        if (fightData.winner === currentUser.username) {
            currentUser.coins = fightData.winnerNewStats.coins;
            currentUser.wins = fightData.winnerNewStats.wins;
            localStorage.setItem("db_user", JSON.stringify(currentUser));
            updateInterface();
            showToast("🎉 Победа! +10 Coins!");
        } else {
            fetch(`${API_URL}/api/users`).then(r => r.json()).then(allUsers => {
                let me = allUsers.find(u => u.username === currentUser.username);
                if (me) {
                    currentUser.coins = me.coins;
                    currentUser.wins = me.wins;
                    localStorage.setItem("db_user", JSON.stringify(currentUser));
                    updateInterface();
                }
            });
            showToast("💀 Поражение...");
        }
    }, 1500);
}

async function loadLeaderboard() {
    let res = await fetch(`${API_URL}/api/users`);
    let users = await res.json();
    let tbody = document.getElementById('leaderboard-tbody');
    if (!tbody) return;
    tbody.innerHTML = "";

    users.forEach((u, index) => {
        let tr = document.createElement('tr');
        tr.onclick = () => viewProfile(u);
        tr.innerHTML = `<td><b>#${index + 1}</b></td><td>${u.username} 🔍</td><td>🏆 ${u.wins}</td><td>💰 ${u.coins}</td>`;
        tbody.appendChild(tr);
    });
}

async function loadPlayersGrid() {
    let res = await fetch(`${API_URL}/api/users`);
    let users = await res.json();
    let grid = document.getElementById('all-players-grid');
    if (!grid) return;
    grid.innerHTML = "";

    users.forEach(u => {
        let gridCard = document.createElement('div');
        gridCard.className = 'player-card';
        gridCard.onclick = () => viewProfile(u);
        gridCard.innerHTML = `<img src="${u.avatar}"><div><h4>${u.username}</h4><p>🏆 ${u.wins} | 💰 ${u.coins}</p></div>`;
        grid.appendChild(gridCard);
    });
}

function viewProfile(user) {
    document.getElementById('view-avatar').src = user.avatar;
    document.getElementById('view-username').innerText = user.username;
    document.getElementById('view-wins').innerText = user.wins;
    document.getElementById('view-coins').innerText = user.coins;
    document.getElementById('view-bio').innerText = user.bio || "Нет описания";
    
    let invGrid = document.getElementById('view-inventory-grid');
    invGrid.innerHTML = "";
    let inventory = user.inventory || [];
    if (typeof inventory === 'string') { try { inventory = JSON.parse(inventory); } catch(e) { inventory = []; } }

    if (inventory.length === 0) {
        invGrid.innerHTML = `<p class="empty-text">Инвентарь пуст</p>`;
    } else {
        inventory.forEach(item => {
            let priceVal = item.price !== undefined ? item.price : 10;
            let div = document.createElement('div');
            div.className = `inventory-item ${item.rarity || 'common'}`;
            div.innerHTML = `<span><b>${item.name}</b></span><small>${priceVal} 💰</small>`;
            invGrid.appendChild(div);
        });
    }

    switchTab('user-profile', null);
}
