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

  // ★ 最大値用・最小値用の情報を格納
  let analysisMax = { val: 0, a: 0, b: 0, c: 0, hasSynergy: false };
  let analysisMin = { val: 0, a: 0, b: 0, c: 0, hasSynergy: false };
  
  let isSearching = false; 

  let Plotly;

  // 2成分系の最大安定度(sII方向)を計算する補助関数
  function getBinaryMax(name1, name2, P, T, steps = 100) {
    let maxBinary = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const frac1 = i / steps;
      const frac2 = 1.0 - frac1;
      const diff = calculateStability(name1, name2, frac1, frac2, P, T);
      if (diff !== null && diff > maxBinary) {
        maxBinary = diff;
      }
    }
    return maxBinary;
  }

  // 探索機能: sII方向へ強いシナジー（内部にピークを持つ）組み合わせを探す
  async function discoverSynergy() {
    if (isSearching) return;
    isSearching = true;

    await new Promise(resolve => setTimeout(resolve, 50));

    let bestSynergyDiff = -Infinity;
    let bestCombo = null;
    const N = available_gases.length;

    const binaryCache = {};
    for(let i = 0; i < N; i++){
      for(let j = i + 1; j < N; j++){
        const g1 = available_gases[i];
        const g2 = available_gases[j];
        binaryCache[`${g1}-${g2}`] = getBinaryMax(g1, g2, press, temp, 20);
      }
    }

    const getBin = (g1, g2) => {
      if(g1 > g2) [g1, g2] = [g2, g1];
      return binaryCache[`${g1}-${g2}`];
    };

    for(let i = 0; i < N; i++){
      for(let j = i + 1; j < N; j++){
        for(let k = j + 1; k < N; k++){
          const g1 = available_gases[i];
          const g2 = available_gases[j];
          const g3 = available_gases[k];

          const mAB = getBin(g1, g2);
          const mBC = getBin(g2, g3);
          const mCA = getBin(g1, g3);
          const mBinMax = Math.max(mAB, mBC, mCA);

          const res = calculateTernaryEnergySurface(g1, g2, g3, press, temp, 12);
          let tempMaxZ = -Infinity;
          for (let p = 0; p < res.flat.z.length; p++) {
            if (res.flat.z[p] !== null && res.flat.z[p] > tempMaxZ) {
              tempMaxZ = res.flat.z[p];
            }
          }

          const synergyDiff = tempMaxZ - mBinMax;
          if (synergyDiff > bestSynergyDiff) {
            bestSynergyDiff = synergyDiff;
            bestCombo = [g1, g2, g3];
          }
        }
      }
    }

    isSearching = false;

    if (bestCombo && bestSynergyDiff > 0.001) {
      gas_a = bestCombo[0];
      gas_b = bestCombo[1];
      gas_c = bestCombo[2];
      draw(); 
    } else {
      alert(`現在の条件では、3成分すべてが必須となるような強いシナジー効果は見つかりませんでした。`);
    }
  }

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
        if (z > maxZ) {
          maxZ = z;
          maxIdx = i;
        }
        if (z < minZ) {
          minZ = z;
          minIdx = i;
        }
      }
    }

    const maxAbs = Math.max(Math.abs(maxZ), Math.abs(minZ), 0.1); 

    const discreteColorscale = [
      [0.0, '#008080'], 
      [0.5, '#008080'], 
      [0.5, '#FF8C00'], 
      [1.0, '#FF8C00']  
    ];

    // --- 0%判定のための微小値 (浮動小数点誤差対策) ---
    const EPSILON = 0.001; // 0.1% より大きければ「含まれている」と判定

    // --- 最大値 (sII優位) の計算とシナジー判定 ---
    if (maxIdx !== -1) {
      const px = res.flat.x[maxIdx];
      const py = res.flat.y[maxIdx];
      const c = py / 0.866025;
      const b = px - 0.5 * c;
      const a = 1.0 - b - c;

      const compA = Math.max(0, a);
      const compB = Math.max(0, b);
      const compC = Math.max(0, c);
      
      // ★ 新定義：A, B, C 全てが0%ではない（3成分全てがブレンドされている）
      const hasSynergyMax = compA > EPSILON && compB > EPSILON && compC > EPSILON;

      analysisMax = { 
        val: maxZ, 
        a: compA, b: compB, c: compC,
        hasSynergy: hasSynergyMax
      };
    }

    // --- 最小値 (sI優位) の計算とシナジー判定 ---
    if (minIdx !== -1) {
      const px = res.flat.x[minIdx];
      const py = res.flat.y[minIdx];
      const c = py / 0.866025;
      const b = px - 0.5 * c;
      const a = 1.0 - b - c;

      const compA = Math.max(0, a);
      const compB = Math.max(0, b);
      const compC = Math.max(0, c);

      // ★ 新定義：A, B, C 全てが0%ではない（3成分全てがブレンドされている）
      const hasSynergyMin = compA > EPSILON && compB > EPSILON && compC > EPSILON;

      analysisMin = { 
        val: minZ, 
        a: compA, b: compB, c: compC,
        hasSynergy: hasSynergyMin
      };
    }

    const meshTrace = {
      type: 'mesh3d',
      x: res.flat.x, y: res.flat.y, z: res.flat.z,
      intensity: res.flat.z, 
      cmin: -maxAbs, cmax: maxAbs,  
      colorscale: discreteColorscale,
      showscale: true,
      colorbar: { 
        title: '<b>構造</b>',
        tickvals: [-maxAbs/2, maxAbs/2],
        ticktext: ['sI安定', 'sII安定']
      },
      hovertemplate: 'ΔμsI - ΔμsII: %{z:.3f} kJ/mol<extra></extra>',
      contour: { show: false } 
    };

    const contourTrace = {
      type: 'surface',
      x: res.matrix.x, y: res.matrix.y, z: res.matrix.z,
      showscale: false, opacity: 1.0,
      surfacecolor: res.matrix.z, 
      cmin: -maxAbs, cmax: maxAbs,
      colorscale: discreteColorscale,
      hidesurface: true, 
      contours: {
        z: {
          show: true, usecolormap: false, project: { z: false }, 
          color: 'black', width: 6, start: 0, end: 0, size: 1
        },
        x: { show: false }, y: { show: false }
      },
      hoverinfo: 'skip'
    };

    const zeroPlane = {
      type: 'mesh3d',
      x: [0, 1, 0.5], y: [0, 0, 0.866], z: [0, 0, 0],
      color: '#ffffff', opacity: 0.3, hoverinfo: 'skip'
    };

    const maxZ_plot = Math.max(maxZ, 0.5) + 0.5; 
    
    const layout = {
      title: `Ternary Phase Diagram (T=${temp}K, P=${press}bar)`,
      uirevision: 'true', 
      scene: {
        aspectratio: {x: 1, y: 0.866, z: 0.6},
        zaxis: { 
          title: { text: '<b>ΔμsI - ΔμsII<br>[kJ/mol]</b>', font: {size: 13, color: '#333'} } 
        },
        xaxis: {visible: false}, yaxis: {visible: false},
        annotations: [
          { x: 0, y: 0, z: maxZ_plot, text: `A: ${gas_a}`, showarrow:false, font:{size:14, color:'black'}, bgcolor:'rgba(255,255,255,0.8)' },
          { x: 1, y: 0, z: maxZ_plot, text: `B: ${gas_b}`, showarrow:false, font:{size:14, color:'black'}, bgcolor:'rgba(255,255,255,0.8)' },
          { x: 0.5, y: 0.866, z: maxZ_plot, text: `C: ${gas_c}`, showarrow:false, font:{size:14, color:'black'}, bgcolor:'rgba(255,255,255,0.8)' }
        ]
      },
      margin: {t: 50, b: 0, l: 0, r: 0},
      height: 600
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
  <h1>3成分系ハイドレート探索AI ver.1.4.1</h1>

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

    <div class="action-row">
      <button class="discover-btn" on:click={discoverSynergy} disabled={isSearching}>
        {#if isSearching}
          🔍 全パターン総当たり計算中...
        {:else}
          ✨ 現在の条件で最強のシナジーを全探索する
        {/if}
      </button>
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
            (シナジーなし: 2成分で十分)
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
            (シナジーなし: 2成分で十分)
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
  
  .action-row { display: flex; justify-content: center; margin-bottom: 20px; }
  .discover-btn { 
    background: linear-gradient(135deg, #6c5ce7, #a29bfe); color: white; border: none; 
    padding: 12px 25px; border-radius: 25px; font-size: 1.1rem; font-weight: bold; 
    cursor: pointer; box-shadow: 0 4px 10px rgba(108, 92, 231, 0.3); transition: transform 0.2s;
  }
  .discover-btn:hover:not(:disabled) { transform: scale(1.05); }
  .discover-btn:disabled { background: #bdc3c7; cursor: not-allowed; box-shadow: none; }

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
</style>