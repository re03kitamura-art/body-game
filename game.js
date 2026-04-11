// ============================================================
//  からだでアソボ！ — game.js
// ============================================================

// --- TensorFlow.js + MoveNet を CDN から動的ロード ---
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// --- 定数 ---
const KEYPOINT_NAMES = [
  'nose','left_eye','right_eye','left_ear','right_ear',
  'left_shoulder','right_shoulder','left_elbow','right_elbow',
  'left_wrist','right_wrist','left_hip','right_hip',
  'left_knee','right_knee','left_ankle','right_ankle'
];
// 衝突に使うキーポイントのインデックス
const COLLISION_KP = [0,5,6,9,10,11,12,15,16]; // nose, shoulders, wrists, hips, ankles

const SKELETON_PAIRS = [
  [5,6],[5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]
];

const PARTICLE_COLORS = [
  '#FF4444','#FF8C00','#FFD700','#44FF88','#44CCFF','#CC44FF','#FF44AA'
];

// --- グローバル状態 ---
let detector = null;
let video = null;
let canvas, ctx;
let gameState = 'start'; // start | countdown | playing | gameover
let animFrame = null;

let score = 0;
let lives = 3;
let level = 1;
let levelTimer = 0;
let highScore = parseInt(localStorage.getItem('bodyGameHS') || '0');

let obstacles = [];
let particles = [];
let spawnTimer = 0;
let spawnInterval = 120; // フレーム数
let obstacleSpeed = 4;

let lastKeypoints = [];
let hitCooldown = 0; // 無敵時間
let paused = false;

// Web Audio
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playBeep(freq, dur, type = 'square') {
  try {
    const ac = getAudio();
    if (ac.state === 'suspended') ac.resume();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.start(); osc.stop(ac.currentTime + dur);
  } catch(_) {}
}
function playGet()    { playBeep(880, 0.08); setTimeout(() => playBeep(1320, 0.1), 80); }  // りんごゲット
function playHit()   { playBeep(120, 0.3, 'sawtooth'); }                                   // うんちに当たった
function playMiss()  { playBeep(300, 0.15, 'triangle'); }                                  // りんご逃した
function playLevelUp(){ playBeep(523,0.1); setTimeout(()=>playBeep(659,0.1),100); setTimeout(()=>playBeep(784,0.15),200); }

// --- 初期化 ---
async function init() {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');
  setStatus('TensorFlow.js を読み込み中...');

  try {
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js');
    setStatus('ポーズ検出モデルを読み込み中...');
    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
    setStatus('カメラを起動中...');
    await startCamera();
    setStatus('');
    document.getElementById('startBtn').disabled = false;
  } catch(e) {
    setStatus('エラー: ' + e.message);
    console.error(e);
  }
}

async function startCamera() {
  video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const aspect = video.videoWidth / video.videoHeight || 4/3;
  if (vw / vh > aspect) {
    canvas.width  = Math.round(vh * aspect);
    canvas.height = vh;
  } else {
    canvas.width  = vw;
    canvas.height = Math.round(vw / aspect);
  }
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

// --- ゲーム開始フロー ---
document.getElementById('startBtn').disabled = true;
document.getElementById('startBtn').addEventListener('click', startCountdown);
document.getElementById('retryBtn').addEventListener('click', startCountdown);

document.getElementById('pauseBtn').addEventListener('click', togglePause);
document.getElementById('resumeBtn').addEventListener('click', togglePause);
document.getElementById('stopBtn').addEventListener('click', goToTitle);
document.getElementById('quitBtn').addEventListener('click', goToTitle);

document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'Escape') {
    if (gameState === 'playing') togglePause();
    else if (paused) togglePause();
  }
});

function togglePause() {
  if (gameState !== 'playing' && !paused) return;
  paused = !paused;
  const pauseScreen = document.getElementById('pauseScreen');
  const pauseBtn = document.getElementById('pauseBtn');
  if (paused) {
    gameState = 'paused';
    pauseScreen.style.display = 'block';
    pauseBtn.textContent = '▶';
    playBeep(440, 0.1);
  } else {
    gameState = 'playing';
    pauseScreen.style.display = 'none';
    pauseBtn.textContent = '⏸';
    playBeep(880, 0.1);
  }
}

function goToTitle() {
  paused = false;
  gameState = 'start';
  document.getElementById('pauseScreen').style.display = 'none';
  document.getElementById('pauseBtn').textContent = '⏸';
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
  obstacles = []; particles = [];
  playBeep(300, 0.15, 'triangle');
}

function startCountdown() {
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('gameOverScreen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  gameState = 'countdown';
  resetGame();

  const cdEl = document.getElementById('countdown');
  cdEl.style.display = 'block';
  let count = 3;
  cdEl.textContent = count;
  playBeep(440, 0.2);

  const iv = setInterval(() => {
    count--;
    if (count > 0) {
      cdEl.textContent = count;
      playBeep(440, 0.2);
    } else {
      clearInterval(iv);
      cdEl.textContent = 'GO!';
      playBeep(880, 0.3);
      setTimeout(() => { cdEl.style.display = 'none'; startGame(); }, 600);
    }
  }, 1000);

  if (!animFrame) loop();
}

function resetGame() {
  score = 0; lives = 3; level = 1;
  levelTimer = 0; spawnTimer = 0;
  spawnInterval = 120; obstacleSpeed = 4;
  obstacles = []; particles = [];
  hitCooldown = 0;
  updateHUD();
}

function startGame() {
  gameState = 'playing';
}

function gameOver() {
  gameState = 'gameover';
  playHit();
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('bodyGameHS', highScore);
  }
  document.getElementById('finalScore').textContent = `スコア: ${score} てん`;
  document.getElementById('highScoreMsg').textContent =
    score >= highScore ? `🏆 さいこうきろく: ${highScore} てん！` : `さいこうきろく: ${highScore} てん`;
  document.getElementById('gameOverScreen').classList.remove('hidden');
}

function updateHUD() {
  document.getElementById('lives').textContent = lives;
  document.getElementById('score').textContent = score;
  document.getElementById('level').textContent = level;
}

// --- メインループ ---
async function loop() {
  animFrame = requestAnimationFrame(loop);

  // カメラ映像を左右反転して描画
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  // ポーズ推定
  if (detector && video.readyState >= 2) {
    try {
      const poses = await detector.estimatePoses(video);
      if (poses.length > 0) {
        lastKeypoints = poses[0].keypoints;
      }
    } catch(_) {}
  }

  // 骨格描画
  drawSkeleton(lastKeypoints);

  if (gameState === 'playing' && !paused) {
    updateGame();
  }

  // パーティクル描画（常に）
  drawParticles();
}

// --- 骨格描画 ---
function scaleKP(kp) {
  // カメラ座標 → canvas座標（左右反転済み）
  const sx = (1 - kp.x / video.videoWidth)  * canvas.width;
  const sy = (kp.y / video.videoHeight) * canvas.height;
  return { x: sx, y: sy };
}

function drawSkeleton(keypoints) {
  if (!keypoints || keypoints.length === 0) return;
  const MIN_CONF = 0.3;

  ctx.lineWidth = 4;
  ctx.lineCap = 'round';

  // 骨格ライン
  for (const [a, b] of SKELETON_PAIRS) {
    const kpA = keypoints[a], kpB = keypoints[b];
    if (kpA.score < MIN_CONF || kpB.score < MIN_CONF) continue;
    const pA = scaleKP(kpA), pB = scaleKP(kpB);
    ctx.strokeStyle = 'rgba(0, 255, 200, 0.7)';
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.stroke();
  }

  // キーポイント円
  for (const kp of keypoints) {
    if (kp.score < MIN_CONF) continue;
    const p = scaleKP(kp);
    ctx.fillStyle = '#00FFCC';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- ゲーム更新 ---
function updateGame() {
  // レベルアップ（30秒ごと）
  levelTimer++;
  if (levelTimer >= 1800) {
    levelTimer = 0;
    level++;
    obstacleSpeed += 1.2;
    spawnInterval = Math.max(40, spawnInterval - 15);
    updateHUD();
    playLevelUp();
    spawnLevelUpEffect();
  }

  // 障害物スポーン
  spawnTimer++;
  if (spawnTimer >= spawnInterval) {
    spawnTimer = 0;
    spawnObstacle();
  }

  // 無敵時間
  if (hitCooldown > 0) hitCooldown--;

  // アイテム更新
  obstacles = obstacles.filter(ob => {
    ob.y += ob.speed;
    ob.rot += ob.rotSpeed;

    if (ob.type === 'apple') {
      // りんご：触れたらスコア、画面外に出たらミス
      if (checkCollision(ob)) {
        score += 10;
        updateHUD();
        playGet();
        spawnSparkle(ob.x, ob.y);
        return false;
      }
      if (ob.y - ob.size > canvas.height) {
        playMiss();
        return false;
      }
    } else {
      // うんち：触れたらライフ減、画面外に出てもOK
      if (ob.y - ob.size > canvas.height) return false;
      if (hitCooldown === 0 && checkCollision(ob)) {
        lives--;
        updateHUD();
        playHit();
        spawnExplosion(ob.x, ob.y, '#8B4513');
        hitCooldown = 60;
        if (lives <= 0) {
          setTimeout(gameOver, 400);
          gameState = 'gameover_anim';
        }
        return false;
      }
    }

    return true;
  });

  // アイテム描画
  for (const ob of obstacles) drawObstacle(ob);

  // 無敵中は画面フラッシュ
  if (hitCooldown > 0 && hitCooldown % 10 < 5) {
    ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function spawnObstacle() {
  const size = canvas.width * (0.06 + Math.random() * 0.07);
  const x = size + Math.random() * (canvas.width - size * 2);
  // りんご70%、うんち30%
  const type = Math.random() < 0.7 ? 'apple' : 'poop';
  obstacles.push({
    x, y: -size, size,
    speed: obstacleSpeed + Math.random() * 2,
    type,
    rot: 0,
    rotSpeed: (Math.random() - 0.5) * 0.06
  });
}

function checkCollision(ob) {
  if (!lastKeypoints || lastKeypoints.length === 0) return false;
  for (const idx of COLLISION_KP) {
    const kp = lastKeypoints[idx];
    if (!kp || kp.score < 0.3) continue;
    const p = scaleKP(kp);
    const dx = p.x - ob.x, dy = p.y - ob.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < ob.size * 0.85) return true;
  }
  return false;
}

// --- 描画ヘルパー ---
function drawObstacle(ob) {
  ctx.save();
  ctx.translate(ob.x, ob.y);
  ctx.rotate(ob.rot);

  const emoji = ob.type === 'apple' ? '🍎' : '💩';
  const fontSize = Math.round(ob.size * 1.8);
  ctx.font = `${fontSize}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 影でポップに
  ctx.shadowColor = ob.type === 'apple' ? 'rgba(255,80,80,0.6)' : 'rgba(100,50,0,0.5)';
  ctx.shadowBlur = 16;
  ctx.fillText(emoji, 0, 0);

  ctx.restore();
}

// --- パーティクル ---
function spawnExplosion(x, y, color) {
  for (let i = 0; i < 24; i++) {
    const angle = (Math.PI * 2 * i) / 24;
    const speed = 4 + Math.random() * 8;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1, decay: 0.03 + Math.random() * 0.02,
      size: 6 + Math.random() * 10,
      color
    });
  }
}

// りんごゲット時のキラキラ
function spawnSparkle(x, y) {
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 7;
    const color = ['#FFD700','#FF6B6B','#FFF','#FF8C00'][Math.floor(Math.random()*4)];
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      life: 1, decay: 0.025 + Math.random() * 0.02,
      size: 5 + Math.random() * 8,
      color
    });
  }
}

function spawnLevelUpEffect() {
  for (let i = 0; i < 40; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 10;
    const color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
    particles.push({
      x: canvas.width / 2, y: canvas.height / 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 5,
      life: 1, decay: 0.015,
      size: 8 + Math.random() * 12,
      color
    });
  }
}

function drawParticles() {
  particles = particles.filter(p => {
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.3; // 重力
    p.life -= p.decay;
    if (p.life <= 0) return false;

    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return true;
  });
}

// --- 起動 ---
init().catch(e => setStatus('起動エラー: ' + e.message));
