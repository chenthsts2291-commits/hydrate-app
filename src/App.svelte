<script>
  import { onMount } from 'svelte';
  import { calculateTernaryEnergySurface, calculateStability, inter } from './vdwp_core.js';

  // --- 初期設定 ---
  let temp = 273.15;
  let press = 50.0;
  
  let available_gases = Object.keys(inter).sort();
  let gas_a = "Methane";
  let gas_b = "Ethane";
  let gas_c = "CF4";

  let analysisMax = { val: 0, a: 0, b: 0, c: 0, hasSynergy: false };
  let analysisMin = { val: 0, a: 0, b: 0, c: 0, hasSynergy: false };
  
  let Plotly;

  // ==========================================
  // ★ シナジー検索ツール用の変数と状態
  // ==========================================
  let showSearchModal = false;
  let searchMode = 'gases'; // 'gases' or 'pt'
  let isSearching = false;
  let searchResults = [];

  let s_gas_a = "Methane", s_gas_b = "Ethane", s_gas_c = "CF4";
  let s_temp = 273.15, s_press = 50.0;

  const EPSILON = 0.005;

  // ==========================================
  // ★ 補助関数: 2成分系の最大値(sII)と最小値(sI)
  // ==========================================
  function getBinaryMax(name1, name2, P, T, steps = 100) {
    let maxBinary = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const frac1 = i / steps;
      const diff = calculateStability(name1, name2, frac1, 1.0 - frac1, P, T);
      if (diff !== null && diff > maxBinary) maxBinary = diff;
    }
    return maxBinary;
  }

  function getBinaryMin(name1, name2, P, T, steps = 100) {
    let minBinary = Infinity;
    for (let i = 0; i <= steps; i++) {
      const frac1 = i / steps;
      const diff = calculateStability(name1, name2, frac1, 1.0 - frac1, P, T);
      if (diff !== null && diff < minBinary) minBinary = diff;
    }
    return minBinary;
  }

  // ==========================================
  // ★ 検索ロジック (偽陽性を防ぐ完全版)
  // ==========================================
  async function runAdvancedSearch() {
    isSearching = true;
    searchResults = [];
    await new Promise(resolve => setTimeout(resolve, 50));

    const N = available_gases.length;

    // 全ガス走査時の高速化キャッシュ
    let binMaxCache = {};
    let binMinCache = {};
    if (searchMode === 'pt') {
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
           const g1 = available_gases[i], g2 = available_gases[j];
           const key = [g1, g2].sort().join('-');
           binMaxCache[key] = getBinaryMax(g1, g2, s_press, s_temp, 30);
           binMinCache[key] = getBinaryMin(g1, g2, s_press, s_temp, 30);
        }
      }
    }

    const getCachedMax = (g1, g2, p, t) => {
      if (searchMode === 'pt') return binMaxCache[[g1, g2].sort().join('-')];
      return getBinaryMax(g1, g2, p, t, 30);
    };
    const getCachedMin = (g1, g2, p, t) => {
      if (searchMode === 'pt') return binMinCache[[g1, g2].sort().join('-')];
      return getBinaryMin(g1, g2, p, t, 30);
    };

    if (searchMode === 'gases') {
      const targetGases = [s_gas_a, s_gas_b, s_gas_c];
      for (let t = 200; t <= 300; t += 5) {
        for (let p = 10; p <= 200; p += 10) {
          evaluateSynergyForSearch(targetGases[0], targetGases[1], targetGases[2], p, t);
        }
      }
    } else {
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          for (let k = j + 1; k < N; k++) {
            evaluateSynergyForSearch(available_gases[i], available_gases[j], available_gases[k], s_press, s_temp);
          }
        }
      }
    }

    function evaluateSynergyForSearch(g1, g2, g3, p, t) {
      // 2成分の限界値を計算
      const mAB_max = getCachedMax(g1, g2, p, t);
      const mBC_max = getCachedMax(g2, g3, p, t);
      const mCA_max = getCachedMax(g1, g3, p, t);
      const mBinMax = Math.max(mAB_max, mBC_max, mCA_max);

      const mAB_min = getCachedMin(g1, g2, p, t);
      const mBC_min = getCachedMin(g2, g3, p, t);
      const mCA_min = getCachedMin(g1, g3, p, t);
      const mBinMin = Math.min(mAB_min, mBC_min, mCA_min);

      const res = calculateTernaryEnergySurface(g1, g2, g3, p, t, 15);
      
      let locMax = { val: -Infinity, idx: -1 };
      let locMin = { val: Infinity, idx: -1 };
      for (let idx = 0; idx < res.flat.z.length; idx++) {
        const z = res.flat.z[idx];
        if (z !== null) {
          if (z > locMax.val) locMax = { val: z, idx };
          if (z < locMin.val) locMin = { val: z, idx };
        }
      }

      const calcComp = (idx) => {
        const px = res.flat.x[idx];
        const py = res.flat.y[idx];
        const c = py / 0.866025;
        const b = px - 0.5 * c;
        return { a: Math.max(0, 1.0 - b - c), b: Math.max(0, b), c: Math.max(0, c) };
      };

      let foundSynergy = false;
      let synergyType = "";
      let compStr = "";

      const maxC = calcComp(locMax.idx);
      const minC = calcComp(locMin.idx);

      // ★ 偽陽性防止：組成が内側(>0)であり、かつエネルギーがエッジを確実に上回る(下回る)こと！
      if (maxC.a > EPSILON && maxC.b > EPSILON && maxC.c > EPSILON && locMax.val > mBinMax + 0.001) {
        foundSynergy = true; synergyType = "sII優位";
        compStr = `${g1}:${(maxC.a*100).toFixed(0)}% ${g2}:${(maxC.b*100).toFixed(0)}% ${g3}:${(maxC.c*100).toFixed(0)}%`;
      } else if (minC.a > EPSILON && minC.b > EPSILON && minC.c > EPSILON && locMin.val < mBinMin - 0.001) {
        foundSynergy = true; synergyType = "sI優位";
        compStr = `${g1}:${(minC.a*100).toFixed(0)}% ${g2}:${(minC.b*100).toFixed(0)}% ${g3}:${(minC.c*100).toFixed(0)}%`;
      }

      if (foundSynergy) {
        searchResults.push({ temp: t, press: p, gases: [g1, g2, g3], type: synergyType, comp: compStr });
      }
    }

    isSearching = false;
  }

  function applyResultToMain(result) {
    gas_a = result.gases[0];
    gas_b = result.gases[1];
    gas_c = result.gases[2];
    temp = result.temp;
    press = result.press;
    showSearchModal = false;
    draw();
  }

  // ==========================================
  // ★ メイン描画ロジック
  // ==========================================
  async function draw() {
    if (!Plotly) return;

    const res = calculateTernaryEnergySurface(gas_a, gas_b, gas_c, press, temp, 60);

    let maxZ = -Infinity;
    let minZ = Infinity;
    let maxIdx = -1;
    let minIdx = -1;
    
    for (let i = 0; i < res.flat.z.length; i++) {
      const z = res.flat.z[i];
      if (z !== null) {
        if (z > maxZ) { maxZ = z; maxIdx = i; }
        if (z < minZ) { minZ = z; minIdx = i; }
      }
    }

    // 2成分の限界値を精密に計算
    const maxBinary = Math.max(getBinaryMax(gas_a, gas_b, press, temp), getBinaryMax(gas_b, gas_c, press, temp), getBinaryMax(gas_c, gas_a, press, temp));
    const minBinary = Math.min(getBinaryMin(gas_a, gas_b, press, temp), getBinaryMin(gas_b, gas_c, press, temp), getBinaryMin(gas_c, gas_a, press, temp));

    const maxAbs = Math.max(Math.abs(maxZ), Math.abs(minZ), 0.1); 
    const discreteColorscale = [ [0.0, '#008080'], [0.5, '#008080'], [0.5, '#FF8C00'], [1.0, '#FF8C00'] ];

    if (maxIdx !== -1) {
      const px = res.flat.x[maxIdx]; const py = res.flat.y[maxIdx];
      const c = py / 0.866025; const b = px - 0.5 * c; const a = 1.0 - b - c;
      const compA = Math.max(0, a); const compB = Math.max(0, b); const compC = Math.max(0, c);
      
      // ★ 厳格なシナジー判定（組成＆エネルギーのダブルチェック）
      const hasSynergyMax = compA > EPSILON && compB > EPSILON && compC > EPSILON && (maxZ > maxBinary + 0.0005);

      analysisMax = { val: maxZ, a: compA, b: compB, c: compC, hasSynergy: hasSynergyMax };
    }

    if (minIdx !== -1) {
      const px = res.flat.x[minIdx]; const py = res.flat.y[minIdx];
      const c = py / 0.866025; const b = px - 0.5 * c; const a = 1.0 - b - c;
      const compA = Math.max(0, a); const compB = Math.max(0, b); const compC = Math.max(0, c);

      // ★ 厳格なシナジー判定（組成＆エネルギーのダブルチェック）
      const hasSynergyMin = compA > EPSILON && compB > EPSILON && compC > EPSILON && (minZ < minBinary - 0.0005);

      analysisMin = { val: minZ, a: compA, b: compB, c: compC, hasSynergy: hasSynergyMin };
    }

    const meshTrace = {
      type: 'mesh3d', x: res.flat.x, y: res.flat.y, z: res.flat.z,
      intensity: res.flat.z, cmin: -maxAbs, cmax: maxAbs, colorscale: discreteColorscale,
      showscale: true, colorbar: { title: '<b>構造</b>', tickvals: [-maxAbs/2, maxAbs/2], ticktext: ['sI安定', 'sII安定'] },
      hovertemplate: 'ΔμsI - ΔμsII: %{z:.3f} kJ/mol<extra></extra>', contour: { show: false } 
    };

    const contourTrace = {
      type: 'surface', x: res.matrix.x, y: res.matrix.y, z: res.matrix.z,
      showscale: false, opacity: 1.0, surfacecolor: res.matrix.z, cmin: -maxAbs, cmax: maxAbs,
      colorscale: discreteColorscale, hidesurface: true, 
      contours: { z: { show: true, usecolormap: false, project: { z: false }, color: 'black', width: 6, start: 0, end: 0, size: 1 }, x: { show: false }, y: { show: false } },
      hoverinfo: 'skip'
    };

    const zeroPlane = { type: 'mesh3d', x: [0, 1, 0.5], y: [0, 0, 0.866], z: [0, 0, 0], color: '#ffffff', opacity: 0.3, hoverinfo: 'skip' };

    const maxZ_plot = Math.max(maxZ, 0.5) + 0.5; 
    const layout = {
      title: `Ternary Phase Diagram (T=${temp}K, P=${press}bar)`, uirevision: 'true', 
      scene: {
        aspectratio: {x: 1, y: 0.866, z: 0.6},
        zaxis: { title: { text: '<b>ΔμsI - ΔμsII<br>[kJ/mol]</b>', font: {size: 13, color: '#333'} } },
        xaxis: {visible: false}, yaxis: {visible: false},
        annotations: [
          { x: 0, y: 0, z: maxZ_plot, text: `A: ${gas_a}`, showarrow:false, font:{size:14, color:'black'}, bgcolor:'rgba(255,255,255,0.8)' },
          { x: 1, y: 0, z: maxZ_plot, text: `B: ${gas_b}`, showarrow:false, font:{size:14, color:'black'}, bgcolor:'rgba(255,255,255,0.8)' },
          { x: 0.5, y: 0.866, z: maxZ_plot, text: `C: ${gas_c}`, showarrow:false, font:{size:14, color:'black'}, bgcolor:'rgba(255,255,255,0.8)' }
        ]
      }, margin: {t: 50, b: 0, l: 0, r: 0}, height: 600
    };

    Plotly.react('myDiv', [meshTrace, contourTrace, zeroPlane], layout);
  }

  onMount(async () => {
    const mod = await import('plotly.js-dist-min');
    Plotly = mod.default;
    draw();
  });
</script>

<main>
  <h1>3成分系ハイドレート探索AI ver.2.1.0</h1>

  <div class="action-row" style="margin-bottom: 25px;">
    <button class="discover-btn" on:click={() => { showSearchModal = true; searchResults = []; }}>
      🔍 高度なシナジー検索ツールを開く
    </button>
  </div>

  <div class="controls">
    <div class="row">
      <div class="gas-box">
        <label> <span class="mark bg-a">A</span> Gas A </label>
        <select bind:value={gas_a} on:change={draw}> {#each available_gases as g}<option>{g}</option>{/each} </select>
      </div>
      <div class="gas-box">
        <label> <span class="mark bg-b">B</span> Gas B </label>
        <select bind:value={gas_b} on:change={draw}> {#each available_gases as g}<option>{g}</option>{/each} </select>
      </div>
      <div class="gas-box">
        <label> <span class="mark bg-c">C</span> Gas C </label>
        <select bind:value={gas_c} on:change={draw}> {#each available_gases as g}<option>{g}</option>{/each} </select>
      </div>
    </div>
    
    <hr>
    
    <div class="sliders-container">
      <div class="control-group">
        <div class="label-row"> <span>Temp (K)</span> <input type="number" class="number-input" min="100" max="350" step="0.1" bind:value={temp} on:input={draw}> </div>
        <input type="range" min="100" max="350" step="0.5" bind:value={temp} on:input={draw}>
      </div>
      <div class="control-group">
        <div class="label-row"> <span>Total Pressure (bar)</span> <input type="number" class="number-input" min="1" max="500" step="1" bind:value={press} on:input={draw}> </div>
        <input type="range" min="1" max="500" step="1" bind:value={press} on:input={draw}>
      </div>
    </div>

    <div class="info-box {analysisMax.hasSynergy ? 'synergy-max' : ''}">
      <div class="info-header">
        <h3 style="color: #FF8C00;">🔴 sII 構造の最大安定度 (Δμ 最大値)</h3>
        {#if analysisMax.hasSynergy}
          <span class="synergy-badge-max">🌟 3成分シナジー</span>
        {/if}
      </div>
      
      <div class="info-row">
        <span><b>Max Value:</b> {analysisMax.val.toFixed(4)} kJ/mol</span>
        <span style="margin-left: 15px; font-weight: bold; color: {analysisMax.hasSynergy ? '#d35400' : '#7f8c8d'};">
          {#if !analysisMax.hasSynergy}
            (シナジーなし: エッジ上の2成分で十分)
          {/if}
        </span>
      </div>
      
      <div class="info-composition centered">
        <span style="color: #d63031;">A: {(analysisMax.a * 100).toFixed(1)}%</span>
        <span style="color: #0984e3;">B: {(analysisMax.b * 100).toFixed(1)}%</span>
        <span style="color: #00b894;">C: {(analysisMax.c * 100).toFixed(1)}%</span>
      </div>

      <hr class="inner-hr">

      <div class="info-header">
        <h3 style="color: #008080;">🔵 sI 構造の最大安定度 (Δμ 最小値)</h3>
        {#if analysisMin.hasSynergy}
          <span class="synergy-badge-min">🌟 3成分シナジー</span>
        {/if}
      </div>
      
      <div class="info-row">
        <span><b>Min Value:</b> {analysisMin.val.toFixed(4)} kJ/mol</span>
        <span style="margin-left: 15px; font-weight: bold; color: {analysisMin.hasSynergy ? '#16a085' : '#7f8c8d'};">
          {#if !analysisMin.hasSynergy}
            (シナジーなし: エッジ上の2成分で十分)
          {/if}
        </span>
      </div>
      
      <div class="info-composition centered">
        <span style="color: #d63031;">A: {(analysisMin.a * 100).toFixed(1)}%</span>
        <span style="color: #0984e3;">B: {(analysisMin.b * 100).toFixed(1)}%</span>
        <span style="color: #00b894;">C: {(analysisMin.c * 100).toFixed(1)}%</span>
      </div>
    </div>
  </div>

  <div id="myDiv"></div>

  <footer>
    <p>Okayama University | Naito Hisatoshi</p>
  </footer>
</main>

{#if showSearchModal}
  <div class="modal-overlay">
    <div class="modal-content">
      <div class="modal-header">
        <h2>🔍 高度なシナジー検索ツール</h2>
        <button class="close-btn" on:click={() => showSearchModal = false}>✕</button>
      </div>

      <div class="search-mode-selector">
        <label class={searchMode === 'gases' ? 'active-mode' : ''}>
          <input type="radio" bind:group={searchMode} value="gases"> 3成分を固定して検索 (温度・圧力を走査)
        </label>
        <label class={searchMode === 'pt' ? 'active-mode' : ''}>
          <input type="radio" bind:group={searchMode} value="pt"> 温度・圧力を固定して検索 (全ガスを走査)
        </label>
      </div>

      <div class="search-inputs">
        {#if searchMode === 'gases'}
          <p class="search-desc">指定した3つのガスにおいて、確実なシナジーが発現する温度(200~300K)・圧力(10~200bar)を探索します。</p>
          <div class="row">
            <select bind:value={s_gas_a}> {#each available_gases as g}<option>{g}</option>{/each} </select>
            <select bind:value={s_gas_b}> {#each available_gases as g}<option>{g}</option>{/each} </select>
            <select bind:value={s_gas_c}> {#each available_gases as g}<option>{g}</option>{/each} </select>
          </div>
        {:else}
          <p class="search-desc">指定した温度・圧力において、全ガス組み合わせの中から確実なシナジーを発現するものを探索します。</p>
          <div class="row" style="gap: 30px; justify-content: center;">
            <label>温度 (K): <input type="number" bind:value={s_temp} style="width: 100px; padding: 5px;"></label>
            <label>圧力 (bar): <input type="number" bind:value={s_press} style="width: 100px; padding: 5px;"></label>
          </div>
        {/if}
      </div>

      <button class="run-search-btn" on:click={runAdvancedSearch} disabled={isSearching}>
        {isSearching ? '⏳ 厳格な熱力学フィルターで総当たり計算中...' : '🚀 検索を実行する'}
      </button>

      <div class="search-results">
        {#if isSearching}
          <div class="loading-text">計算しています。数秒お待ちください...</div>
        {:else if searchResults.length > 0}
          <h4>🎯 発見された完全な3成分シナジー条件 ({searchResults.length} 件)</h4>
          <ul class="result-list">
            {#each searchResults as res}
              <li class="result-item">
                <div class="res-info">
                  <span class="res-badge {res.type === 'sII優位' ? 'badge-sII' : 'badge-sI'}">{res.type}</span>
                  <b>T:</b> {res.temp} K, <b>P:</b> {res.press} bar<br>
                  <b>組成:</b> <span style="color: #555;">{res.comp}</span>
                </div>
                <button class="apply-btn" on:click={() => applyResultToMain(res)}>メイン画面に反映 ➔</button>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="loading-text" style="color: #7f8c8d;">
            (ここに検索結果が表示されます。条件によっては見つからない場合があります)
          </div>
        {/if}
      </div>

    </div>
  </div>
{/if}

<style>
  main { max-width: 900px; margin: 0 auto; padding: 20px; font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; }
  h1 { text-align: center; margin-bottom: 30px; font-size: 1.8rem; color: #2c3e50; }
  
  .controls { background: #fff; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); margin-bottom: 30px; border: 1px solid #eee; }
  
  .row { display: flex; gap: 20px; justify-content: space-between; flex-wrap: wrap; }
  .gas-box { flex: 1; min-width: 200px; display: flex; flex-direction: column; }
  label { font-weight: bold; font-size: 0.9rem; margin-bottom: 5px; display: flex; align-items: center; gap: 8px; }
  select { padding: 10px; border-radius: 6px; border: 1px solid #ddd; background: #fafafa; font-size: 1rem; cursor: pointer; }
  
  .mark { padding: 4px 10px; border-radius: 4px; color: white; font-size: 0.8rem; font-weight: bold; }
  .bg-a { background-color: #d63031; } 
  .bg-b { background-color: #0984e3; } 
  .bg-c { background-color: #00b894; } 
  
  hr { border: 0; border-top: 1px solid #eee; margin: 25px 0; }
  
  .sliders-container { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 20px; }
  .control-group { display: flex; flex-direction: column; gap: 10px; }
  .label-row { display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #555; font-size: 0.95rem; }
  .number-input { width: 80px; padding: 6px; border: 1px solid #ccc; border-radius: 4px; text-align: right; font-size: 1rem; }
  input[type=range] { width: 100%; cursor: pointer; height: 6px; background: #ddd; border-radius: 5px; outline: none; -webkit-appearance: none; }
  
  .action-row { display: flex; justify-content: center; }
  .discover-btn { 
    background: linear-gradient(135deg, #6c5ce7, #a29bfe); color: white; border: none; 
    padding: 12px 30px; border-radius: 30px; font-size: 1.1rem; font-weight: bold; 
    cursor: pointer; box-shadow: 0 4px 10px rgba(108, 92, 231, 0.3); transition: transform 0.2s;
  }
  .discover-btn:hover { transform: scale(1.05); }

  .info-box { background: #f8f9fa; padding: 15px 20px; border-radius: 8px; border-left: 5px solid #bdc3c7; transition: all 0.3s ease; }
  .info-box h3 { margin: 0 0 10px 0; font-size: 1rem; letter-spacing: 0.5px; }
  .info-composition { display: flex; gap: 20px; margin-top: 5px; font-weight: bold; font-size: 1.1rem; }
  
  .centered { justify-content: center; margin-top: 10px; }
  .synergy-max { border-left: 5px solid #FF8C00; background: #fffcf5; }
  
  .info-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
  .synergy-badge-max { background: #FF8C00; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; }
  .synergy-badge-min { background: #008080; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; }
  
  .inner-hr { border-top: 1px dashed #ccc; margin: 15px 0; }
  #myDiv { border-radius: 8px; overflow: hidden; border: 1px solid #eee; }
  footer { margin-top: 40px; text-align: right; color: #aaa; font-size: 0.9rem; border-top: 1px solid #eee; padding-top: 10px; }

  /* モーダル用 CSS */
  .modal-overlay {
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 1000;
  }
  .modal-content {
    background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 700px;
    max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.2);
  }
  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .modal-header h2 { margin: 0; font-size: 1.5rem; color: #2c3e50; }
  .close-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #7f8c8d; }
  
  .search-mode-selector { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #eee; }
  .search-mode-selector label { cursor: pointer; font-size: 1rem; color: #555; font-weight: normal; }
  .active-mode { font-weight: bold !important; color: #6c5ce7 !important; }

  .search-inputs { margin-bottom: 25px; }
  .search-desc { font-size: 0.9rem; color: #7f8c8d; margin-bottom: 15px; }

  .run-search-btn {
    background: #0984e3; color: white; border: none; padding: 15px; border-radius: 8px;
    font-size: 1.1rem; font-weight: bold; cursor: pointer; width: 100%; transition: background 0.2s;
  }
  .run-search-btn:hover:not(:disabled) { background: #074b83; }
  .run-search-btn:disabled { background: #bdc3c7; cursor: not-allowed; }

  .search-results {
    margin-top: 25px; flex-grow: 1; overflow-y: auto; border-top: 1px solid #eee; padding-top: 15px;
  }
  .search-results h4 { margin: 0 0 15px 0; color: #2c3e50; }
  .loading-text { text-align: center; margin-top: 20px; font-weight: bold; color: #e67e22; }
  
  .result-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .result-item { 
    background: #fdfdfd; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 15px;
    display: flex; justify-content: space-between; align-items: center; 
  }
  .res-info { font-size: 0.95rem; line-height: 1.5; }
  .res-badge { padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; color: white; margin-right: 8px; }
  .badge-sII { background: #FF8C00; }
  .badge-sI { background: #008080; }
  
  .apply-btn { 
    background: #27ae60; color: white; border: none; padding: 8px 15px; border-radius: 6px;
    cursor: pointer; font-weight: bold; font-size: 0.9rem; transition: transform 0.1s;
  }
  .apply-btn:hover { transform: scale(1.05); background: #219653; }
</style>