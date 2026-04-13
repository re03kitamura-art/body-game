// ============================================================
//  からだでアソボ！ あたまとからだのトレーニング — game.js
// ============================================================

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// --- キーポイント定義（上半身のみ：座位対応）---
const COLLISION_KP = [0, 5, 6, 7, 8, 9, 10]; // 鼻・肩・肘・手首

const SKELETON_PAIRS = [
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
];

// --- 色定義 ---
const COLOR_MAP = {
  'あか':     { bg: '#EE3333', text: '#fff' },
  'あお':     { bg: '#2255EE', text: '#fff' },
  'きいろ':   { bg: '#FFD700', text: '#333' },
  'みどり':   { bg: '#22AA44', text: '#fff' },
  'むらさき': { bg: '#9933CC', text: '#fff' },
  'オレンジ': { bg: '#FF8C00', text: '#fff' },
  'ピンク':   { bg: '#FF69B4', text: '#fff' },
  'みずいろ': { bg: '#33BBEE', text: '#fff' },
};

// --- 形定義（形ごとに色を設定）---
const SHAPE_DEF = {
  'まる':     '#EE4444',
  'さんかく': '#FF8C00',
  'しかく':   '#2266EE',
  'ほし':     '#CCBB00',
  'ひしがた': '#AA33CC',
};
const MATH_BG = '#1a4a8a'; // 計算問題のバブル色

// --- 難易度設定 ---
const DIFFICULTIES = {
  easy: {
    label: 'かんたん',
    bubbleSpeed: 1.0,
    bubbleCount: 2,
    questionTime: 12,
    levelUpInterval: 60,
    colors: ['あか', 'あお', 'きいろ', 'みどり'],
    mathRange: [1, 5],
    mathOps: ['+'],
    shapes: ['まる', 'さんかく', 'しかく'],
  },
  normal: {
    label: 'ふつう',
    bubbleSpeed: 1.8,
    bubbleCount: 3,
    questionTime: 9,
    levelUpInterval: 45,
    colors: ['あか', 'あお', 'きいろ', 'みどり', 'むらさき', 'オレンジ'],
    mathRange: [1, 10],
    mathOps: ['+', '-'],
    shapes: ['まる', 'さんかく', 'しかく', 'ほし'],
  },
  hard: {
    label: 'むずかしい',
    bubbleSpeed: 2.8,
    bubbleCount: 4,
    questionTime: 7,
    levelUpInterval: 30,
    colors: Object.keys(COLOR_MAP),
    mathRange: [1, 20],
    mathOps: ['+', '-', '×'],
    shapes: Object.keys(SHAPE_DEF),
  },
};

// --- グローバル状態 ---
let detector = null, video = null, canvas, ctx;
let gameState = 'start';
let animFrame = null;
let currentDifficulty = 'normal';
let currentMode = 'mix'; // math | color | shape | mix
let diffConfig = { ...DIFFICULTIES.normal };

let score = 0, lives = 3, level = 1;
let levelTimer = 0;
let highScores = JSON.parse(localStorage.getItem('cogGameHS3') || '{"easy":0,"normal":0,"hard":0}');

let bubbles = [];
let particles = [];
let lastKeypoints = [];
let hitCooldown = 0;
let paused = false;

let currentQuestion = null;
let questionTimer = 0;
let questionTimeLimit = 0;
let questionTransitioning = false;

// --- Web Audio ---
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
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.start(); osc.stop(ac.currentTime + dur);
  } catch (_) {}
}
function playCorrect() { playBeep(880, 0.08); setTimeout(() => playBeep(1320, 0.12), 80); }
function playWrong()   { playBeep(180, 0.3, 'sawtooth'); }
function playTimeout() { playBeep(300, 0.2, 'triangle'); }
function playLevelUp() {
  playBeep(523, 0.1);
  setTimeout(() => playBeep(659, 0.1), 100);
  setTimeout(() => playBeep(784, 0.15), 200);
}

// --- ユーティリティ ---
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// --- 問題生成 ---
function generateQuestion() {
  if (currentMode === 'math')  return generateMathQuestion();
  if (currentMode === 'color') return generateColorQuestion();
  if (currentMode === 'shape') return generateShapeQuestion();
  // mix：ランダムに選ぶ
  const types = ['math', 'color', 'shape'];
  const t = types[Math.floor(Math.random() * types.length)];
  if (t === 'math')  return generateMathQuestion();
  if (t === 'color') return generateColorQuestion();
  return generateShapeQuestion();
}

function generateColorQuestion() {
  const colors = diffConfig.colors;
  const correct = colors[Math.floor(Math.random() * colors.length)];
  const wrongPool = shuffle(colors.filter(c => c !== correct));
  const wrongs = wrongPool.slice(0, diffConfig.bubbleCount - 1);

  const answers = [
    { label: correct, bgColor: COLOR_MAP[correct].bg, textColor: COLOR_MAP[correct].text, correct: true },
  ];
  wrongs.forEach(c => {
    answers.push({ label: c, bgColor: COLOR_MAP[c].bg, textColor: COLOR_MAP[c].text, correct: false });
  });
  shuffle(answers);
  return { type: 'color', question: `「${correct}」はどれ？`, answers };
}

function generateMathQuestion() {
  const [min, max] = diffConfig.mathRange;
  const op = diffConfig.mathOps[Math.floor(Math.random() * diffConfig.mathOps.length)];
  let a, b, answer, questionText;

  if (op === '+') {
    a = randInt(min, max); b = randInt(min, max);
    answer = a + b;
    questionText = `${a} ＋ ${b} ＝ ?`;
  } else if (op === '-') {
    a = randInt(min + 1, max); b = randInt(0, a);
    answer = a - b;
    questionText = `${a} － ${b} ＝ ?`;
  } else {
    a = randInt(1, Math.min(max, 9)); b = randInt(1, Math.min(max, 9));
    answer = a * b;
    questionText = `${a} × ${b} ＝ ?`;
  }

  const seen = new Set([answer]);
  const wrongs = [];
  for (let t = 0; t < 200 && wrongs.length < diffConfig.bubbleCount - 1; t++) {
    const delta = randInt(1, Math.max(4, Math.ceil(Math.abs(answer) * 0.5) + 2));
    const w = Math.random() < 0.5 ? answer + delta : Math.max(0, answer - delta);
    if (!seen.has(w)) { seen.add(w); wrongs.push(w); }
  }
  while (wrongs.length < diffConfig.bubbleCount - 1) {
    const w = answer + wrongs.length + 1;
    if (!seen.has(w)) { seen.add(w); wrongs.push(w); }
  }

  // 正解・不正解すべて同じ色
  const answers = [
    { label: String(answer), bgColor: MATH_BG, textColor: '#fff', correct: true },
  ];
  wrongs.forEach(w => {
    answers.push({ label: String(w), bgColor: MATH_BG, textColor: '#fff', correct: false });
  });
  shuffle(answers);
  return { type: 'math', question: questionText, answers };
}

function generateShapeQuestion() {
  const shapes = diffConfig.shapes;
  const correct = shapes[Math.floor(Math.random() * shapes.length)];
  const wrongPool = shuffle(shapes.filter(s => s !== correct));
  const wrongs = wrongPool.slice(0, diffConfig.bubbleCount - 1);

  const answers = [
    { label: '', bgColor: SHAPE_DEF[correct], textColor: '#fff', shapeType: correct, correct: true },
  ];
  wrongs.forEach(s => {
    answers.push({ label: '', bgColor: SHAPE_DEF[s], textColor: '#fff', shapeType: s, correct: false });
  });
  shuffle(answers);
  return { type: 'shape', question: `「${correct}」はどれ？`, answers };
}

// --- バブルスポーン ---
function spawnBubbles(question) {
  bubbles = [];
  questionTimer = 0;
  questionTimeLimit = diffConfig.questionTime * 60;

  const count = question.answers.length;
  const r = Math.max(55, canvas.width * 0.09);
  const padding = r + 10;
  const usableW = canvas.width - padding * 2;

  const xPositions = [];
  for (let i = 0; i < count; i++) {
    const base = padding + (usableW / count) * (i + 0.5);
    const jitter = (Math.random() - 0.5) * (usableW / count * 0.3);
    xPositions.push(Math.max(padding, Math.min(canvas.width - padding, base + jitter)));
  }

  question.answers.forEach((ans, i) => {
    bubbles.push({
      x: xPositions[i],
      y: -r - i * r * 0.6,
      size: r,
      speed: diffConfig.bubbleSpeed + Math.random() * 0.5,
      ...ans,
      hit: false,
    });
  });
}

// --- 衝突判定 ---
function checkBubbleCollision(bubble) {
  if (!lastKeypoints || lastKeypoints.length === 0) return false;

  // 通常キーポイントの判定
  for (const idx of COLLISION_KP) {
    const kp = lastKeypoints[idx];
    if (!kp || kp.score < 0.3) continue;
    const p = scaleKP(kp);
    const dx = p.x - bubble.x, dy = p.y - bubble.y;
    if (Math.sqrt(dx * dx + dy * dy) < bubble.size * 0.9) return true;
  }

  // 手先の仮想ポイント判定（肘→手首の方向に1.4倍延長）
  // 左腕: 肘=7, 手首=9 / 右腕: 肘=8, 手首=10
  const armPairs = [[7, 9], [8, 10]];
  for (const [elbowIdx, wristIdx] of armPairs) {
    const elbow = lastKeypoints[elbowIdx];
    const wrist = lastKeypoints[wristIdx];
    if (!elbow || !wrist || elbow.score < 0.3 || wrist.score < 0.3) continue;
    const pe = scaleKP(elbow);
    const pw = scaleKP(wrist);
    // 肘→手首ベクトルを1.4倍延長した先が「手先」
    const handX = pw.x + (pw.x - pe.x) * 0.4;
    const handY = pw.y + (pw.y - pe.y) * 0.4;
    const dx = handX - bubble.x, dy = handY - bubble.y;
    if (Math.sqrt(dx * dx + dy * dy) < bubble.size * 0.9) return true;
  }

  return false;
}

// --- モード・難易度ボタン（ページ読み込み時に即登録）---
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    currentMode = btn.dataset.mode;
  });
});
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    currentDifficulty = btn.dataset.diff;
  });
});

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
  } catch (e) {
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
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const aspect = video.videoWidth / video.videoHeight || 4 / 3;
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

// --- UI イベント ---
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
    else if (gameState === 'paused') togglePause();
  }
});

function togglePause() {
  if (gameState !== 'playing' && gameState !== 'paused') return;
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
  document.getElementById('questionBox').classList.add('hidden');
  bubbles = []; particles = [];
  currentQuestion = null;
  questionTransitioning = false;
  playBeep(300, 0.15, 'triangle');
}

function startCountdown() {
  diffConfig = { ...DIFFICULTIES[currentDifficulty] };
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
  levelTimer = 0;
  bubbles = []; particles = [];
  hitCooldown = 0;
  currentQuestion = null;
  questionTransitioning = false;
  updateHUD();
}

function startGame() {
  gameState = 'playing';
  nextQuestion();
}

function nextQuestion() {
  questionTransitioning = false;
  currentQuestion = generateQuestion();
  document.getElementById('questionText').textContent = currentQuestion.question;
  document.getElementById('questionBox').classList.remove('hidden');
  spawnBubbles(currentQuestion);
}

function gameOver() {
  gameState = 'gameover';
  document.getElementById('questionBox').classList.add('hidden');
  const hs = highScores[currentDifficulty];
  if (score > hs) {
    highScores[currentDifficulty] = score;
    localStorage.setItem('cogGameHS3', JSON.stringify(highScores));
  }
  const newHS = highScores[currentDifficulty];
  document.getElementById('finalScore').textContent = `スコア: ${score} てん`;
  document.getElementById('highScoreMsg').textContent =
    score >= newHS && score > 0
      ? `🏆 さいこうきろく: ${newHS} てん！`
      : `さいこうきろく: ${newHS} てん`;
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

  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  if (detector && video.readyState >= 2) {
    try {
      const poses = await detector.estimatePoses(video);
      if (poses.length > 0) lastKeypoints = poses[0].keypoints;
    } catch (_) {}
  }

  drawSkeleton(lastKeypoints);

  if (gameState === 'playing' && !paused) {
    updateGame();
  }

  drawParticles();
}

// --- 骨格描画 ---
function scaleKP(kp) {
  return {
    x: (1 - kp.x / video.videoWidth) * canvas.width,
    y: (kp.y / video.videoHeight) * canvas.height,
  };
}

function drawSkeleton(keypoints) {
  if (!keypoints || keypoints.length === 0) return;
  const MIN_CONF = 0.3;
  ctx.lineWidth = 4; ctx.lineCap = 'round';
  for (const [a, b] of SKELETON_PAIRS) {
    const kpA = keypoints[a], kpB = keypoints[b];
    if (!kpA || !kpB || kpA.score < MIN_CONF || kpB.score < MIN_CONF) continue;
    const pA = scaleKP(kpA), pB = scaleKP(kpB);
    ctx.strokeStyle = 'rgba(0,255,200,0.75)';
    ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.stroke();
  }
  for (const kp of keypoints) {
    if (kp.score < MIN_CONF) continue;
    const p = scaleKP(kp);
    ctx.fillStyle = '#00FFCC';
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
  }

  // 手先の仮想ポイントを描画（肘→手首を延長した先）
  const armPairs = [[7, 9], [8, 10]];
  for (const [elbowIdx, wristIdx] of armPairs) {
    const elbow = keypoints[elbowIdx];
    const wrist = keypoints[wristIdx];
    if (!elbow || !wrist || elbow.score < MIN_CONF || wrist.score < MIN_CONF) continue;
    const pe = scaleKP(elbow);
    const pw = scaleKP(wrist);
    const handX = pw.x + (pw.x - pe.x) * 0.4;
    const handY = pw.y + (pw.y - pe.y) * 0.4;
    // 手首→手先の線
    ctx.strokeStyle = 'rgba(255,220,0,0.75)';
    ctx.beginPath(); ctx.moveTo(pw.x, pw.y); ctx.lineTo(handX, handY); ctx.stroke();
    // 手先の点
    ctx.fillStyle = '#FFD700';
    ctx.beginPath(); ctx.arc(handX, handY, 9, 0, Math.PI * 2); ctx.fill();
  }
}

// --- ゲーム更新 ---
function updateGame() {
  levelTimer++;
  const lvInterval = diffConfig.levelUpInterval * 60;
  if (levelTimer >= lvInterval) {
    levelTimer = 0;
    level++;
    diffConfig.bubbleSpeed = DIFFICULTIES[currentDifficulty].bubbleSpeed + (level - 1) * 0.35;
    diffConfig.questionTime = Math.max(4, DIFFICULTIES[currentDifficulty].questionTime - (level - 1) * 0.5);
    updateHUD();
    playLevelUp();
    spawnLevelUpEffect();
  }

  if (hitCooldown > 0) hitCooldown--;

  let correctHit = false;

  bubbles = bubbles.filter(bubble => {
    if (bubble.hit) return false;
    bubble.y += bubble.speed;
    if (bubble.y - bubble.size > canvas.height) return false;

    if (hitCooldown === 0 && checkBubbleCollision(bubble)) {
      bubble.hit = true;
      if (bubble.correct) {
        correctHit = true;
        score += 10 * level;
        updateHUD();
        playCorrect();
        spawnSparkle(bubble.x, bubble.y);
      } else {
        lives--;
        updateHUD();
        playWrong();
        spawnExplosion(bubble.x, bubble.y, '#CC4444');
        hitCooldown = 25;
        if (lives <= 0) {
          setTimeout(gameOver, 400);
          gameState = 'gameover_anim';
        }
      }
      return false;
    }
    return true;
  });

  if (gameState !== 'playing') return;

  drawTimerBar();
  for (const b of bubbles) drawBubble(b);

  if (correctHit && !questionTransitioning) {
    questionTransitioning = true;
    bubbles = [];
    document.getElementById('questionBox').classList.add('hidden');
    setTimeout(() => {
      if (gameState === 'playing') nextQuestion();
    }, 400);
    return;
  }

  if (questionTransitioning) return;

  if (bubbles.length === 0) {
    lives--;
    updateHUD();
    playTimeout();
    if (lives <= 0) { setTimeout(gameOver, 400); gameState = 'gameover_anim'; return; }
    nextQuestion();
    return;
  }

  questionTimer++;
  if (questionTimer >= questionTimeLimit) {
    bubbles = [];
    lives--;
    updateHUD();
    playTimeout();
    if (lives <= 0) { setTimeout(gameOver, 400); gameState = 'gameover_anim'; return; }
    nextQuestion();
  }

  if (hitCooldown > 0 && hitCooldown % 10 < 5) {
    ctx.fillStyle = 'rgba(255,0,0,0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// --- タイマーバー ---
function drawTimerBar() {
  if (questionTimeLimit === 0) return;
  const progress = Math.max(0, 1 - questionTimer / questionTimeLimit);
  const barH = 12, barY = canvas.height - barH;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, barY, canvas.width, barH);
  ctx.fillStyle = `hsl(${Math.floor(progress * 120)},100%,50%)`;
  ctx.fillRect(0, barY, canvas.width * progress, barH);
}

// --- バブル描画 ---
function drawBubble(bubble) {
  const r = bubble.size;
  ctx.save();
  ctx.translate(bubble.x, bubble.y);

  ctx.shadowColor = bubble.bgColor;
  ctx.shadowBlur = 22;
  ctx.fillStyle = bubble.bgColor;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 4;

  if (bubble.shapeType) {
    // バルーン自体を形に描画
    buildShapePath(ctx, bubble.shapeType, r * 0.88);
    ctx.fill();
    ctx.stroke();
  } else {
    // 通常の円バルーン
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = bubble.textColor || '#fff';
    const fs = Math.max(16, r * 0.62);
    ctx.font = `bold ${fs}px "Arial Rounded MT Bold", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bubble.label, 0, 0);
  }

  ctx.restore();
}

// 形のパスを生成（ctx.translate済みの座標系で描く）
function buildShapePath(ctx, shapeName, r) {
  ctx.beginPath();
  switch (shapeName) {
    case 'まる':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 'さんかく':
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.866, r * 0.5);
      ctx.lineTo(-r * 0.866, r * 0.5);
      ctx.closePath();
      break;
    case 'しかく': {
      const s = r * 0.88;
      ctx.rect(-s, -s, s * 2, s * 2);
      break;
    }
    case 'ほし':
      buildStarPath(ctx, 5, r, r * 0.42);
      break;
    case 'ひしがた':
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.65, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.65, 0);
      ctx.closePath();
      break;
  }
}

function buildStarPath(ctx, spikes, outer, inner) {
  let angle = -Math.PI / 2;
  const step = (Math.PI * 2) / spikes;
  ctx.moveTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
  for (let i = 0; i < spikes; i++) {
    angle += step / 2;
    ctx.lineTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    angle += step / 2;
    ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
  }
  ctx.closePath();
}

// --- パーティクル ---
const PARTICLE_COLORS = ['#FF4444','#FF8C00','#FFD700','#44FF88','#44CCFF','#CC44FF','#FF44AA'];

function spawnExplosion(x, y, color) {
  for (let i = 0; i < 20; i++) {
    const angle = (Math.PI * 2 * i) / 20;
    const speed = 3 + Math.random() * 7;
    particles.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
      life: 1, decay: 0.03+Math.random()*0.02, size: 5+Math.random()*8, color });
  }
}
function spawnSparkle(x, y) {
  for (let i = 0; i < 22; i++) {
    const angle = Math.random()*Math.PI*2, speed = 3+Math.random()*8;
    const color = ['#FFD700','#FF6B6B','#FFF','#FF8C00','#A0FFFF'][Math.floor(Math.random()*5)];
    particles.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed-2,
      life: 1, decay: 0.022+Math.random()*0.02, size: 5+Math.random()*9, color });
  }
}
function spawnLevelUpEffect() {
  for (let i = 0; i < 50; i++) {
    const angle = Math.random()*Math.PI*2, speed = 3+Math.random()*11;
    const color = PARTICLE_COLORS[Math.floor(Math.random()*PARTICLE_COLORS.length)];
    particles.push({ x: canvas.width/2, y: canvas.height/2,
      vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed-5,
      life: 1, decay: 0.013, size: 8+Math.random()*12, color });
  }
}
function drawParticles() {
  particles = particles.filter(p => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.3; p.life -= p.decay;
    if (p.life <= 0) return false;
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size*p.life, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    return true;
  });
}

// --- 起動 ---
init().catch(e => setStatus('起動エラー: ' + e.message));
