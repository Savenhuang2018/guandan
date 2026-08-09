/* ===== 出牌语音播报 =====
 * 优先走 Android 原生 TTS(通过 JS bridge: window.AndroidTTS)
 * 浏览器/无 bridge 时回退 speechSynthesis
 * 说明: WebView 里 speechSynthesis 常年不可靠(需 Google TTS + 用户手势),
 *       所以原生 bridge 是主路径,回退只为桌面浏览器调试
 */
const VOICE = {
  on: true,
  native: false,          // 是否有原生 bridge
  ready: false,           // speechSynthesis 是否可用
  lastText: '',
  lastAt: 0,
  pending: {},            // id -> 等待该句说完的回调
  lastId: 0               // 最近一次 speakTracked 返回的 id
};

/* 语音说完的最长等待(ms)。
 * 兜底存在的理由: TTS 引擎可能不回调 onDone(被系统杀、引擎异常),
 * 若无超时游戏会永久卡住不再出牌。宁可早出也不能死锁。
 */
const VOICE_WAIT_MAX = 2200;

function voiceInit() {
  VOICE.native = !!(window.AndroidTTS && window.AndroidTTS.speak);
  if (!VOICE.native && 'speechSynthesis' in window) {
    VOICE.ready = true;
    // 预热: 部分浏览器首次 getVoices 为空
    try { window.speechSynthesis.getVoices(); } catch (e) {}
  }
  return VOICE.native ? 'native' : (VOICE.ready ? 'web' : 'none');
}

/* 原生侧播报完成回调(Java 的 UtteranceProgressListener → 这里) */
function voiceDone(id, interrupted) {
  const cb = VOICE.pending[id];
  if (!cb) return;
  delete VOICE.pending[id];
  cb(!!interrupted);
}

/* 说完这句后执行 cb。
 * 无论走原生/web/静音/失败, cb 都保证被调用恰好一次(超时兜底)。
 */
function voiceSayThen(text, cb) {
  const once = (function () {
    let done = false;
    return function () { if (!done) { done = true; cb && cb(); } };
  })();

  if (!VOICE.on || !text) { once(); return false; }

  // 原生: 用 speakTracked 拿 id, 等 onDone
  if (VOICE.native && window.AndroidTTS.speakTracked) {
    let id = -1;
    try { id = window.AndroidTTS.speakTracked(text); } catch (e) { id = -1; }
    if (id > 0) {
      VOICE.lastId = id;
      VOICE.pending[id] = once;
      setTimeout(function () {          // 兜底: 回调丢失也不卡死
        if (VOICE.pending[id]) { delete VOICE.pending[id]; once(); }
      }, VOICE_WAIT_MAX);
      return true;
    }
    // id<=0: 未就绪, 退回普通播报 + 估时
  }

  const spoke = voiceSay(text);
  // web/回退路径无完成事件, 按字数估时(中文约 190ms/字, 封顶)
  const est = spoke ? Math.min(VOICE_WAIT_MAX, 320 + text.length * 190) : 0;
  setTimeout(once, est);
  return spoke;
}

function voiceSay(text) {
  if (!VOICE.on || !text) return false;
  // 200ms 内相同文本去重(避免 refresh 重复触发)
  const now = Date.now();
  if (text === VOICE.lastText && now - VOICE.lastAt < 200) return false;
  VOICE.lastText = text; VOICE.lastAt = now;

  if (VOICE.native) {
    try { window.AndroidTTS.speak(text); return true; } catch (e) {}
  }
  if (VOICE.ready) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1.15;
      window.speechSynthesis.cancel();   // 打断上一句,保证跟得上出牌节奏
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) {}
  }
  return false;
}

/* 牌型 → 播报词
 * 炸弹类加强语气; 单张/对子播具体点数更像真人报牌
 */
function voiceTextForPlay(e, cards, level) {
  if (!e) return '';
  const nm = typeName(e);
  if (e.type === 'bomb') {
    if (e.flush) return '同花顺';
    if (e.bombLv === 100) return '四王炸';
    return nm;                            // 4炸/5炸/6炸...
  }
  // 单张/对子: 带点数,如"一对7" "单张A"
  if (cards && cards.length && (e.type === 'single' || e.type === 'pair')) {
    const r = rankLabel(cards, level);
    if (r) return e.type === 'pair' ? ('一对' + r) : r;
  }
  return nm;
}

/* 取这手牌的代表点数(排除逢人配) */
function rankLabel(cards, level) {
  const real = cards.filter(c => !isWild(c, level));
  const src = real.length ? real : cards;
  const c = src[0];
  if (!c) return '';
  if (c.r === 'JB') return '小王';
  if (c.r === 'JR') return '大王';
  const MAP = { 'A': 'A', 'K': 'K', 'Q': 'Q', 'J': 'J', '10': '10' };
  return MAP[c.r] || c.r;
}

/* 出牌播报入口 */
function voicePlay(e, cards, level) {
  const t = voiceTextForPlay(e, cards, level);
  if (t) voiceSay(t);
  return t;
}

/* 出牌播报 + 说完回调(供 AI 等上家把话说完) */
function voicePlayThen(e, cards, level, cb) {
  const t = voiceTextForPlay(e, cards, level);
  if (!t) { cb && cb(); return ''; }
  voiceSayThen(t, cb);
  return t;
}

/* 过牌播报 */
function voicePass() {
  voiceSay('不要');
  return '不要';
}

/* 过牌播报 + 说完回调 */
function voicePassThen(cb) {
  voiceSayThen('不要', cb);
  return '不要';
}
