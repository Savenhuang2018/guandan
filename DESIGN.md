# 掼蛋单机版 · 设计与优化文档

记录每个优化点的**动因、方案、验证方式**。分三类：✅ 已实现并验证、🔨 待实现（已定方案）、💭 待定。

坐标约定：座位 `0=我(下) 1=右家 2=对家(上) 3=左家`，队伍 `0&2` vs `1&3`。
DOM key 映射 `SEAT_KEY = ['S','E','N','W']`。

---

## 一、交互与布局

### ✅ 1.1 手牌竖向堆叠分列

**动因**：横向错位排列时实测有 7–9 张牌点不到——后一张覆盖了前一张的可点区域。

**方案**：按点数分组，同点数竖向堆成一列（`.hcol`）。列内靠下的牌 `z-index` 更高，露出自己的顶部点数区。列间距 `gap` 按可用宽度反算，装不下时用 `colOverlap` 叠压，**不用 `transform:scale()` 整体缩放**（会把牌压成 28×39 的不可读尺寸）。

**验证**：`elementFromPoint` 遍历每张牌中心点，不可点数量 9 → 0。

### ✅ 1.2 选中列展开 + 灰罩

**动因**：选中态原本用 `translateY(-24px)` 上移，竖堆下会与相邻列重叠。

**方案**：选中牌不位移（`#hand .card.sel{transform:none}`），改为整列均匀拉开间距（`expandStep()` 按该列张数反算，短列空间更大），并叠加 `::after` 灰罩 + 金边。

### ✅ 1.3 滑动连选

**方案**：`pointerdown` 记起始牌并定 `mode`（起始牌未选中 → 本次为选中模式），`pointermove` 沿途 `apply`。滑动期间**只改 class 不重渲染**，否则手指下的 DOM 会被替换掉导致 `elementFromPoint` 失效。松手才 `renderHand()`。

**坑**：`moved >= 6` 才算滑动，并置 `__suppressClick` 抑制随后的 click，否则 `toggleSel` 会把刚选的牌再翻转一次。不绑 `pointerleave`——手指滑出手牌区边缘会误判为结束。

### ✅ 1.4 四家出牌分方位显示

**动因**：所有人的牌都堆在中央，看不出谁出的，且遮挡中央提示区。

**方案**：`#zN/#zW/#zE/#zS` 四个 `.playzone` 贴各自座位显示，只显示当前一手 `G.lastPlay`。

**坑**：横屏 844×390 下对家出牌区会压住座位——座位块底边 147px 已低于中央提示区。必须**先在横屏媒体查询里压缩座位**（头像 46→30→26px）才腾出空间。

### ✅ 1.5 名次标记持久化（头游/二游/三游/末游）

**动因**：名次原本只有一个 420ms 后弹出的 toast，一闪而过，看不到当前局势。

**方案**：新增状态 `G.rankOf = [0,0,0,0]`（0=未出完，1~4=名次），出完牌时写入，`renderRankTag()` 渲染到座位旁。金色渐变区别于「不要」的暗红；头游加微光 `.first`，末游用灰调 `.last` 避免与头游混淆。

**生命周期**：`doPlay` 写入 → 持续显示 → `deal()` 清空。即「显示到下一局开始」。

**坑**：局终只剩一家时，那家**不经过 `doPlay`**，末游名次不会写入。必须在 `advance()` 的局终分支里补 `G.rankOf[last] = G.finished.length`，并追加一次 `refresh()` 让标记立刻显示。

**验证**（Node 逻辑层，绕开 DOM）：
```
s3_after_seat1: [2,3,1,4]   ← 座位3的末游(4)由 advance 补上
t5_persist:  反复 refresh 标记不丢
t6_after_clear: deal 后全部清空
```

### ✅ 1.6 左右家避开摄像头挖孔

**动因**：横屏时手机摄像头挖孔转到屏幕侧边，压住左家座位。

**根因**：`#seatW{left:24px}` 是固定值，完全没考虑安全区。

**方案**：改用安全区变量，挖孔宽度正是 `env(safe-area-inset-left)`：
```css
#seatW{left:calc(24px + var(--sa-left))}
#seatE{right:calc(24px + var(--sa-right))}
```
出牌区 `#zW/#zE` 同样处理。无挖孔机型上变量为 0，自动退化回原值。

**坑**：矮屏档 `@media (max-height:400px)` 里也有一份固定值，**必须一起改**，否则窄屏机型会覆盖掉上面的修复。

**验证**：`RANKTEST` 探针输出 `seatW_clearsCamera` / `seatE_clearsCamera` 布尔断言 + 实际 `getBoundingClientRect()` 数值。

### ✅ 1.7 HUD 移到左上角

**动因**：信息条原本 `left:50%` 居中在顶部，横屏时正对摄像头挖孔，且压在对家出牌区的视线通道上。

**方案**：改为左上角对齐，并计入安全区：
```css
#hud{top:calc(10px + var(--sa-top));left:calc(14px + var(--sa-left));
     flex-wrap:wrap;max-width:calc(100% - 28px - var(--sa-left) - var(--sa-right))}
```
级牌 / 我方 / 对方 / 局数 / 声音按钮全部归入其中。两档横屏媒体查询里同步 `left`。

**实测**（915×412，`--sa-left=49px`）：HUD 位于 `l=57,t=6`，正好避开 49px 挖孔；与 `zN`/`zW`/`seatW`/`seatN` 四者均不重叠；声音按钮 `elementFromPoint` 命中自身，可点。

### ✅ 1.8 倒计时并入出牌区

**动因**：倒计时原先是 `#hud` 里的一枚 chip，在屏幕顶部，而玩家视线焦点在底部手牌区——读秒要来回扫视。且非我回合时常驻显示「--」，是无效信息。

**方案**：从 `#hud` 中移出，成为独立的 `.turntimer`，定位贴手牌区上沿；用 `.on` 类控制显隐，**仅在计时期间显示**（`startTurnTimer` 加、`clearTurnTimer` 去）。

**坑 1**：`#zS`、`#pS`、`#rS` 三者都居中于同一个 `bottom:214px`，倒计时若也居中会四者叠在一起。改为靠右 `right:calc(16px + var(--sa-right))`。

**坑 2**：`.urgent` 的 `animation` 里若写 `transform:scale()`，会覆盖基础定位的 `translateX(-50%)` 导致元素跳位。改用右对齐定位后，关键帧里只留 `scale()` 即安全。

**实测**：倒计时 `b=202`，手牌区 `t=208` —— 间距 6px，紧贴上沿；与 `zS`/`pS`/`rS`/`bar`/`hand` 五者均不重叠，不溢出屏幕；非我回合隐藏、起表显示、停表隐藏三态正确。

**探针断言写法的教训**：最初用 `timer.t > vh*0.45`（「在下半屏」）判断位置，实测 `t=182` vs 阈值 185，差 3px 判为失败——**阈值型断言太脆**。改为判断与 `#hand` 的实际间距（`gapToHand`）后才既准确又表达了真实意图。同理，「初始应隐藏」的断言也是错的：`TAP` 开局后计时已启动，应改判「非我回合时隐藏」。

### 🔨 1.9 操作按钮移到牌型区上方 + 按需显示

**动因**：`不要 / 提示 / 出牌` 常驻底部，非我回合时也占着位置且可点（虽然 disabled），干扰视觉。

**方案**：
- 把三个按钮从底部 `#bar` 移到牌型显示区上方，成为独立容器（拟 `#actbar`）
- **仅在 `G.running && G.turn === 0`（轮到我出牌）时显示**，其余时刻整条隐藏
- `理牌 / 记牌` 属于随时可用的辅助功能，**保留在原 `#bar`**，不参与显隐

细则：
- `不要` 仍受 `!G.lastPlay` 约束（我领出时不能过牌）
- `出牌` 仍受 `G.sel.size === 0` 约束
- 隐藏用 `display:none` 而非 `visibility`，避免占位
- 显隐切换点在 `updateBar()`，它已被 `refresh()` 调用，无需另加钩子

**注意**：`#bar` 里现有 5 个按钮，`开始` 不在其中（在 `#mask` 对话框里），可安全拆分。

### 🔨 1.8 选中的牌锁定到左侧独立一列

**动因**：手动选牌后，选中的牌散落在各自点数列里，看不清「我这一手到底选了什么」。

**方案**：`renderHand()` 分组前先把 `G.sel` 中的牌抽出，作为**最左侧一个独立列**渲染，剩余牌按点数正常分列。选中列加 `.locked` 样式（金边）以示区别。

**待确认的边界**：
- 选中列内部排序：按点数小→大
- 与 1.9 的「按话分列」如何共存——理牌后点选某列，该列应整体移到左侧
- 滑动连选跨列时，`apply()` 只改 class 不重渲染，所以拖动过程中牌不会跳动；松手 `renderHand()` 时才归拢到左侧。这个行为是想要的（拖动中乱跳会很难用）

---

## 二、自动理牌

### ✅ 2.1 最少出牌次数拆分

**算法**（`arrange.js`）：
1. `arrangeCandidates()` 枚举全部候选牌型：同点数的单/对/三/炸、三带二、顺子、同花顺、连对、钢板，以及逢人配补足成对/三/炸的变体
2. `arrangeHand()` DFS 搜最少手数，配三重剪枝：
   - **锚点法**：只考虑「包含剩余牌中某一固定张」的组合，避免重复搜索同一集合
   - **下界剪枝**：`picked.length + ceil(remain/6) >= best.length` 时放弃
   - **预算限制**：`budget=24000` 步、每层 `branch=14` 分支，防卡死
3. 候选排序：大组合优先（减手数），同长度时炸弹排后面（尽量保留不拆）
4. 兜底：搜索超预算则贪心一遍，剩余按单张出

**输出顺序**：小的先出，炸弹留最后。

### 🔨 2.2 按「话」分列显示

**动因**：理牌算出的拆分方案，目前只是把同一手的牌排到相邻位置，视觉上仍按点数分列，看不出「哪几张是一手」。

**方案**：理牌后切换渲染模式——**一列 = 一手能出的牌（一句话）**，不再按点数分列。

- 顺子、三带二、连对、钢板、炸弹，每一手各自独立成列
- 列间用更大间距 + 分隔感，明确「这是不同的话」
- 每列按点数**从小到大**排列
- **三带二例外：三张放在下方**（露出主牌，一眼看出是三带二而非杂牌）

**实现要点**：
- `G.plan` 已存有拆分结果（`mySort()` 里赋值），渲染时优先按 `G.plan` 分列
- 需要一个模式标志（拟 `G.planView`），手动选牌或新发牌后退回按点数分列
- 列内排序函数需按 `e.type` 分支：`fullhouse` 时三张在下，其余小→大
- 每列可加牌型名标签（如「三带二」「顺子」），进一步降低认知成本

**待确认**：一手 5~6 张的顺子竖堆后列高会不小，横屏 390px 高度下是否需要压缩 `upStep`。

---

## 三、语音播报

### ✅ 3.1 原生 TTS 而非 speechSynthesis

**动因**：WebView 里的 `speechSynthesis` 在 Android 上不可靠——依赖 Google TTS 且常需用户手势激活。

**方案**：原生 `TextToSpeech` 通过 JS bridge 暴露，H5 侧优先用它、回退到 `speechSynthesis`（保证浏览器调试可用）：
```
voicePlay/voicePass → voiceSay → window.AndroidTTS.speak → 原生 TextToSpeech
                              ↘ speechSynthesis（浏览器回退）
```

**三个必要条件**（缺一不响）：
1. **manifest 声明包可见性**，否则 targetSdk 30+ 查不到 TTS 引擎，`setLanguage` 返回 `LANG_NOT_SUPPORTED`：
   ```xml
   <queries><intent><action android:name="android.intent.action.TTS_SERVICE"/></intent></queries>
   ```
2. **TTS 初始化是异步的**，`onInit` 成功后要回调 `evaluateJavascript("voiceInit()")` 让 H5 重新探测，否则首句丢失
3. **用 `QUEUE_FLUSH`** 打断上一句以跟上出牌节奏，`QUEUE_ADD` 会积压

`onDestroy` 里 `stop() + shutdown()` 清理，否则退出后引擎泄漏。

### ✅ 3.2 播报文案（真人报牌风格）

| 情形 | 播报 |
|---|---|
| 单张 | 点数（「A」） |
| 对子 | 「一对7」 |
| 炸弹 | 直报「4炸」「5炸」「同花顺」「四王炸」 |
| 其余 | 牌型名（「三带二」「顺子」） |
| 过牌 | 「不要」 |

HUD 右上角喇叭图标切换静音（`VOICE.on`）。

---

## 四、节奏控制

### ✅ 4.1 出牌限时

首出（领出）**20 秒**，跟牌 **10 秒**。仅人类座位计时（AI 不需要），超时自动出最右列 / 不要。局终 `advance()` 里 `clearTurnTimer()` 停表。

**验证**：探针输出 `leadLimit:20, turnLimit:10`。

### ✅ 4.3 局终条件

两个独立的结束条件，满足任一即刻结束：

1. **出现三游** —— 只剩 1 家没出完，剩下那家为末游
2. **同一队包揽头游+二游（双下）** —— 立刻结束，**不必打到三游**

```js
const dd = G.finished.length >= 2 && teamOf(G.finished[0]) === teamOf(G.finished[1]);
if (activeCount() <= 1 || dd) { ...封盘... }
```

**坑**：双下提前结束时 `G.finished` 只有 2 家，但 `doTribute()` 要按 `order[2]`/`order[3]` 取三游末游，缺项会读到 `undefined` 导致下一局崩溃。必须把未出完的家按**当前手牌数**（少的排前面）补进 `finished` 并写 `rankOf`，保证恒为 4 家。

**验证**（Node 状态机层，`setTimeout` 改同步执行以便断言 `endRound`）：

| 场景 | 结果 |
|---|---|
| A 双下（0与2同队） | 座位0出完 `running:true` 继续 → 座位2出完立刻 `ending:true`；`finished=[0,2,1,3]`、`rankOf=[1,3,2,4]`；判「双下·升3级」`usLevel=5` |
| B 非双下（0头游、对手1二游） | `running:true`，正确地未提前结束 |
| C 三游出现 | 立即结束，剩余家为末游，`finished=[0,1,2,3]` |
| D 双下后进贡数据 | `lastOrder` 4 家全为数字，`doTribute` 不会崩 |

### ✅ 4.4 局终原子封盘

**动因**：快速连点可能在 `endRound` 的 700ms 定时器期间再次触发动作。

**方案**：`G.ending` 防重入标志 + 立刻 `G.running=false` 封盘，不等定时器。

### ✅ 4.5 接风

领出者已出完牌且其余各家都不要 → 牌权归其队友自由领出（队友无牌则退回下一个活人）。

---

## 五、信息屏蔽

### ✅ 5.1 对手牌数按需显示

只在 `n > 0 && n < 10` 时显示张数——快走完了才提示，平时不暴露信息量。

### ✅ 5.2 记牌器

统计每个点数剩余张数 = 总数 8 张 − 已出 − 我手上。两副牌，每点数 8 张（4 花色 × 2 副），大小王各 2 张。

---

## 六、工程实践

### ✅ 6.1 资源版本号

**改动任何 JS/CSS 后必须递增 `index.html` 里的 `?v=N`**。曾因缓存连续两轮测试读到旧值，误判成代码没生效。当前 `v=17`。

### ✅ 6.2 广播探针验证

`MainActivity` 注册多个广播接收器，通过 `evaluateJavascript` 从 WebView 内部 dump **量化数据**到 logcat，比截图肉眼判断可靠得多。

```bash
adb shell am broadcast -a com.aiden.guandan.PROBE      # 布局几何
adb shell am broadcast -a com.aiden.guandan.VOICE      # 语音链路
adb shell am broadcast -a com.aiden.guandan.RANKTEST   # 名次标记 + 摄像头避让
adb logcat -d | grep GuandanWV
```

**三条铁律**：
1. **探针必须驱动真实业务函数**（`doPlay`/`doPass`），而非纯函数。只测 `voiceTextForPlay()` 能证明文案对，但证明不了它在对局中会被触发。
2. **Java bridge 注入的方法不可 hook**。覆盖 `window.AndroidTTS.speak` 会**静默失败**（`addJavascriptInterface` 注入的方法属性不可写，赋值无效且不报错），探针数组恒为空，极易误判成业务代码没调用。改 hook JS 侧的 `voiceSay` 才拿到数据。→ 这也是「业务代码经自己的全局函数再调 bridge」的价值：留出可测接缝。
3. **adb 广播有排队延迟**，需核对 logcat 时间戳，否则会读到上一次的结果。

### ✅ 6.3 分层：规则层无 DOM 依赖

`rules.js` 全为纯函数，不碰 DOM，可直接在 Node 里跑。这让逻辑验证不必启模拟器——名次生命周期的验证就是纯 Node 完成的。

**坑**：给 `game.js` 搭 DOM stub 时会陷入无底洞（`removeChild`/`clientHeight`/`elementFromPoint` 一个个补）。更划算的做法是**直接测目标函数**（如 `renderRankTag`），绕开 `renderHand` 的深度 DOM 依赖。

### ✅ 6.4 其他实测坑

- **`elementFromPoint` 命中的是子元素**，判断归属要用 `el.closest('.card') === card`，写成 `el === card` 会大量误判为「点不到」。
- **测手机布局必须用 iframe，不能改容器尺寸**。元素若用 `left:50%;transform:translateX(-50%)` 定位，改父容器后它仍按浏览器真实窗口宽度算中点，会被定位到视口外，测出「所有元素都点不到」的假象。
- **横屏媒体查询要放文件末尾**，与前面同特异性的规则靠后才生效。
- **模拟器 OOM 会杀 WebView 进程**，表现为画面莫名退回初始态。查 `adb logcat -d | grep -i "lowmemorykiller.*webview"`，启动加 `-memory 2048` 缓解。这不是代码 bug。
- **`sUseWideViewPort=false`** 锁横屏防闪。

---

## 版本

| 版本 | 内容 |
|---|---|
| v1.6（进行中） | 名次标记持久化、摄像头避让；🔨 按钮上移按需显示、选中牌左锁列、按话分列理牌 |
| v1.5 | 原生 TTS 语音报牌型、首出 20 秒 |
| v1.4 | 四家出牌分方位显示、隐藏他人手牌、牌数 <10 才显示 |
| v1.3 | 滑动选牌、自动理牌、记牌器 |
| v1.2 | 出牌限时、持久「不要」标记 |
| v1.1 | 进贡还贡、双下计分、级牌升级 |
| v1.0 | 基础对局与 AI |
