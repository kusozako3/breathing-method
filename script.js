/* ====================================================================
       呼吸ガイドアプリ - メインスクリプト
       ==================================================================== */

    // ============================================
    // DOM要素の取得
    // ============================================
    const $ = (id) => document.getElementById(id);
    const circleOuter  = $('circleOuter');
    const circleInner  = $('circleInner');
    const circleGlow   = $('circleGlow');
    const phaseLabel   = $('phaseLabel');
    const timerLabel   = $('timerLabel');
    const btnStart     = $('btnStart');
    const cycleCountEl = $('cycleCount');
    const soundToggle  = $('soundToggle');
    const customPanel  = $('customPanel');

    // バッジ要素
    const badgeInhale = $('badgeInhale');
    const badgeHold   = $('badgeHold');
    const badgeExhale = $('badgeExhale');
    const badgeWait   = $('badgeWait');

    // カスタム入力要素
    const inputInhale = $('inputInhale');
    const inputHold   = $('inputHold');
    const inputExhale = $('inputExhale');
    const inputWait   = $('inputWait');

    // ============================================
    // プリセット定義
    // ============================================
    const PRESETS = {
      '478': { inhale: 4, hold: 7, exhale: 8, wait: 0 },
      'box': { inhale: 4, hold: 4, exhale: 4, wait: 4 },
    };

    // ============================================
    // 呼吸フェーズ定義
    // ============================================
    const PHASES = [
      { key: 'inhale', label: '吸って',  soundType: 'A' },
      { key: 'hold',   label: '止めて',  soundType: 'B' },
      { key: 'exhale', label: '吐いて',  soundType: 'C' },
      { key: 'wait',   label: '止めて',  soundType: 'B' },
    ];

    // ============================================
    // アプリケーション状態
    // ============================================
    let state = {
      running: false,          // 実行中フラグ
      currentPreset: '478',    // 現在のプリセット
      settings: { ...PRESETS['478'] }, // 現在の設定（実行時反映用）
      pendingSettings: null,   // 次サイクルで適用する設定
      phaseIndex: 0,           // 現在のフェーズインデックス
      phaseStartTime: 0,       // フェーズ開始時刻
      phaseDuration: 0,        // フェーズの長さ（ミリ秒）
      cycleCount: 0,           // 完了サイクル数
      animFrameId: null,       // requestAnimationFrame ID
      soundEnabled: true,      // 音声ON/OFF
    };

    // ============================================
    // Screen Wake Lock API - スリープ防止
    // ============================================
    let wakeLock = null;

    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => {
            console.log('Screen Wake Lock released');
          });
          console.log('Screen Wake Lock active');
        }
      } catch (err) {
        console.warn(`Wake Lock error: ${err.name}, ${err.message}`);
      }
    }

    async function releaseWakeLock() {
      if (wakeLock !== null) {
        await wakeLock.release();
        wakeLock = null;
      }
    }

    // ============================================
    // Web Audio API - 音声生成
    // AudioContextを利用してプログラムで音を生成する
    // 外部音声ファイル不要で遅延が少ない
    // ============================================
    let audioCtx = null;

    /**
     * AudioContextを初期化する
     * ユーザー操作に応じて1度だけ呼ぶ
     */
    function initAudio() {
      try {
        if (!audioCtx) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) return;
          
          audioCtx = new AudioContext();
          
          // モバイル向けに無音を再生してAudioContextを完全にアンロックする
          if (audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
          try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            gain.gain.value = 0;
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(0);
            osc.stop(0.01);
          } catch(e) {}
        } else if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
      } catch (err) {
        console.warn('Audio initialization failed:', err);
      }
    }

    /**
     * 音を再生する
     * @param {'A'|'B'|'C'} type - 音の種類
     *   A: 吸う（上昇トーン）
     *   B: ホールド/ウェイト（穏やかなトーン）
     *   C: 吐く（下降トーン）
     */
    function playSound(type) {
      if (!state.soundEnabled || !audioCtx) return;

      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        const now = audioCtx.currentTime;

        switch (type) {
          case 'A': // 吸う - 上昇するサイン波
            osc.type = 'sine';
            osc.frequency.setValueAtTime(330, now);
            osc.frequency.linearRampToValueAtTime(520, now + 0.25);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            osc.start(now);
            osc.stop(now + 0.4);
            break;

          case 'B': // ホールド/ウェイト - 穏やかなトーン
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, now);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
            break;

          case 'C': // 吐く - 下降するサイン波
            osc.type = 'sine';
            osc.frequency.setValueAtTime(520, now);
            osc.frequency.linearRampToValueAtTime(260, now + 0.35);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
            osc.start(now);
            osc.stop(now + 0.45);
            break;
        }
      } catch (e) {
        // 音声再生エラーは無視（アプリ動作に影響させない）
        console.warn('音声再生エラー:', e);
      }
    }

    // ============================================
    // localStorage 保存・復元
    // ============================================
    const STORAGE_KEY = 'breathGuideSettings';

    /**
     * 設定をlocalStorageに保存する
     */
    function saveSettings() {
      try {
        const data = {
          preset: state.currentPreset,
          custom: {
            inhale: parseInt(inputInhale.value) || 4,
            hold:   parseInt(inputHold.value) || 0,
            exhale: parseInt(inputExhale.value) || 4,
            wait:   parseInt(inputWait.value) || 0,
          },
          soundEnabled: state.soundEnabled,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn('設定の保存に失敗:', e);
      }
    }

    /**
     * localStorageから設定を復元する
     */
    function loadSettings() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);

        // プリセット復元
        if (data.preset) {
          state.currentPreset = data.preset;
        }

        // カスタム入力値復元
        if (data.custom) {
          inputInhale.value = data.custom.inhale !== undefined ? data.custom.inhale : 4;
          inputHold.value   = data.custom.hold !== undefined ? data.custom.hold : 0;
          inputExhale.value = data.custom.exhale !== undefined ? data.custom.exhale : 4;
          inputWait.value   = data.custom.wait !== undefined ? data.custom.wait : 0;
        }

        // 音声設定復元
        if (data.soundEnabled !== undefined) {
          state.soundEnabled = data.soundEnabled;
        }
      } catch (e) {
        console.warn('設定の読み込みに失敗:', e);
      }
    }

    // ============================================
    // 設定の取得・反映
    // ============================================

    /**
     * 現在の選択に基づいた設定値を取得する
     * @returns {{ inhale: number, hold: number, exhale: number, wait: number }}
     */
    function getCurrentConfig() {
      if (state.currentPreset === 'custom') {
        return {
          inhale: Math.max(0, parseInt(inputInhale.value) || 0),
          hold:   Math.max(0, parseInt(inputHold.value) || 0),
          exhale: Math.max(0, parseInt(inputExhale.value) || 0),
          wait:   Math.max(0, parseInt(inputWait.value) || 0),
        };
      }
      return { ...PRESETS[state.currentPreset] };
    }

    /**
     * 設定バッジのUIを更新する
     */
    function updateBadges() {
      const cfg = getCurrentConfig();
      badgeInhale.textContent = cfg.inhale;
      badgeHold.textContent   = cfg.hold;
      badgeExhale.textContent = cfg.exhale;
      badgeWait.textContent   = cfg.wait;
    }

    /**
     * プリセットボタンのアクティブ状態を更新する
     */
    function updatePresetButtons() {
      document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === state.currentPreset);
      });
      // カスタムパネルの表示切替
      customPanel.classList.toggle('visible', state.currentPreset === 'custom');
    }

    // ============================================
    // 円アニメーション制御
    // ============================================

    /**
     * 円の内側を指定された割合で描画する
     * @param {number} ratio - 0〜1の割合（0=完全に縮小、1=完全に拡大）
     * @param {string} phase - 現在のフェーズキー
     */
    function updateCircle(ratio, phase) {
      const pct = ratio * 92; // 最大92%（余白を残す）

      switch (phase) {
        case 'inhale': {
          // 吸う: 青色が外側に広がる
          circleInner.style.width  = pct + '%';
          circleInner.style.height = pct + '%';
          circleInner.style.opacity = '1';
          circleInner.style.background = `radial-gradient(circle, 
            hsl(217, 91%, 65%) 0%, 
            hsl(217, 80%, 50%) 60%, 
            hsl(217, 65%, 30%) 100%)`;
          break;
        }

        case 'hold': {
          // ホールド: 鮮やかな青 → 濁った青に変化
          circleInner.style.width  = 92 + '%';
          circleInner.style.height = 92 + '%';
          circleInner.style.opacity = '1';
          // ratioが0→1で進行。彩度と明度を下げる
          const sat = 91 - ratio * 40;   // 91% → 51%
          const lit = 65 - ratio * 20;   // 65% → 45%
          circleInner.style.background = `radial-gradient(circle, 
            hsl(217, ${sat}%, ${lit}%) 0%, 
            hsl(217, ${sat - 10}%, ${lit - 10}%) 60%, 
            hsl(217, ${sat - 25}%, ${lit - 20}%) 100%)`;
          break;
        }

        case 'exhale': {
          // 吐く: 円が縮小する
          const shrink = (1 - ratio) * 92;
          circleInner.style.width  = shrink + '%';
          circleInner.style.height = shrink + '%';
          circleInner.style.opacity = 1 - ratio * 0.3;
          circleInner.style.background = `radial-gradient(circle, 
            hsl(217, 51%, 45%) 0%, 
            hsl(217, 41%, 35%) 60%, 
            hsl(217, 26%, 25%) 100%)`;
          break;
        }

        case 'wait': {
          // ウェイト: 透明にする
          circleInner.style.width  = '0%';
          circleInner.style.height = '0%';
          circleInner.style.opacity = '0';
          break;
        }
      }
    }

    /**
     * 円をリセット状態にする
     */
    function resetCircle() {
      circleInner.style.width   = '0%';
      circleInner.style.height  = '0%';
      circleInner.style.opacity = '0';
      circleGlow.classList.remove('active');
      circleOuter.classList.add('idle');
    }

    // ============================================
    // メインアニメーションループ
    // ============================================

    /**
     * フェーズを開始する
     * @param {number} index - フェーズインデックス (0-3)
     */
    function startPhase(index) {
      // サイクル先頭(index=0)で保留設定を適用
      if (index === 0 && state.pendingSettings) {
        state.settings = { ...state.pendingSettings };
        state.pendingSettings = null;
        updateBadges();
      }

      // 全フェーズが0秒の場合の無限再帰防止
      const totalDuration = state.settings.inhale + state.settings.hold
                          + state.settings.exhale + state.settings.wait;
      if (totalDuration === 0) {
        stop();
        return;
      }

      const phase = PHASES[index];
      const durationKey = phase.key === 'wait' ? 'wait' :
                          phase.key === 'inhale' ? 'inhale' :
                          phase.key === 'hold' ? 'hold' : 'exhale';
      const duration = state.settings[durationKey];

      // duration が 0 の場合はスキップ
      if (duration === 0) {
        // phaseIndexを更新してからadvancePhaseを呼ぶ
        state.phaseIndex = index;
        advancePhase();
        return;
      }

      state.phaseIndex = index;
      state.phaseDuration = duration * 1000;
      state.phaseStartTime = Date.now();

      // テキスト更新
      phaseLabel.textContent = phase.label;

      // 音声再生
      playSound(phase.soundType);

      // グロー効果
      circleGlow.classList.toggle('active', phase.key === 'inhale' || phase.key === 'hold');

      // アニメーションループ開始
      tick();
    }

    /**
     * 毎フレームの更新処理
     */
    function tick() {
      if (!state.running) return;

      const elapsed = Date.now() - state.phaseStartTime;
      const ratio = Math.min(elapsed / state.phaseDuration, 1);

      // 円アニメーション更新
      const phase = PHASES[state.phaseIndex];
      updateCircle(ratio, phase.key);

      // タイマーラベル更新（残り秒数を表示）
      const remaining = Math.ceil((state.phaseDuration - elapsed) / 1000);
      timerLabel.textContent = remaining > 0 ? remaining + ' 秒' : '';

      if (ratio >= 1) {
        // フェーズ完了 → 次フェーズへ
        advancePhase();
      } else {
        const rAF = window.requestAnimationFrame || window.webkitRequestAnimationFrame || (cb => setTimeout(cb, 16));
        state.animFrameId = rAF(tick);
      }
    }

    /**
     * 次のフェーズに進む
     */
    function advancePhase() {
      const nextIndex = (state.phaseIndex + 1) % 4;

      // 1サイクル完了時（waitの次 = inhale）
      if (nextIndex === 0) {
        state.cycleCount++;
        cycleCountEl.textContent = state.cycleCount;
      }

      startPhase(nextIndex);
    }

    // ============================================
    // 開始・停止制御
    // ============================================

    /**
     * 呼吸ガイドを開始する
     */
    function start() {
      initAudio();
      requestWakeLock(); // スリープ防止をリクエスト
      state.running = true;
      state.phaseIndex = 0;
      state.cycleCount = 0;
      cycleCountEl.textContent = '0';
      state.settings = getCurrentConfig();
      state.pendingSettings = null;

      // UIの切り替え
      circleOuter.classList.remove('idle');
      btnStart.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24"><rect x="5" y="3" width="5" height="18" rx="1"/><rect x="14" y="3" width="5" height="18" rx="1"/></svg>`;
      btnStart.classList.remove('btn-start');
      btnStart.classList.add('btn-stop');
      btnStart.setAttribute('aria-label', '停止');

      startPhase(0);
    }

    /**
     * 呼吸ガイドを停止してリセットする
     */
    function stop() {
      state.running = false;
      state.pendingSettings = null;
      releaseWakeLock(); // スリープ防止を解除

      // アニメーション停止
      if (state.animFrameId) {
        const cAF = window.cancelAnimationFrame || window.webkitCancelAnimationFrame || clearTimeout;
        cAF(state.animFrameId);
        state.animFrameId = null;
      }

      // UI リセット
      phaseLabel.textContent = '準備完了';
      timerLabel.textContent = '';
      resetCircle();

      btnStart.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24"><polygon points="6,3 20,12 6,21"/></svg>`;
      btnStart.classList.remove('btn-stop');
      btnStart.classList.add('btn-start');
      btnStart.setAttribute('aria-label', '開始');
    }

    // ============================================
    // イベントリスナー
    // ============================================

    // 開始/停止ボタン
    btnStart.addEventListener('click', () => {
      if (state.running) {
        stop();
      } else {
        start();
      }
    });

    // プリセットボタン群
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.currentPreset = btn.dataset.preset;
        updatePresetButtons();
        updateBadges();
        saveSettings();

        // 実行中は次サイクルから反映するために保留設定をセット
        if (state.running) {
          state.pendingSettings = getCurrentConfig();
        }
      });
    });

    // カスタム入力値変更時
    [inputInhale, inputHold, inputExhale, inputWait].forEach(input => {
      input.addEventListener('change', () => {
        // 値のバリデーション： 0〜30の範囲にクランプ
        let val = parseInt(input.value);
        if (isNaN(val) || val < 0) val = 0;
        if (val > 30) val = 30;
        input.value = val;

        updateBadges();
        saveSettings();

        // 実行中は次サイクルから反映
        if (state.running) {
          state.pendingSettings = getCurrentConfig();
        }
      });
    });

    // 音声トグルボタン
    soundToggle.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      soundToggle.textContent = state.soundEnabled ? '🔔' : '🔕';
      soundToggle.classList.toggle('muted', !state.soundEnabled);
      saveSettings();
    });

    // ページ表示状態の変更（バックグラウンドから復帰した際にWake Lockを再取得するため）
    document.addEventListener('visibilitychange', () => {
      // 復帰時に実行中の場合は再度リクエスト
      if (document.visibilityState === 'visible' && state.running) {
        requestWakeLock();
      }
    });

    // ============================================
    // 初期化
    // ============================================
    (function init() {
      // 保存された設定を復元
      loadSettings();

      // UI反映
      updatePresetButtons();
      updateBadges();
      soundToggle.textContent = state.soundEnabled ? '🔔' : '🔕';
      soundToggle.classList.toggle('muted', !state.soundEnabled);
    })();