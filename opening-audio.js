// COCOMITalk - オープニングの音（Web Audio 合成）
// このファイルはオープニング用の効果音とパッドを合成して鳴らす。外部の音声ファイル・通信は使わない
// v1.0 2026-10-29 - cocomi_opening_v3.html から移植（音の内容は元のまま）。close()でAudioContextを必ず閉じる
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
(function () {
  /** 再生を開始して {setMuted, close} を返す。AudioContextが作れなければ null（映像だけで続行する） */
  function create(muted) {
    var AC = null, master = null;
  try{AC=new (window.AudioContext||window.webkitAudioContext)()}catch(e){return null}
  master=AC.createGain();master.gain.value=muted?0:.8;master.connect(AC.destination);
  try{if(AC.state==='suspended'&&AC.resume)AC.resume()}catch(e){}
  try{ // 組み立て中に失敗したらcloseして映像だけで続行
  var now=AC.currentTime+.05;
  // reverb-ish delay
  var dl=AC.createDelay();dl.delayTime.value=.33;var fb=AC.createGain();fb.gain.value=.38;var wet=AC.createGain();wet.gain.value=.35;dl.connect(fb);fb.connect(dl);dl.connect(wet);wet.connect(master);
  function tone(f,t0,dur,type,vol,dest){var o=AC.createOscillator(),g=AC.createGain();o.type=type;o.frequency.value=f;g.gain.setValueAtTime(0,now+t0);g.gain.linearRampToValueAtTime(vol,now+t0+.02);g.gain.exponentialRampToValueAtTime(.0001,now+t0+dur);o.connect(g);g.connect(dest||master);g.connect(dl);o.start(now+t0);o.stop(now+t0+dur+.1)}
  // pad swell
  [110,164.8,220,277.2].forEach(function(f,i){var o=AC.createOscillator(),g=AC.createGain(),lp=AC.createBiquadFilter();o.type='sawtooth';o.frequency.value=f;o.detune.value=(i-1.5)*6;lp.type='lowpass';lp.frequency.setValueAtTime(200,now);lp.frequency.linearRampToValueAtTime(1800,now+12);lp.frequency.linearRampToValueAtTime(700,now+18);g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(.035,now+11.8);g.gain.linearRampToValueAtTime(.05,now+14);g.gain.linearRampToValueAtTime(0,now+19);o.connect(lp);lp.connect(g);g.connect(master);g.connect(dl);o.start(now);o.stop(now+19.5)});
  // spark blips (act1 blinks / hop) and weaving plucks
  tone(1318,1.0,.6,'sine',.08);tone(1760,2.3,.25,'sine',.05);tone(1568,3.35,.25,'sine',.05);tone(988,3.65,.3,'triangle',.06);tone(1480,4.5,.35,'triangle',.06);
  var scale=[659,784,880,988,1175,1318,1568,1760,1975,2349,2637,3136];
  for(var i=0;i<12;i++)tone(scale[i],4.6+(i+.9)*(5.8/12),.9,'sine',.05);
  // lock + chime + bass hit at the reveal
  tone(55,12.05,2.8,'sine',.55);tone(110,12.05,1.2,'triangle',.15);
  [1046,1318,1568,2093].forEach(function(f,i){tone(f,12.05+i*.03,3.5,'sine',.06)});
  tone(41.2,13.4,3.5,'sine',.45);[523,784,1046].forEach(function(f,i){tone(f,13.45+i*.12,4,'sine',.045)});
  // noise whoosh into flash
  var len=AC.sampleRate*2,buf=AC.createBuffer(1,len,AC.sampleRate),dd=buf.getChannelData(0);for(var n=0;n<len;n++)dd[n]=Math.random()*2-1;
  var src=AC.createBufferSource(),bp=AC.createBiquadFilter(),ng=AC.createGain();src.buffer=buf;bp.type='bandpass';bp.Q.value=1.2;bp.frequency.setValueAtTime(300,now+10.2);bp.frequency.exponentialRampToValueAtTime(4000,now+12);ng.gain.setValueAtTime(0,now+10.2);ng.gain.linearRampToValueAtTime(.12,now+11.9);ng.gain.exponentialRampToValueAtTime(.0001,now+12.3);src.connect(bp);bp.connect(ng);ng.connect(master);src.start(now+10.2);
  }catch(e){try{AC.close()}catch(e2){}AC=null;return null}
    return {
      setMuted: function (m) {
        try { master.gain.setTargetAtTime(m ? 0 : .8, AC.currentTime, .05); } catch (e) { /* 無視 */ }
      },
      close: function () {
        var c = AC; AC = null;
        try { if (c && c.close) { var p = c.close(); if (p && p.catch) p.catch(function () {}); } } catch (e) { /* 無視 */ }
      },
    };
  }

  window.CocomiOpeningAudio = { create: create };
})();
