/* Slay Your Own Exam — Master lock guard for the sub-pages (flashcards, study buddy).
   index.html carries its own inline copy of this engine; every page shares the same
   localStorage key, so arming the lock anywhere guards the whole site. Leaving the
   tab (or clicking off the browser) sounds a siren + voice alarm; the only way out
   is saying — or typing — "I am done with my test". */
(function(){
'use strict';
var KEY='qbank.masterlock', PHRASE='i am done with my test';
var PAGE_TITLE=document.title;
var armed=false, ctx=null, buf=null, nodes=null, speakInt=null, alarmAt=0, stopT=null, blurT=null, count=null, navAt=0;

function readArmed(){try{return localStorage.getItem(KEY)==='1';}catch(e){return false;}}
function writeArmed(){try{if(armed)localStorage.setItem(KEY,'1');else localStorage.removeItem(KEY);}catch(e){}}

/* ---------- tiny toast ---------- */
var toastEl=null,toastT=null;
function toast(msg,ms){
  if(!toastEl){toastEl=document.createElement('div');
    toastEl.style.cssText='position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#1C2B2A;color:#F3FBF9;padding:10px 16px;border-radius:8px;font-size:13.5px;z-index:9999;opacity:0;transition:opacity .2s;max-width:90%;text-align:center';
    document.body.appendChild(toastEl);}
  toastEl.textContent=msg;toastEl.style.opacity='1';
  clearTimeout(toastT);toastT=setTimeout(function(){toastEl.style.opacity='0';},ms||2600);
}

/* ---------- alarm audio (same design as index.html) ---------- */
function ensureCtx(){
  if(!ctx){try{ctx=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}
  if(ctx&&ctx.state==='suspended')ctx.resume().catch(function(){});
  return ctx;
}
function loadBuf(){ // pre-decode Chase's recorded alarm if the site ships one; siren covers if not
  var c=ensureCtx();if(!c||buf)return;
  fetch('alarm.m4a').then(function(r){if(!r.ok)throw new Error(r.status);return r.arrayBuffer();})
    .then(function(ab){return c.decodeAudioData(ab);})
    .then(function(b){buf=b;})
    .catch(function(){});
}
function alarmOn(){return !!nodes;}
function startAlarm(){
  if(alarmOn()||!armed)return;
  alarmAt=Date.now();
  document.title='🚨 GET BACK TO YOUR TEST';
  var c=ensureCtx(),n={};
  if(c&&buf){
    try{
      var src=c.createBufferSource(),gain=c.createGain();
      src.buffer=buf;src.loop=true;gain.gain.value=1.0;
      src.connect(gain);gain.connect(c.destination);src.start();
      n={src:src,gain:gain};
    }catch(e){}
  }
  if(!n.src&&c){
    try{
      var osc=c.createOscillator(),g=c.createGain(),lfo=c.createOscillator(),lg=c.createGain();
      osc.type='square';osc.frequency.value=880;
      lfo.type='sine';lfo.frequency.value=2.2;lg.gain.value=320;
      lfo.connect(lg);lg.connect(osc.frequency);
      g.gain.value=0.55;osc.connect(g);g.connect(c.destination);
      osc.start();lfo.start();
      n={osc:osc,lfo:lfo,gain:g};
    }catch(e){}
  }
  nodes=n;
  if(!n.src&&('speechSynthesis' in window)){
    var speak=function(){ if(!alarmOn())return;
      try{var u=new SpeechSynthesisUtterance('Get back to your test!');u.volume=1;u.rate=1.05;
        speechSynthesis.cancel();speechSynthesis.speak(u);}catch(e){}
    };
    speak();clearInterval(speakInt);speakInt=setInterval(speak,3000);
  }
}
function stopAlarm(force){
  if(!alarmOn())return;
  var since=Date.now()-alarmAt;
  if(!force&&since<5000){ // minimum 5-second blast, like the Mac app
    clearTimeout(stopT);stopT=setTimeout(function(){stopAlarm(false);},5000-since+60);return;
  }
  clearTimeout(stopT);stopT=null;clearInterval(speakInt);speakInt=null;
  try{if('speechSynthesis' in window)speechSynthesis.cancel();}catch(e){}
  try{nodes.src&&nodes.src.stop();}catch(e){}
  try{nodes.osc&&nodes.osc.stop();nodes.lfo&&nodes.lfo.stop();}catch(e){}
  nodes=null;document.title=PAGE_TITLE;
}

/* ---------- leave detection ---------- */
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='hidden'){ if(armed)startAlarm(); }
  else stopAlarm(false);
});
window.addEventListener('blur',function(){
  if(!armed)return;
  clearTimeout(blurT); // short grace so dialogs/mic prompts don't false-alarm
  blurT=setTimeout(function(){ if(armed&&(document.visibilityState==='hidden'||!document.hasFocus()))startAlarm(); },700);
});
window.addEventListener('focus',function(){clearTimeout(blurT);stopAlarm(false);});
/* moving between pages of this site is allowed — the lock follows via localStorage */
document.addEventListener('click',function(e){
  var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;
  try{if(new URL(a.href,location.href).origin===location.origin)navAt=Date.now();}catch(err){}
},true);
window.addEventListener('beforeunload',function(e){
  if(!armed)return;
  if(Date.now()-navAt<1500)return; // in-site navigation
  e.preventDefault();e.returnValue='';
});

/* ---------- speak-to-unlock ---------- */
function normPhrase(s){return String(s||'').toLowerCase().replace(/[^a-z ]+/g,' ').replace(/\s+/g,' ').trim();}
function phraseMatches(heard){
  var h=normPhrase(heard);
  if(h.indexOf('done with my test')>=0)return true;
  var want=PHRASE.split(' '),hs={},hit=0;
  h.split(' ').forEach(function(w){hs[w]=1;});
  want.forEach(function(w){if(hs[w])hit++;});
  return hit>=want.length-1; // tolerate one misheard word
}
var modalBg=null,modalCleanup=null;
function closeModal(){
  if(modalCleanup){try{modalCleanup();}catch(e){}modalCleanup=null;}
  if(modalBg&&modalBg.parentNode)modalBg.parentNode.removeChild(modalBg);
  modalBg=null;
}
function openUnlockModal(){
  closeModal();
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  modalBg=document.createElement('div');
  modalBg.style.cssText='position:fixed;inset:0;background:rgba(10,20,30,.45);display:flex;align-items:center;justify-content:center;z-index:9998';
  modalBg.innerHTML=
    '<div style="background:#fff;color:#1C2B2A;border-radius:16px;max-width:520px;width:92%;padding:20px;box-shadow:0 14px 40px rgba(28,43,42,.2);font-family:inherit">'+
    '<div style="font-weight:700;margin-bottom:8px">🔒 Master lock</div>'+
    '<p style="margin:0 0 6px;font-weight:600">Say the unlock phrase out loud:</p>'+
    '<p style="font-size:20px;font-weight:800;margin:0 0 10px;color:#0E9C8B">“I am done with my test”</p>'+
    '<p id="mlStatus" style="font-size:12.5px;color:#5E716E;min-height:16px">'+(SR?'🎙 Listening…':'Voice unlock isn’t supported in this browser — type the phrase below.')+'</p>'+
    '<label style="display:block;font-size:13px;color:#5E716E;margin:10px 0 4px;font-weight:600">Emergency fallback — type the phrase exactly</label>'+
    '<input id="mlTyped" type="text" autocomplete="off" placeholder="I am done with my test" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #E2EEEB;border-radius:10px;font-size:14px;font-family:inherit">'+
    '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">'+
    '<button id="mlUnlock" style="background:#1FBFAB;color:#fff;border:none;border-radius:99px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer">Unlock</button>'+
    '<button id="mlCancel" style="background:#fff;color:#1C2B2A;border:1px solid #E2EEEB;border-radius:99px;padding:10px 18px;font-size:14px;cursor:pointer">Never mind — stay locked</button>'+
    '</div></div>';
  document.body.appendChild(modalBg);
  modalBg.addEventListener('click',function(e){if(e.target===modalBg)finish(false);});
  var rec=null,done=false,keep=true;
  modalCleanup=function(){keep=false;try{rec&&rec.stop();}catch(e){}};
  function finish(ok){
    if(done)return;done=true;keep=false;
    try{rec&&rec.stop();}catch(e){}
    closeModal();
    if(ok){disarm(true);toast('Unlocked — Master lock is off');}
  }
  if(SR){
    try{
      rec=new SR();rec.continuous=true;rec.interimResults=true;rec.lang='en-US';
      rec.onresult=function(ev){
        var txt='';for(var i=0;i<ev.results.length;i++)txt+=ev.results[i][0].transcript+' ';
        var st=document.getElementById('mlStatus');
        if(st)st.textContent='Heard: “…'+txt.trim().slice(-60)+'”';
        if(phraseMatches(txt))finish(true);
      };
      rec.onerror=function(ev){var st=document.getElementById('mlStatus');if(st)st.textContent='Mic problem ('+ev.error+') — type the phrase below instead.';};
      rec.onend=function(){ if(keep&&!done){try{rec.start();}catch(e){}} };
      rec.start();
    }catch(e){}
  }
  document.getElementById('mlUnlock').onclick=function(){
    if(normPhrase(document.getElementById('mlTyped').value)===PHRASE)finish(true);
    else toast('That’s not the phrase — it’s: I am done with my test');
  };
  document.getElementById('mlTyped').addEventListener('keydown',function(ev){if(ev.key==='Enter')document.getElementById('mlUnlock').click();});
  document.getElementById('mlCancel').onclick=function(){finish(false);};
}

/* ---------- Master button in the appbar ---------- */
var btn=null;
function renderBtn(){
  if(!btn)return;
  btn.textContent=armed?'🔒 Locked in':'🔒 Master';
  btn.style.background=armed?'#E2F7F3':'';
  btn.style.borderColor=armed?'#1FBFAB':'';
  btn.style.color=armed?'#0E9C8B':'';
  btn.style.fontWeight=armed?'700':'';
}
function arm(){
  if(armed)return;
  ensureCtx(); // created on this click so the alarm is allowed later, even from a background tab
  loadBuf();
  if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){ // ask for the mic NOW so speak-to-unlock works later
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){s.getTracks().forEach(function(t){t.stop();});})
      .catch(function(){toast('Mic blocked — you can still unlock by typing the phrase');});
  }
  var n=5;clearInterval(count);
  if(btn)btn.textContent='🔒 '+n;
  toast('Master lock arms in 5 seconds…');
  count=setInterval(function(){n--;
    if(n<=0){clearInterval(count);count=null;
      armed=true;writeArmed();renderBtn();
      toast('Master lock ON — leaving this tab or clicking off the browser sounds the alarm. Say “I am done with my test” to unlock.',4200);
    }else if(btn)btn.textContent='🔒 '+n;
  },1000);
}
function disarm(silent){
  clearInterval(count);count=null;
  var was=armed;
  armed=false;writeArmed();
  stopAlarm(true);renderBtn();
  if(was&&!silent)toast('Master lock is off');
}
function injectBtn(){
  var bar=document.querySelector('.appbar');if(!bar)return;
  btn=document.createElement('button');
  btn.className='iconbtn';
  btn.title='Master lock — voice alarm the moment you leave this tab or click off the browser, on any page of this site. Say “I am done with my test” to unlock.';
  btn.style.cursor='pointer';
  var spacer=bar.querySelector('.spacer');
  if(spacer&&spacer.nextSibling)bar.insertBefore(btn,spacer.nextSibling);
  else bar.appendChild(btn);
  btn.onclick=function(){
    if(armed){openUnlockModal();return;}
    if(count){clearInterval(count);count=null;renderBtn();toast('Master lock cancelled');return;}
    arm();
  };
  renderBtn();
}

/* another tab arming/disarming the lock updates this page instantly */
window.addEventListener('storage',function(e){
  if(e.key!==KEY)return;
  armed=readArmed();renderBtn();
  if(!armed)stopAlarm(true);
});

/* ---------- boot ---------- */
function boot(){
  injectBtn();
  armed=readArmed();
  if(armed){
    renderBtn();
    toast('Master lock is ON — say “I am done with my test” to unlock.',3600);
    // the browser only lets sound start after the first tap/click on the page
    document.addEventListener('pointerdown',function(){ensureCtx();loadBuf();},{once:true});
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
else boot();
})();
