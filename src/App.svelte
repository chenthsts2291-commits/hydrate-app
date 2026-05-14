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

  // ★ 最小値(sI)の変数を削除し、最大値(sII)のみに限定
  let analysisMax = { val: 0, a: 0, b: 0, c: 0, hasSynergy: false };
  
  let Plotly;

  let showSearchModal = false;
  let searchMode = 'gases';
  let isSearching = false;
  let searchResults = [];

  let s_gas_a = "Ne", s_gas_b = "Ar", s_gas_c = "Kr";
  let s_temp = 273.15, s_press = 50.0;

  const EPSILON = 0.005;

  // ==========================================
  // ★ 2成分系の最大値(sII)の計算のみを残す
  // ==========================================
  function getBinaryMaxObj(name1, name2, P, T, steps = 500) {
    let maxVal = -Infinity;
    let bestFrac = 0;
    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const diff = calculateStability(name1, name2, frac, 1.0 - frac, P, T);
      if (diff !== null && diff > maxVal) { maxVal = diff; bestFrac = frac; }
    }
    return { val: maxVal, f1: bestFrac, f2: 1.0 - bestFrac };
  }

  // ==========================================
  // ★ 検索ロジック (sIIシナジー特化・軽量化版)
  // ==========================================
  async function runAdvancedSearch() {
    isSearching = true;
    searchResults = [];
    await new Promise(resolve => setTimeout(resolve, 50));

    const N = available_gases.length;

    let binMaxCache = {};
    if (searchMode === 'pt') {
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
           const g1 = available_gases[i], g2 = available_gases[j];
           const key = [g1, g2].sort().join('-');
           binMaxCache[key] = getBinaryMaxObj(g1, g2, s_press, s_temp, 100).val;
        }
      }
    }

    const getCachedMaxVal = (g1, g2, p, t) => {
      if (searchMode === 'pt') return binMaxCache[[g1, g2].sort().join('-')];
      return getBinaryMaxObj(g1, g2, p, t, 100).val;
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
      const mBinMax = Math.max(getCachedMaxVal(g1, g2, p, t), getCachedMaxVal(g2, g3, p, t), getCachedMaxVal(g1, g3, p, t));

      const res = calculateTernaryEnergySurface(g1, g2, g3, p, t, 50); 
      
      let locMax = { val: -Infinity, idx: -1 };
      for (let idx = 0; idx < res.flat.z.length; idx++) {
        const z = res.flat.z[idx];
        if (z !== null && z > locMax.val) {
          locMax = { val: z, idx };
        }
      }

      const calcComp = (idx, dataset) => {
        const px = dataset.flat.x[idx];
        const py = dataset.flat.y[idx];
        const c = py / 0.866025;
        const b = px - 0.5 * c;
        return { a: Math.max(0, 1.0 - b - c), b: Math.max(0, b), c: Math.max(0, c) };
      };

      const maxC = calcComp(locMax.idx, res);

      // 粗い診断
      if (maxC.a > EPSILON && maxC.b > EPSILON && maxC.c > EPSILON && locMax.val > mBinMax + 0.0001) {
        // 確定診断 (n=100)
        const fineRes = calculateTernaryEnergySurface(g1, g2, g3, p, t, 100);
        let fMax = -Infinity, fMaxIdx = -1;
        for (let i = 0; i < fineRes.flat.z.length; i++) {
          if (fineRes.flat.z[i] !== null && fineRes.flat.z[i] > fMax) {
            fMax = fineRes.flat.z[i]; 
            fMaxIdx = i;
          }
        }
        
        const exactBinMax = Math.max(getBinaryMaxObj(g1, g2, p, t).val, getBinaryMaxObj(g2, g3, p, t).val, getBinaryMaxObj(g1, g3, p, t).val);
        const fC = calcComp(fMaxIdx, fineRes);
        
        if (fC.a > EPSILON && fC.b > EPSILON && fC.c > EPSILON && fMax > exactBinMax + 0.0001) {
          const compStr = `${g1}:${(fC.a*100).toFixed(1)}%  ${g2}:${(fC.b*100).toFixed(1)}%  ${g3}:${(fC.c*100).toFixed(1)}%`;
          searchResults.push({ temp: t, press: p, gases: [g1, g2, g3], comp: compStr });
        }
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
  // ★ メイン描画ロジック (sIIのみ)
  // ==========================================
  async function draw() {
    if (!Plotly) return;

    const res = calculateTernaryEnergySurface(gas_a, gas_b, gas_c, press, temp, 100);

    let maxZ = -Infinity;
    let minZ = Infinity; // グラフのカラースケール(軸)のためだけに計算用として残す
    let maxIdx = -1;
    
    for (let i = 0; i < res.flat.z.length; i++) {
      const z = res.flat.z[i];
      if (z !== null) {
        if (z > maxZ) { maxZ = z; maxIdx = i; }
        if (z < minZ) { minZ = z; }
      }
    }

    const binAB_max = getBinaryMaxObj(gas_a, gas_b, press, temp, 500);
    const binBC_max = getBinaryMaxObj(gas_b, gas_c, press, temp, 500);
    const binCA_max = getBinaryMaxObj(gas_c, gas_a, press, temp, 500);
    let bestBinMax = binAB_max;
    if (binBC_max.val > bestBinMax.val) bestBinMax = binBC_max;
    if (binCA_max.val > bestBinMax.val) bestBinMax = binCA_max;

    const maxAbs = Math.max(Math.abs(maxZ), Math.abs(minZ), 0.1); 
    const discreteColorscale = [ [0.0, '#008080'], [0.5, '#008080'], [0.5, '#FF8C00'], [1.0, '#FF8C00'] ];

    if (maxIdx !== -1) {
      const px = res.flat.x[maxIdx]; const py = res.flat.y[maxIdx];
      const c = py / 0.866025; const b = px - 0.5 * c; const a = 1.0 - b - c;
      const compA = Math.max(0, a); const compB = Math.max(0, b); const compC = Math.max(0, c);
      
      const hasSynergyMax = compA > EPSILON && compB > EPSILON && compC > EPSILON && (maxZ > bestBinMax.val + 0.0001);

      if (hasSynergyMax) {
        analysisMax = { val: maxZ, a: compA, b: compB, c: compC, hasSynergy: true };
      } else {
        let ba = 0, bb = 0, bc = 0;
        if (bestBinMax === binAB_max) { ba = bestBinMax.f1; bb = bestBinMax.f2; }
        else if (bestBinMax === binBC_max) { bb = bestBinMax.f1; bc = bestBinMax.f2; }
        else if (bestBinMax === binCA_max) { bc = bestBinMax.f1; ba = bestBinMax.f2; }
        analysisMax = { val: bestBinMax.val, a: ba, b: bb, c: bc, hasSynergy: false };
      }
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
  <h1>3成分系ハイドレート探索AI ver.3.1.0 (sII特化・軽量化)</h1>

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
        <h2>🔍 高度なシナジー検索ツール (sII特化)</h2>
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
          <p class="search-desc">指定した3つのガスにおいて、sII構造の確実なシナジーが発現する温度・圧力を探索します。</p>
          <div class="row">
            <select bind:value={s_gas_a}> {#each available_gases as g}<option>{g}</option>{/each} </select>
            <select bind:value={s_gas_b}> {#each available_gases as g}<option>{g}</option>{/each} </select>
            <select bind:value={s_gas_c}> {#each available_gases as g}<option>{g}</option>{/each} </select>
          </div>
        {:else}
          <p class="search-desc">指定した温度・圧力において、全ガス組み合わせの中からsIIシナジーを発現するものを探索します。</p>
          <div class="row" style="gap: 30px; justify-content: center;">
            <label>温度 (K): <input type="number" bind:value={s_temp} style="width: 100px; padding: 5px;"></label>
            <label>圧力 (bar): <input type="number" bind:value={s_press} style="width: 100px; padding: 5px;"></label>
          </div>
        {/if}
      </div>

      <button class="run-search-btn" on:click={runAdvancedSearch} disabled={isSearching}>
        {isSearching ? '⏳ sIIシナジーを総当たり計算中...' : '🚀 検索を実行する'}
      </button>

      <div class="search-results">
        {#if isSearching}
          <div class="loading-text">計算しています。数十秒かかる場合があります...</div>
        {:else if searchResults.length > 0}
          <h4>🎯 発見された完全な3成分シナジー条件 ({searchResults.length} 件)</h4>
          <ul class="result-list">
            {#each searchResults as res}
              <li class="result-item">
                <div class="res-info">
                  <span class="res-badge badge-sII">sII優位</span>
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
  
  .apply-btn { 
    background: #27ae60; color: white; border: none; padding: 8px 15px; border-radius: 6px;
    cursor: pointer; font-weight: bold; font-size: 0.9rem; transition: transform 0.1s;
  }
  .apply-btn:hover { transform: scale(1.05); background: #219653; }
</style>