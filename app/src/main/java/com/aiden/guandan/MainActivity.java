package com.aiden.guandan;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

public class MainActivity extends Activity {
    private WebView web;
    private android.speech.tts.TextToSpeech tts;
    private volatile boolean ttsReady = false;
    /** 播报序号: 每句自增, 用于把 onDone 回调对上是哪一句 */
    private final java.util.concurrent.atomic.AtomicInteger uttSeq =
        new java.util.concurrent.atomic.AtomicInteger(0);

    /** 暴露给 H5 的原生 TTS 桥: window.AndroidTTS.speak(text) */
    public class TTSBridge {
        @android.webkit.JavascriptInterface
        public void speak(String text) {
            if (!ttsReady || tts == null || text == null || text.isEmpty()) return;
            // QUEUE_FLUSH: 打断上一句,跟上出牌节奏
            tts.speak(text, android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, "gd");
        }

        /**
         * 带完成回调的播报: 说完后调用 H5 的 window.voiceDone(id)。
         * 返回本句的 id; 返回 -1 表示没能发声(未就绪), 调用方应立即走兜底不必等。
         * 用途: AI 出牌要等上家把话说完再出, 避免语音被打断。
         */
        @android.webkit.JavascriptInterface
        public int speakTracked(String text) {
            if (!ttsReady || tts == null || text == null || text.isEmpty()) return -1;
            final int id = uttSeq.incrementAndGet();
            tts.speak(text, android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, "gd#" + id);
            return id;
        }

        @android.webkit.JavascriptInterface
        public boolean ready() { return ttsReady; }
    }

    /** 应用控制桥: window.AndroidApp.quit() 退出游戏 */
    public class AppBridge {
        @android.webkit.JavascriptInterface
        public void quit() {
            runOnUiThread(new Runnable() {
                @Override public void run() { finish(); }
            });
        }
    }

    /** 把 utteranceId 里的序号回传给 H5(主线程执行 evaluateJavascript) */
    private void notifyVoiceDone(String utteranceId, final boolean interrupted) {
        if (utteranceId == null || !utteranceId.startsWith("gd#")) return;
        final String idStr = utteranceId.substring(3);
        runOnUiThread(new Runnable() {
            @Override public void run() {
                if (web == null) return;
                web.evaluateJavascript(
                    "window.voiceDone&&window.voiceDone(" + idStr + ","
                    + (interrupted ? "true" : "false") + ")", null);
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // 页面已声明 <meta viewport width=device-width>,关掉宽视口避免启动瞬间用 980px 默认视口导致布局闪烁
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.setBackgroundColor(0xFF0B3D2E);
        if (Build.VERSION.SDK_INT >= 19) WebView.setWebContentsDebuggingEnabled(true);
        // 把 H5 的 console / JS 错误转发到 logcat,便于真机排查
        web.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                android.util.Log.i("GuandanJS", m.message()
                    + " @" + m.sourceId() + ":" + m.lineNumber()
                    + " [" + m.messageLevel() + "]");
                return true;
            }
        });
        // 捕获资源加载失败 / 页面错误
        web.setWebViewClient(new android.webkit.WebViewClient() {
            @Override
            public void onPageFinished(android.webkit.WebView v, String url) {
                android.util.Log.i("GuandanWV", "PAGE_FINISHED " + url);
                v.evaluateJavascript(
                    "(function(){try{return 'G='+(typeof G)+' deal='+(typeof deal)"
                    + "+' rules='+(typeof evalCards)+' ai='+(typeof aiChoose)"
                    + "+' cards='+document.querySelectorAll('.card').length;}"
                    + "catch(e){return 'ERR '+e.message}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "STATE " + s);
                        }
                    });
            }
            @Override
            public void onReceivedError(android.webkit.WebView v,
                    android.webkit.WebResourceRequest req,
                    android.webkit.WebResourceError err) {
                android.util.Log.e("GuandanWV", "RES_FAIL " + req.getUrl()
                    + " code=" + err.getErrorCode() + " " + err.getDescription());
            }
        });
        // 供 adb 触发的自检: adb shell am broadcast -a com.aiden.guandan.PROBE
        registerReceiver(new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context c, android.content.Intent i) {
                web.evaluateJavascript(
                    "(function(){try{"
                    + "if(document.getElementById('mask').classList.contains('on'))"
                    + "  document.getElementById('dBtn').click();"
                    + "var box=document.getElementById('hand');"
                    + "var cols=[].slice.call(box.querySelectorAll('.hcol'));"
                    + "var cards=[].slice.call(box.querySelectorAll('.card'));"
                    + "if(!cards.length) return 'NO_CARDS';"
                    + "var rs=cards.map(function(c){return c.getBoundingClientRect()});"
                    + "var minL=Math.min.apply(0,rs.map(function(r){return r.left}));"
                    + "var maxR=Math.max.apply(0,rs.map(function(r){return r.right}));"
                    + "var tops={};rs.forEach(function(r){tops[Math.round(r.top)]=1});"
                    + "var sameRank=cols.every(function(col){var s={};"
                    + "  [].slice.call(col.querySelectorAll('.card .r')).forEach(function(e){s[e.textContent]=1});"
                    + "  return Object.keys(s).length===1});"
                    + "var zOK=cols.every(function(col){var zs=[].slice.call(col.querySelectorAll('.card'))"
                    + "  .map(function(c){return +getComputedStyle(c).zIndex});"
                    + "  return zs.every(function(z,i){return i===0||z<zs[i-1]})});"
                    + "var unreach=0;cols.forEach(function(col){"
                    + "  [].slice.call(col.querySelectorAll('.card')).forEach(function(cd){"
                    + "    var r=cd.getBoundingClientRect(),hit=0;"
                    + "    for(var dx=1;dx<r.width-1;dx+=2)for(var dy=4;dy<r.height-4;dy+=6){"
                    + "      var el=document.elementFromPoint(r.left+dx,r.top+dy);"
                    + "      var ow=el?el.closest('.card'):null; if(ow===cd)hit++;}"
                    + "    if(hit===0)unreach++;})});"
                    + "var vertOK=true;cols.forEach(function(c){"
                    + "  var cs=[].map.call(c.querySelectorAll('.card'),function(e){return e.getBoundingClientRect()});"
                    + "  if(cs.length>1){var sl=cs.every(function(r){return Math.abs(r.left-cs[0].left)<1.5});"
                    + "    var desc=true;for(var i=1;i<cs.length;i++){if(cs[i].top>=cs[i-1].top)desc=false}"
                    + "    if(!sl||!desc)vertOK=false}});"
                    + "var tEl=document.getElementById('hTimer');"
                    + "var rankHid=0;cols.forEach(function(c){"
                    + "  [].forEach.call(c.querySelectorAll('.card'),function(cd){"
                    + "    var r=cd.getBoundingClientRect();"
                    + "    var el=document.elementFromPoint(r.left+8,r.top+8);"
                    + "    var ow=el?el.closest('.card'):null; if(ow!==cd)rankHid++})});"
                    + "var pt=['pS','pE','pN','pW'].filter(function(id){"
                    + "  var e=document.getElementById(id);"
                    + "  return e&&e.classList.contains('on')});"
                    + "var zon=['zS','zE','zN','zW'].filter(function(id){"
                    + "  var e=document.getElementById(id);"
                    + "  return e&&e.classList.contains('on')});"
                    + "var cntVis=['cE','cN','cW'].map(function(id){"
                    + "  var e=document.getElementById(id);"
                    + "  return e?getComputedStyle(e.parentNode).visibility.charAt(0):'?'}).join('');"
                    + "var backs=document.querySelectorAll('.backs').length;"
                    + "var CC={sH:'rgb(211, 32, 42)',sS:'rgb(26, 26, 26)',"
                    + "  sD:'rgb(217, 144, 0)',sC:'rgb(31, 138, 76)'};"
                    + "var EX={'\\u2665':'sH','\\u2660':'sS','\\u2666':'sD','\\u2663':'sC'};"
                    + "var colorBad=0,seen={};"
                    + "cards.forEach(function(cd){"
                    + "  var cls=['sH','sS','sD','sC'].filter(function(x){return cd.classList.contains(x)})[0];"
                    + "  if(!cls){colorBad++;return;}"
                    + "  var col=getComputedStyle(cd).color; seen[cls]=col;"
                    + "  if(col!==CC[cls])colorBad++;"
                    + "  if(!cd.classList.contains('joker')){"
                    + "    var st=cd.querySelector('.s').textContent;"
                    + "    if(EX[st]!==cls)colorBad++;}});"
                    + "return JSON.stringify({cards:cards.length,cols:cols.length,"
                    + "  cardW:Math.round(rs[0].width),cardH:Math.round(rs[0].height),"
                    + "  spanL:Math.round(minL),spanR:Math.round(maxR),vw:innerWidth,"
                    + "  overflow:(minL<-1||maxR>innerWidth+1),sameRank:sameRank,"
                    + "  zOrderOK:zOK,vertStack:vertOK,rankHidden:rankHid,passTags:pt,zones:zon,cntVis:cntVis,backs:backs,timer:(tEl?tEl.textContent:'n/a'),unreachable:unreach,"
                    + "  colorBad:colorBad,colors:seen});"
                    + "}catch(e){return 'ERR '+e.message}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "PROBE " + s);
                        }
                    });
            }
        }, new android.content.IntentFilter("com.aiden.guandan.PROBE"),
           android.content.Context.RECEIVER_EXPORTED);
        // 供 adb 触发的自检: adb shell am broadcast -a com.aiden.guandan.PROBE
        registerReceiver(new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context c, android.content.Intent it) {
                web.evaluateJavascript(
                    "(function(){try{"
                    + "var m=document.getElementById('mask');"
                    + "var b=document.getElementById('dBtn');"
                    + "var out={dpr:window.devicePixelRatio,vw:innerWidth,vh:innerHeight,"
                    + "  maskOn:m?m.classList.contains('on'):null};"
                    + "if(b){var r=b.getBoundingClientRect();"
                    + "  out.btnCssX=Math.round(r.left+r.width/2);"
                    + "  out.btnCssY=Math.round(r.top+r.height/2);"
                    + "  out.btnDevX=Math.round((r.left+r.width/2)*window.devicePixelRatio);"
                    + "  out.btnDevY=Math.round((r.top+r.height/2)*window.devicePixelRatio);"
                    + "  out.btnText=b.textContent;}"
                    + "return JSON.stringify(out);"
                    + "}catch(e){return 'ERR '+e.message}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "BTN " + s);
                        }
                    });
            }
        }, new android.content.IntentFilter("com.aiden.guandan.BTN"),
           android.content.Context.RECEIVER_EXPORTED);

        // 直接在 WebView 内部点开始,绕过坐标换算
        registerReceiver(new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context c, android.content.Intent it) {
                web.evaluateJavascript(
                    "(function(){try{"
                    + "var b=document.getElementById('dBtn');"
                    + "if(!b) return 'NO_BTN';"
                    + "b.click();"
                    + "return 'CLICKED:'+b.textContent;"
                    + "}catch(e){return 'ERR '+e.message}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "TAP " + s);
                        }
                    });
            }
        }, new android.content.IntentFilter("com.aiden.guandan.TAP"),
                android.content.Context.RECEIVER_EXPORTED);

        // 专测持久"不要"标记: 在真机内部驱动一个确定场景
        registerReceiver(new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context c, android.content.Intent i) {
                web.evaluateJavascript(
                    "(function(){try{"
                    + "var C=function(r,s,id){return {id:id,r:r,s:s}};"
                    + "var V=function(id){var e=document.getElementById(id);"
                    + "  return e?e.classList.contains('on'):false};"
                    + "var SH=function(){return ['pS','pE','pN','pW'].filter(V).join(',')||'-'};"
                    + "['mask','wildPick','counter'].forEach(function(id){"
                    + "  var e=document.getElementById(id); if(e)e.classList.remove('on')});"
                    + "var out=[];"
                    + "G.running=true;G.ending=false;G.finished=[];G.played=[];"
                    + "clearTurnTimer();clearPassed();"
                    + "G.hands[0]=[C('4','S','a1'),C('K','H','a2')];"
                    + "G.hands[1]=[C('5','C','b1'),C('Q','D','b2')];"
                    + "G.hands[2]=[C('6','D','c1'),C('J','S','c2')];"
                    + "G.hands[3]=[C('7','H','d1'),C('9','C','d2')];"
                    + "G.turn=0;G.lastPlay=null;refresh();"
                    + "doPlay(0,[G.hands[0][1]],evalCards([C('K','H','a2')],G.curLevel));"
                    + "doPass(1); out.push('右家不要:'+SH());"
                    + "doPass(2); out.push('+对家不要:'+SH());"
                    + "doPass(3); out.push('一圈完:'+SH()+' turn='+G.turn);"
                    + "clearPassed();G.lastPlay={seat:2,cards:[],e:{type:'single',val:99}};"
                    + "G.turn=0;refresh();doPass(0);"
                    + "out.push('我不要:'+SH());"
                    + "clearPassed();refresh();"
                    + "return JSON.stringify(out);"
                    + "}catch(e){return 'ERR '+e.message}})()",
                    new android.webkit.ValueCallback<String>() {
                        public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "PASSTEST " + s);
                        }
                    });
            }
        }, new android.content.IntentFilter("com.aiden.guandan.PASSTEST"),
                android.content.Context.RECEIVER_EXPORTED);

        // 专测"选中列展开 + 灰色遮罩"
        registerReceiver(new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context c, android.content.Intent i) {
                web.evaluateJavascript(
                    "(function(){try{"
                    + "var cols=function(){return [].slice.call("
                    + "  document.querySelectorAll('#hand .hcol'))};"
                    + "var gapOf=function(col){var t=[].map.call("
                    + "  col.querySelectorAll('.card'),function(e){"
                    + "    return Math.round(e.getBoundingClientRect().top)});"
                    + "  var g=[];for(var i=1;i<t.length;i++)g.push(t[i-1]-t[i]);return g};"
                    + "var idx=-1,cs=cols();"
                    + "for(var i=0;i<cs.length;i++){"
                    + "  if(cs[i].querySelectorAll('.card').length>=3){idx=i;break}}"
                    + "if(idx<0)return 'NO_MULTI_COL';"
                    + "var g0=gapOf(cs[idx]);"
                    + "var cards=cs[idx].querySelectorAll('.card');"
                    + "var tgt=cards[cards.length-1];"
                    + "var rr=tgt.getBoundingClientRect();"
                    + "var px=Math.round(rr.left+rr.width/2),py=Math.round(rr.top+8);"
                    + "var box=document.getElementById('hand');"
                    + "var pe=function(t){box.dispatchEvent(new PointerEvent(t,"
                    + "  {clientX:px,clientY:py,bubbles:true,cancelable:true,"
                    + "   pointerId:1,isPrimary:true}))};"
                    + "pe('pointerdown');pe('pointerup');"
                    + "var ex=cols().filter(function(x){"
                    + "  return x.classList.contains('expanded')});"
                    + "if(!ex.length)return JSON.stringify({err:'NOT_EXPANDED',gap0:g0});"
                    + "var g1=gapOf(ex[0]);"
                    + "var sc=ex[0].querySelector('.card.sel');"
                    + "var mask=sc?getComputedStyle(sc,'::after').backgroundColor:'none';"
                    + "var handTop=document.getElementById('hand').getBoundingClientRect().top;"
                    + "var over=0,hid=0;"
                    + "cols().forEach(function(col){"
                    + "  [].forEach.call(col.querySelectorAll('.card'),function(cd){"
                    + "    var r=cd.getBoundingClientRect();"
                    + "    if(r.top<handTop-1)over++;"
                    + "    var el=document.elementFromPoint(r.left+8,r.top+8);"
                    + "    var ow=el?el.closest('.card'):null; if(ow!==cd)hid++})});"
                    + "var uniform=g1.length? g1.every(function(v){return v===g1[0]}):true;"
                    + "var hb=document.getElementById('hand');"
                    + "var dbg={boxH:hb.clientHeight,cardH:Math.round("
                    + "  cs[idx].querySelector('.card').getBoundingClientRect().height),"
                    + "  stack:cs[idx].querySelectorAll('.card').length,"
                    + "  maxStack:Math.max.apply(null,cols().map(function(x){"
                    + "    return x.querySelectorAll('.card').length}))};"
                    + "if(sc){var r2=sc.getBoundingClientRect();"
                    + "  px=Math.round(r2.left+r2.width/2);py=Math.round(r2.top+8);"
                    + "  pe('pointerdown');pe('pointerup');}"
                    + "return JSON.stringify({gapBefore:g0[0],gapAfter:g1[0],"
                    + "  expanded:g1[0]>g0[0],uniform:uniform,mask:mask,"
                    + "  overTop:over,rankHidden:hid,dbg:dbg});"
                    + "}catch(e){return 'ERR '+e.message}})()",
                    new android.webkit.ValueCallback<String>() {
                        public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "SELTEST " + s);
                        }
                    });
            }
        }, new android.content.IntentFilter("com.aiden.guandan.SELTEST"),
                android.content.Context.RECEIVER_EXPORTED);

        // 专测"滑动选牌 + 自动理牌"
        registerReceiver(new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context c, android.content.Intent i) {
                web.evaluateJavascript(
                    "(function(){try{"
                    + "var box=document.getElementById('hand');"
                    + "var pe=function(t,x,y){box.dispatchEvent(new PointerEvent(t,"
                    + "  {clientX:x,clientY:y,bubbles:true,cancelable:true,"
                    + "   pointerId:1,isPrimary:true}))};"
                    + "var cols=function(){return [].slice.call("
                    + "  document.querySelectorAll('#hand .hcol'))};"
                    + "var out={};"
                    + "var idx=-1,cs0=cols();"
                    + "for(var i=0;i<cs0.length;i++){"
                    + "  if(cs0[i].querySelectorAll('.card').length>=3){idx=i;break}}"
                    + "if(idx<0){out.swipe='NO_MULTI_COL'}else{"
                    + "  G.sel.clear();renderHand();"
                    + "  var cd=[].slice.call(cols()[idx].querySelectorAll('.card'));"
                    + "  var n=cd.length;"
                    + "  var pts=cd.map(function(e){var r=e.getBoundingClientRect();"
                    + "    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+8)}});"
                    + "  pe('pointerdown',pts[n-1].x,pts[n-1].y);"
                    + "  for(var j=n-2;j>=0;j--)pe('pointermove',pts[j].x,pts[j].y);"
                    + "  pe('pointerup',pts[0].x,pts[0].y);"
                    + "  out.swipeSameCol=G.sel.size+'/'+n;"
                    + "  out.expandedAfterSwipe=cols().filter(function(x){"
                    + "    return x.classList.contains('expanded')}).length;"
                    + "  G.sel.clear();renderHand();"
                    + "  var tp=cols().map(function(col){"
                    + "    var a=[].slice.call(col.querySelectorAll('.card'));"
                    + "    var r=a[a.length-1].getBoundingClientRect();"
                    + "    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+8)}});"
                    + "  var k=Math.min(4,tp.length);"
                    + "  pe('pointerdown',tp[0].x,tp[0].y);"
                    + "  for(var m=1;m<k;m++)pe('pointermove',tp[m].x,tp[m].y);"
                    + "  pe('pointerup',tp[k-1].x,tp[k-1].y);"
                    + "  out.swipeCrossCol=G.sel.size+'/'+k;"
                    + "}"
                    + "G.sel.clear();renderHand();"
                    + "var t0=performance.now();"
                    + "var r=arrangeHand(G.hands[0],G.curLevel);"
                    + "out.arrangeMs=Math.round(performance.now()-t0);"
                    + "out.arrangeCount=r.count;"
                    + "var used=[];r.hands.forEach(function(g){"
                    + "  g.cards.forEach(function(cc){used.push(cc.id)})});"
                    + "out.cardsCovered=(new Set(used)).size+'/'+G.hands[0].length;"
                    + "out.allValid=r.hands.every(function(g){"
                    + "  return !!evalCards(g.cards,G.curLevel)});"
                    + "out.types=r.hands.map(function(g){return typeName(g.e)}).join('+');"
                    + "document.getElementById('btnSort').click();"
                    + "out.selAfterSort=G.sel.size;"
                    + "out.planLen=G.plan?G.plan.length:0;"
                    + "G.sel.clear();renderHand();"
                    + "return JSON.stringify(out);"
                    + "}catch(e){return 'ERR '+e.message}})()",
                    new android.webkit.ValueCallback<String>() {
                        public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "SWIPETEST " + s);
                        }
                    });
            }
        }, new android.content.IntentFilter("com.aiden.guandan.SWIPETEST"),
                android.content.Context.RECEIVER_EXPORTED);

        // 原生 TTS: WebView 的 speechSynthesis 在安卓上不可靠(依赖 Google TTS + 用户手势),
        // 用 JS bridge 把系统 TTS 暴露给 H5
        web.addJavascriptInterface(new TTSBridge(), "AndroidTTS");
        // 应用控制桥: 菜单里的"退出游戏"需要调 finish()
        web.addJavascriptInterface(new AppBridge(), "AndroidApp");
        tts = new android.speech.tts.TextToSpeech(this,
            new android.speech.tts.TextToSpeech.OnInitListener() {
                @Override public void onInit(int status) {
                    if (status != android.speech.tts.TextToSpeech.SUCCESS) {
                        android.util.Log.e("GuandanWV", "TTS_INIT_FAIL " + status);
                        return;
                    }
                    int r = tts.setLanguage(java.util.Locale.CHINESE);
                    tts.setSpeechRate(1.15f);
                    ttsReady = (r != android.speech.tts.TextToSpeech.LANG_MISSING_DATA
                             && r != android.speech.tts.TextToSpeech.LANG_NOT_SUPPORTED);
                    android.util.Log.i("GuandanWV", "TTS_READY " + ttsReady + " lang=" + r
                        + " engine=" + tts.getDefaultEngine());
                    // 播报完成监听: 让 H5 能"等这句说完"再继续(AI 出牌节奏)
                    tts.setOnUtteranceProgressListener(
                        new android.speech.tts.UtteranceProgressListener() {
                            @Override public void onStart(String id) {}
                            @Override public void onDone(String id) {
                                notifyVoiceDone(id, false);
                            }
                            @Override public void onError(String id) {
                                // 出错也要回调, 否则等待方会一直挂着
                                notifyVoiceDone(id, true);
                            }
                            @Override public void onStop(String id, boolean interrupted) {
                                notifyVoiceDone(id, true);
                            }
                        });
                    // TTS 异步就绪,回头通知 H5 重新探测(避免首句丢)
                    web.post(new Runnable() { @Override public void run() {
                        web.evaluateJavascript(
                            "window.voiceInit && voiceInit()", null);
                    }});
                }
            });

        // 供 adb 验证语音链路: adb shell am broadcast -a com.aiden.guandan.VOICE
        registerReceiver(new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context c, android.content.Intent i) {
                web.evaluateJavascript(
                    "(function(){try{"
                    + "var mode=voiceInit();"
                    + "var C=function(r,s,id){return {id:id,r:r,s:s}};"
                    // 钩住 voiceSay(全局函数,可覆盖; Java bridge 的方法属性不可写)
                    + "window.__V=[];"
                    + "if(!window.__hooked){"
                    + "  var o=window.voiceSay;"
                    + "  window.voiceSay=function(t){var r=o(t);"
                    + "    window.__V.push(t+(r?'':'(未发声)'));return r};"
                    + "  window.__hooked=1;}"
                    // 走真实出牌链路 doPlay/doPass
                    + "['mask','wildPick','counter'].forEach(function(id){"
                    + "  var e=document.getElementById(id); if(e)e.classList.remove('on')});"
                    + "G.running=true;G.ending=false;G.finished=[];G.played=[];"
                    + "clearTurnTimer();clearPassed();"
                    + "var fh=[C('9','H','f1'),C('9','S','f2'),C('9','D','f3'),"
                    + "  C('3','C','f4'),C('3','H','f5')];"
                    + "var bm=[C('5','H','g1'),C('5','S','g2'),C('5','D','g3'),C('5','C','g4')];"
                    + "var pr=[C('7','H','v1'),C('7','S','v2')];"
                    + "G.hands[0]=fh.slice();G.hands[1]=bm.slice();"
                    + "G.hands[2]=pr.slice();G.hands[3]=[C('4','C','h1')];"
                    + "G.turn=0;G.lastPlay=null;refresh();"
                    + "doPlay(0,fh,evalCards(fh,G.curLevel));"          // 三带二
                    + "var v1=window.__V.slice();"
                    + "doPass(1);"                                      // 不要
                    + "var v2=window.__V.slice();"
                    + "G.lastPlay=null;G.turn=2;refresh();"
                    + "doPlay(2,pr,evalCards(pr,G.curLevel));"          // 一对7
                    + "var v3=window.__V.slice();"
                    + "G.lastPlay=null;G.turn=1;refresh();"
                    + "doPlay(1,bm,evalCards(bm,G.curLevel));"          // 4炸
                    + "var v4=window.__V.slice();"
                    // 静音开关验证
                    + "VOICE.on=false;var mutedSpoke=window.voiceSay('测试静音');"
                    + "VOICE.on=true;"
                    + "clearPassed();"
                    + "return JSON.stringify({mode:mode,nativeReady:(window.AndroidTTS?"
                    + "  window.AndroidTTS.ready():null),"
                    + "  seq:window.__V,afterPlay1:v1,afterPass:v2,afterPair:v3,afterBomb:v4,"
                    + "  mutedSpoke:mutedSpoke,leadLimit:LEAD_LIMIT,turnLimit:TURN_LIMIT});"
                    + "}catch(e){return 'ERR '+e.message}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "VOICE " + s);
                        }
                    });
            }
        }, new android.content.IntentFilter("com.aiden.guandan.VOICE"),
           android.content.Context.RECEIVER_EXPORTED);

        // 验证名次标记 + 摄像头避让: adb shell am broadcast -a com.aiden.guandan.RANKTEST
        registerReceiver(new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context c, android.content.Intent i) {
                web.evaluateJavascript(
                    "(function(){try{"
                    + "var K=['S','E','N','W'];"
                    + "var snap=function(){return K.map(function(k){"
                    + "  var e=document.getElementById('r'+k);"
                    + "  if(!e) return 'MISSING';"
                    + "  var on=getComputedStyle(e).display!=='none';"
                    + "  return on?(e.textContent||'(空)'):'-'})};"
                    + "['mask','wildPick','counter'].forEach(function(id){"
                    + "  var e=document.getElementById(id); if(e)e.classList.remove('on')});"
                    + "var C=function(r,s,id){return {id:id,r:r,s:s}};"
                    + "var out={};"
                    // 安全区与座位实际位置
                    + "var cs=getComputedStyle(document.documentElement);"
                    + "out.safeArea={l:cs.getPropertyValue('--sa-left').trim(),"
                    + "  r:cs.getPropertyValue('--sa-right').trim(),"
                    + "  t:cs.getPropertyValue('--sa-top').trim()};"
                    + "var wR=document.getElementById('seatW').getBoundingClientRect();"
                    + "var eR=document.getElementById('seatE').getBoundingClientRect();"
                    + "out.seatW={left:Math.round(wR.left),right:Math.round(wR.right)};"
                    + "out.seatE={left:Math.round(eR.left),right:Math.round(eR.right)};"
                    + "out.vw=innerWidth;"
                    // 左家必须整体在安全区右侧(避开摄像头)
                    + "var saL=parseFloat(cs.getPropertyValue('--sa-left'))||0;"
                    + "out.saLeftPx=saL;"
                    + "out.seatW_clearsCamera=(wR.left>=saL);"
                    + "out.seatE_clearsCamera=(eR.right<=innerWidth-(parseFloat(cs.getPropertyValue('--sa-right'))||0));"
                    // 驱动一局: 2头游 -> 0二游 -> 1三游 -> 3末游
                    + "G.running=true;G.ending=false;G.finished=[];G.rankOf=[0,0,0,0];"
                    + "clearTurnTimer();clearPassed();"
                    + "G.hands=[[C('4','S','a')],[C('5','C','b')],[C('6','D','c')],"
                    + "  [C('7','H','d'),C('8','H','e')]];"
                    + "G.turn=2;G.lastPlay=null;refresh();"
                    + "out.r0_start=snap();"
                    + "doPlay(2,[G.hands[2][0]],evalCards([C('6','D','c')],G.curLevel));"
                    + "out.r1_seat2=snap();"
                    + "G.lastPlay=null;G.turn=0;refresh();"
                    + "doPlay(0,[G.hands[0][0]],evalCards([C('4','S','a')],G.curLevel));"
                    + "out.r2_me=snap();"
                    + "G.lastPlay=null;G.turn=1;refresh();"
                    + "doPlay(1,[G.hands[1][0]],evalCards([C('5','C','b')],G.curLevel));"
                    + "out.r3_all=snap();"
                    + "out.rankOf=G.rankOf.slice();"
                    // 标记不能被遮挡: 检查每个 ranktag 中心点归属
                    + "out.visible=K.map(function(k){"
                    + "  var e=document.getElementById('r'+k);"
                    + "  if(!e||getComputedStyle(e).display==='none') return k+':off';"
                    + "  var r=e.getBoundingClientRect();"
                    + "  if(r.width===0) return k+':zero';"
                    + "  var el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);"
                    + "  var own=el&&(el===e||e.contains(el)||el.closest('.ranktag')===e);"
                    + "  return k+':'+(own?'ok':'BLOCKED_by_'+(el?el.className||el.id:'null'))});"
                    // 标记不能溢出屏幕
                    + "out.overflow=K.filter(function(k){"
                    + "  var e=document.getElementById('r'+k);"
                    + "  if(!e||getComputedStyle(e).display==='none') return false;"
                    + "  var r=e.getBoundingClientRect();"
                    + "  return r.left<-1||r.right>innerWidth+1||r.top<-1||r.bottom>innerHeight+1});"
                    // 持久性: 多次 refresh 不丢
                    + "refresh();refresh();out.persist=snap();"
                    // 名次与不要标记互斥
                    + "G.passed=[true,true,true,true];refresh();"
                    + "out.passOnFinished=['pS','pE','pN','pW'].map(function(id){"
                    + "  var e=document.getElementById(id);"
                    + "  return e?getComputedStyle(e).display!=='none':null});"
                    // 新局清空
                    + "G.lastOrder=null;deal();out.afterDeal=snap();"
                    + "return JSON.stringify(out);"
                    + "}catch(e){return 'ERR '+e.message+' @'+e.lineNumber}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "RANKTEST " + s);
                        }
                    });
            }
        }, new android.content.IntentFilter("com.aiden.guandan.RANKTEST"),
           android.content.Context.RECEIVER_EXPORTED);

        // 验证 HUD 左上角 + 倒计时归位: adb shell am broadcast -a com.aiden.guandan.HUDTEST
        registerReceiver(new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context c, android.content.Intent i) {
                web.evaluateJavascript(
                    "(function(){try{"
                    + "['mask','wildPick','counter'].forEach(function(id){"
                    + "  var e=document.getElementById(id); if(e)e.classList.remove('on')});"
                    + "var R=function(id){var e=document.getElementById(id);"
                    + "  if(!e) return null; var r=e.getBoundingClientRect();"
                    + "  return {l:Math.round(r.left),t:Math.round(r.top),"
                    + "    r:Math.round(r.right),b:Math.round(r.bottom),"
                    + "    w:Math.round(r.width),h:Math.round(r.height),"
                    + "    shown:getComputedStyle(e).display!=='none'}};"
                    + "var hit=function(a,b){if(!a||!b)return false;"
                    + "  return !(a.r<=b.l||b.r<=a.l||a.b<=b.t||b.b<=a.t)};"
                    + "var out={vw:innerWidth,vh:innerHeight};"
                    + "var cs=getComputedStyle(document.documentElement);"
                    + "out.sa={l:cs.getPropertyValue('--sa-left').trim(),"
                    + "  t:cs.getPropertyValue('--sa-top').trim(),"
                    + "  r:cs.getPropertyValue('--sa-right').trim()};"
                    + "out.hud=R('hud');"
                    // HUD 必须在左上角: 左边距小 且 顶部靠上
                    + "var saL=parseFloat(cs.getPropertyValue('--sa-left'))||0;"
                    + "out.hud_isTopLeft=(out.hud.l<innerWidth*0.35)&&(out.hud.t<innerHeight*0.2);"
                    + "out.hud_clearsCamera=(out.hud.l>=saL);"
                    // HUD 与各出牌区/座位是否重叠
                    + "out.hud_vs_zN=hit(out.hud,R('zN'));"
                    + "out.hud_vs_zW=hit(out.hud,R('zW'));"
                    + "out.hud_vs_seatW=hit(out.hud,R('seatW'));"
                    + "out.hud_vs_seatN=hit(out.hud,R('seatN'));"
                    + "out.hud_overflow=(out.hud.r>innerWidth+1)||(out.hud.b>innerHeight+1);"
                    // 声音按钮在 HUD 内且可点
                    + "var v=R('hVoice'); out.voice=v;"
                    + "out.voice_inHud=(v&&out.hud&&v.l>=out.hud.l-1&&v.r<=out.hud.r+1);"
                    + "var vc=document.getElementById('hVoice');"
                    + "var vr=vc.getBoundingClientRect();"
                    + "var vel=document.elementFromPoint(vr.left+vr.width/2,vr.top+vr.height/2);"
                    + "out.voice_clickable=!!(vel&&(vel===vc||vc.contains(vel)));"
                    // 非我回合应隐藏(原先常驻显示 "--")
                    + "var tc0=document.getElementById('hTimerChip');"
                    + "G.turn=2;clearTurnTimer();"
                    + "out.timer_hiddenOffTurn=!tc0.classList.contains('on');"
                    // 起表后应显示,且不与 zS/pS/rS 重叠
                    + "G.running=true;G.ending=false;G.turn=0;G.lastPlay=null;"
                    + "G.hands[0]=G.hands[0].length?G.hands[0]:[{id:900,r:'5',s:'S'}];"
                    + "startTurnTimer();"
                    + "var tc=document.getElementById('hTimerChip');"
                    + "out.timer_shownOnTurn=tc.classList.contains('on');"
                    + "out.timer=R('hTimerChip');"
                    + "out.timer_text=document.getElementById('hTimer').textContent;"
                    + "out.timer_vs_zS=hit(out.timer,R('zS'));"
                    + "out.timer_vs_pS=hit(out.timer,R('pS'));"
                    + "out.timer_vs_rS=hit(out.timer,R('rS'));"
                    + "out.timer_vs_bar=hit(out.timer,R('bar'));"
                    + "out.timer_vs_hand=hit(out.timer,R('hand'));"
                    + "out.timer_overflow=(out.timer.r>innerWidth+1)||(out.timer.l<-1)"
                    + "  ||(out.timer.b>innerHeight+1)||(out.timer.t<-1);"
                    // 倒计时应贴近手牌区上沿(视线焦点),而非停在顶部信息条
                    // 用与 #hand 的实际间距判断,比"下半屏"的粗糙阈值可靠
                    + "var hd=R('hand');"
                    + "out.timer_gapToHand=hd?(hd.t-out.timer.b):null;"
                    + "out.timer_nearHand=!!(hd&&out.timer.b<=hd.t+4&&out.timer.b>=hd.t-40);"
                    + "out.timer_belowCenter=out.timer.t>(R('center')||{b:0}).b;"
                    // 参照坐标: 定位倒计时该放哪
                    + "out.ref={hand:R('hand'),bar:R('bar'),zS:R('zS'),"
                    + "  pS:R('pS'),rS:R('rS'),center:R('center')};"
                    // 停表后应隐藏
                    + "clearTurnTimer();"
                    + "out.timer_hiddenAfterClear=!tc.classList.contains('on');"
                    + "return JSON.stringify(out);"
                    + "}catch(e){return 'ERR '+e.message}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "HUDTEST " + s);
                        }
                    });
            }
        }, new android.content.IntentFilter("com.aiden.guandan.HUDTEST"),
           android.content.Context.RECEIVER_EXPORTED);

        // 验证节奏改造: adb shell am broadcast -a com.aiden.guandan.RHYTHM
        // 检查 1) 各家独立计时器 2) 语音门闩(AI 等上家说完) 3) #actbar 按需显隐
        registerReceiver(new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context c, android.content.Intent i) {
                if (web == null) return;
                web.evaluateJavascript(
                    "(function(){try{"
                    + "var out={};"
                    + "var R=function(id){var e=document.getElementById(id);"
                    + "  if(!e)return null;var r=e.getBoundingClientRect();"
                    + "  return {t:Math.round(r.top),l:Math.round(r.left),"
                    + "          w:Math.round(r.width),h:Math.round(r.height),"
                    + "          on:e.classList.contains('on')};};"
                    // ---- 1) 四个座位的计时器 DOM 都存在 ----
                    + "out.timerEls=['hTimerChip','tE','tN','tW'].map(function(x){"
                    + "  return !!document.getElementById(x);});"
                    + "out.allTimersExist=out.timerEls.every(Boolean);"
                    // ---- 2) AI 座位起表: 计时器应亮在对应头像旁 ----
                    + "out.dbg_maskOn=document.getElementById('mask')"
                    + "  .classList.contains('on');"
                    + "out.dbg_wildOn=document.getElementById('wildPick')"
                    + "  .classList.contains('on');"
                    + "out.dbg_handLen2=G.hands[2].length;"
                    + "out.dbg_running=G.running;"
                    + "G.running=true;G.turn=2;G.lastPlay=null;"
                    + "startTurnTimer(2);"
                    + "out.aiTimerOn=R('tN')?R('tN').on:false;"
                    + "out.aiTimerOwner=G.turnOwner;"
                    + "out.aiTimerLeft=G.turnLeft;"
                    // 只有一个计时器亮着(不残留别家)
                    + "out.litCount=['hTimerChip','tE','tN','tW'].filter(function(x){"
                    + "  var e=document.getElementById(x);"
                    + "  return e&&e.classList.contains('on');}).length;"
                    + "out.onlyOneLit=(out.litCount===1);"
                    // ---- 3) 计时器不与自家头像重叠 ----
                    + "var ov=function(a,b){if(!a||!b)return false;"
                    + "  return !(a.l+a.w<=b.l||b.l+b.w<=a.l||a.t+a.h<=b.t||b.t+b.h<=a.t);};"
                    + "out.tN_vs_seatN=ov(R('tN'),R('seatN'));"
                    + "out.tW_vs_seatW=ov(R('tW'),R('seatW'));"
                    + "out.tE_vs_seatE=ov(R('tE'),R('seatE'));"
                    // ---- 4) 切到我方: AI 计时器必须熄灭 ----
                    + "G.turn=0;startTurnTimer(0);"
                    + "out.myTimerOn=R('hTimerChip')?R('hTimerChip').on:false;"
                    + "out.aiTimerCleared=!(R('tN')&&R('tN').on);"
                    // ---- 5) #actbar 按需显隐 ----
                    + "updateBar();"
                    + "out.actbarShownMyTurn=R('actbar')?R('actbar').on:false;"
                    + "G.turn=2;updateBar();"
                    + "out.actbarHiddenAiTurn=!(R('actbar')&&R('actbar').on);"
                    + "out.actbar=R('actbar');out.bar=R('bar');"
                    + "out.actbar_vs_bar=ov(R('actbar'),R('bar'));"
                    // ---- 6) 语音门闩: 存在且能兜底放行 ----
                    + "out.hasGateFns=(typeof setVoiceGate==='function')"
                    + "  &&(typeof voiceSayThen==='function')"
                    + "  &&(typeof voiceDone==='function');"
                    + "out.hasTrackedBridge=!!(window.AndroidTTS&&window.AndroidTTS.speakTracked);"
                    // 登记一个门闩并确认 scheduleAi 会消费它
                    + "var fired=false;setVoiceGate(function(cb){fired=true;cb();});"
                    + "G.running=true;G.turn=2;scheduleAi();"
                    + "out.gateConsumed=fired;"
                    + "out.gateCleared=(G.voiceGate===null);"
                    // ---- 7) 菜单: DOM/绑定/层级/规则文本 ----
                    + "out.menuBtnExists=!!document.getElementById('hMenu');"
                    + "out.menuFns=(typeof openMenu==='function')"
                    + "  &&(typeof restartGame==='function')"
                    + "  &&(typeof quitGame==='function')"
                    + "  &&(typeof showRules==='function');"
                    + "out.hasQuitBridge=!!(window.AndroidApp&&window.AndroidApp.quit);"
                    + "out.hasBackHook=(typeof window.onAndroidBack==='function');"
                    // 打开菜单 → 面板可见且计时停
                    + "openMenu();"
                    + "out.menuOpens=document.getElementById('menuMask')"
                    + "  .classList.contains('on');"
                    + "out.menuStopsTimer=(G.turnTimer===null);"
                    // 菜单 z-index 必须高于结算弹窗(#mask 80)
                    + "var zi=function(id){return parseInt(getComputedStyle("
                    + "  document.getElementById(id)).zIndex)||0;};"
                    + "out.z_menu=zi('menuMask');out.z_rules=zi('rulesMask');"
                    + "out.z_mask=zi('mask');"
                    + "out.menuAboveMask=(out.z_menu>out.z_mask);"
                    + "out.rulesAboveMenu=(out.z_rules>out.z_menu);"
                    // 规则面板: 打开后有内容且可滚动(不溢出屏幕)
                    + "showRules();"
                    + "var rb=document.getElementById('rulesBody');"
                    + "out.rulesOpens=document.getElementById('rulesMask')"
                    + "  .classList.contains('on');"
                    + "out.rulesHasText=(rb.textContent.length>200);"
                    + "var rr=document.getElementById('rulesBox').getBoundingClientRect();"
                    + "out.rulesFitsScreen=(rr.top>=0&&rr.bottom<=innerHeight+1);"
                    + "out.rulesScrollable=(rb.scrollHeight>rb.clientHeight);"
                    // 规则文本必须与实现一致: 提到同花顺夹在5炸6炸之间 + 20/10秒
                    + "var rt=rb.textContent;"
                    + "out.rulesMentionsFlush=(rt.indexOf('同花顺')>=0);"
                    + "out.rulesMentionsTimes=(rt.indexOf('20')>=0&&rt.indexOf('10')>=0);"
                    + "out.rulesMentionsWild=(rt.indexOf('逢人配')>=0);"
                    // 收尾: 全关掉
                    + "document.getElementById('rulesMask').classList.remove('on');"
                    + "closeMenu(false);"
                    + "out.menuCloses=!document.getElementById('menuMask')"
                    + "  .classList.contains('on');"
                    + "clearTimeout(G.aiTimer);clearTurnTimer();"
                    + "return JSON.stringify(out);"
                    + "}catch(e){return 'ERR '+e.message}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "RHYTHM " + s);
                        }
                    });
            }
        }, new android.content.IntentFilter("com.aiden.guandan.RHYTHM"),
           android.content.Context.RECEIVER_EXPORTED);

        // 输出 hMenu 的设备像素坐标, 供 adb input tap 真实点击验证
        // adb shell am broadcast -a com.aiden.guandan.MENUXY
        registerReceiver(new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context c, android.content.Intent i) {
                if (web == null) return;
                web.evaluateJavascript(
                    "(function(){try{"
                    + "var r=document.getElementById('hMenu').getBoundingClientRect();"
                    + "var d=window.devicePixelRatio||1;"
                    + "return JSON.stringify({x:Math.round((r.left+r.width/2)*d),"
                    + "  y:Math.round((r.top+r.height/2)*d),dpr:d,"
                    + "  menuOn:document.getElementById('menuMask')"
                    + "    .classList.contains('on')});"
                    + "}catch(e){return 'ERR '+e.message}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String s) {
                            android.util.Log.i("GuandanWV", "MENUXY " + s);
                        }
                    });
            }
        }, new android.content.IntentFilter("com.aiden.guandan.MENUXY"),
           android.content.Context.RECEIVER_EXPORTED);

        web.loadUrl("file:///android_asset/game/index.html");
        setContentView(web);
        hideBars();
    }

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) hideBars(); }

    @Override public void onDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; ttsReady = false; }
        super.onDestroy();
    }

    @Override public void onBackPressed() {
        if (web != null) { web.evaluateJavascript("window.onAndroidBack && window.onAndroidBack()", null); }
    }
}
