# 掼蛋（Guandan）单机版

四人两队掼蛋，纯前端实现 + Android WebView 封装。单机对战三个 AI，横屏，带原生语音报牌。

APK 约 41 KB，无任何第三方依赖。

## 玩法与规则

掼蛋为四人两队（你与「对家」一队，「左家」「右家」为对手），两副牌共 108 张，每人 27 张。

| 规则 | 实现 |
|---|---|
| 级牌 | 当前级牌的牌力升至 A 之下、大小王之下 |
| 逢人配 | 红桃级牌为百搭，可当任意牌（`isWild` 判定 `c.s==='H' && c.r===level`）|
| 牌型 | 单张、对子、三张、三带二、顺子、同花顺、连对（三连对）、钢板、炸弹（4~N 张）、四王炸 |
| 炸弹比较 | 先比张数（`bombLv`），同张数比点数；同花顺介于 5 炸与 6 炸之间；四王炸最大 |
| 进贡/还贡 | 上局末游向头游进贡最大牌，头游还一张 10 以下；持有两王可抗贡（`canRefuse`）|
| 升级 | 头游+二游同队为「双下」升 3 级，头游+三游升 2 级，否则升 1 级 |
| 结束 | 打过 A 即胜 |

## 功能

- **AI 对手** —— 主动出牌选最小非炸弹长牌型；跟牌选能压住的最小牌；队友领出时倾向不压（55% 概率）；仅在对手快走完或自己手牌 ≤8 张时才动炸弹
- **语音报牌** —— 出牌播报牌型，过牌播报「不要」。炸弹类报「4炸/同花顺/四王炸」，单张对子带点数（「一对7」「A」）。HUD 喇叭图标切换静音
- **出牌限时** —— 首出（领出）20 秒，跟牌 10 秒。仅人类座位计时，超时自动出最右列/不要
- **滑动选牌** —— 手牌按点数分列纵向堆叠，支持按下拖动跨列连选
- **自动理牌** —— `arrange.js` 搜索整手牌的最优拆分方案，一键高亮推荐组合
- **提示** —— 列出所有能压过当前牌的合法组合，循环切换
- **记牌器** —— 统计每个点数的剩余张数（总数 8 张 − 已出 − 我手上）
- **方位出牌区** —— 四家出牌分别显示在各自座位一侧，不堆叠在中央

## 项目结构

```
app/src/main/
├── assets/game/            # H5 游戏本体，无框架无构建
│   ├── index.html          #   DOM 骨架，脚本引用带 ?v=N 版本号
│   ├── style.css   (342行) #   横屏媒体查询 + 牌面样式
│   ├── rules.js    (291行) #   牌型判定与比较、级牌、逢人配、进贡（纯函数）
│   ├── ai.js       (123行) #   组合枚举 genCombos + 决策 aiChoose
│   ├── arrange.js  (172行) #   整手牌最优拆分搜索
│   ├── voice.js    ( 90行) #   语音播报，原生 bridge 优先 / speechSynthesis 回退
│   └── game.js     (788行) #   状态机、渲染、交互、计分
├── java/com/aiden/guandan/
│   └── MainActivity.java   # WebView 容器 + 原生 TTS bridge + 调试探针
└── AndroidManifest.xml     # 横屏锁定 + TTS 包可见性声明
```

分层原则：`rules.js` 全为纯函数，不碰 DOM，可单独在 Node 里跑；`game.js` 持有全局状态 `G` 并驱动渲染。

## 构建

需要 JDK 21 + Android SDK（compileSdk 35，minSdk 24）。

```bash
export JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
gradle assembleRelease --no-daemon
# 产物: app/build/outputs/apk/release/app-release.apk
```

`local.properties` 含本机 SDK 路径，已被 gitignore，首次构建需自行创建：

```
sdk.dir=/Users/<你>/Library/Android/sdk
```

### 纯浏览器调试

游戏本体不依赖 Android，可直接起静态服务开发：

```bash
cd app/src/main/assets/game && python3 -m http.server 8899
```

此时语音走 `speechSynthesis` 回退路径。

**改动 JS/CSS 后必须递增 `index.html` 里的 `?v=N`**，否则 WebView 和浏览器都会拿缓存里的旧文件——曾因此连续两轮测试读到旧值，误判成代码没生效。

## 语音实现

WebView 里的 `speechSynthesis` 在 Android 上不可靠（依赖 Google TTS + 用户手势），因此走原生 `TextToSpeech` 通过 JS bridge 暴露：

```
voicePlay/voicePass → voiceSay → window.AndroidTTS.speak → 原生 TextToSpeech
                              ↘ speechSynthesis（浏览器回退）
```

三个必要条件：

1. **manifest 声明包可见性**，否则 targetSdk 30+ 查不到 TTS 引擎，`setLanguage` 返回 `LANG_NOT_SUPPORTED`：
   ```xml
   <queries><intent><action android:name="android.intent.action.TTS_SERVICE" /></intent></queries>
   ```
2. **TTS 初始化是异步的**，`onInit` 成功后回调 `web.evaluateJavascript("voiceInit()")` 让 H5 重新探测，否则首句丢失
3. **`QUEUE_FLUSH`** 打断上一句以跟上出牌节奏，`QUEUE_ADD` 会积压

## 调试探针

`MainActivity` 注册了若干广播接收器，通过 `evaluateJavascript` 从 WebView 内部 dump 量化数据到 logcat——比截图肉眼判断可靠得多。

```bash
adb shell am broadcast -a com.aiden.guandan.PROBE      # 布局几何: 溢出/遮挡/可点性/配色
adb shell am broadcast -a com.aiden.guandan.VOICE      # 语音链路: 驱动真实 doPlay/doPass 记录播报序列
adb shell am broadcast -a com.aiden.guandan.TAP        # 页面内点「开始」，绕过坐标换算
adb shell am broadcast -a com.aiden.guandan.SELTEST    # 选中列展开 + 遮罩
adb shell am broadcast -a com.aiden.guandan.SWIPETEST  # 滑动选牌 + 自动理牌
adb shell am broadcast -a com.aiden.guandan.PASSTEST   # 持久「不要」标记

adb logcat -d | grep GuandanWV
```

VOICE 探针的实测输出：

```json
{"mode":"native","nativeReady":true,
 "seq":["三带二","不要","一对7","4炸","测试静音(未发声)"],
 "mutedSpoke":false,"leadLimit":20,"turnLimit":10}
```

探针刻意调用真实的 `doPlay`/`doPass` 而非纯函数——只测 `voiceTextForPlay()` 能证明文案对，但证明不了它在对局中会被触发。

## 踩坑记录

**Java bridge 注入的方法不可 hook。** 想统计 bridge 调用次数时覆盖 `window.AndroidTTS.speak` 会静默失败（`addJavascriptInterface` 注入的方法属性不可写，赋值无效且不报错），探针数组一直为空，极易误判成业务代码没调用。改为 hook JS 侧的 `voiceSay` 才拿到数据。这也是「业务代码经自己的全局函数再调 bridge」的价值——留出可测接缝。

**`elementFromPoint` 命中的是子元素。** 判断归属要用 `el.closest('.card') === card`，写成 `el === card` 会大量误判为「点不到」。

**测手机布局必须用 iframe，不能改容器尺寸。** 元素若用 `left:50%;transform:translateX(-50%)` 定位，改父容器后它仍按浏览器真实窗口宽度算中点，会被定位到视口外，测出「所有元素都点不到」的假象。

**横屏空间要先压缩座位。** 对家出牌区曾在 844×390 / 640×360 下压住座位——座位块底边 147px 已低于中央提示区，上方没有空间。需先在横屏媒体查询里压缩座位（头像 46→30→26px）才腾出位置。

**竖向堆叠比横向错位可点性好。** 手牌横向错位排列时有 7–9 张点不到；改为按点数分列纵向堆叠（靠下的牌 z-index 更高）后降到 0 张。

**不要用 `transform:scale()` 兜底。** 布局装不下时整体缩放会把牌压到 28×39 极小尺寸，宁可缩小基准尺寸 + 增加叠压。

**模拟器 OOM 会杀 WebView 进程**，表现为画面莫名退回初始态。查 `adb logcat -d | grep -i "lowmemorykiller.*webview"`，启动加 `-memory 2048` 缓解。这不是代码 bug。

## 版本

| 版本 | 内容 |
|---|---|
| v1.5 | 原生 TTS 语音报牌型、首出 20 秒 |
| v1.4 | 四家出牌分方位显示、隐藏他人手牌、牌数 <10 才显示 |
| v1.3 | 滑动选牌、自动理牌、记牌器 |
| v1.2 | 出牌限时、持久「不要」标记 |
| v1.1 | 进贡还贡、双下计分、级牌升级 |
| v1.0 | 基础对局与 AI |
