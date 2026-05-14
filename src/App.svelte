<script>
  import { onMount } from 'svelte';
  // vdWPコアロジックをインポート
  // 注意: ここでインポートしている calculateTernaryEnergySurface は、
  // 3成分系のデータを返す前提です。シナジー判定のために内部で2成分系も計算します。
  import { calculateTernaryEnergySurface, calculateStability, inter } from './vdwp_core.js';

  // --- 初期設定 ---
  let temp = 273.15;
  let press = 50.0;
  
  let available_gases = Object.keys(inter).sort();
  let gas_a = "Methane";
  let gas_b = "Ethane";
  let gas_c = "CF4";

  // 解析情報の格納用
  let analysisInfo = {
    maxZ: 0,
    compA: 0, compB: 0, compC: 0,
    hasSynergy: false,
    synergyIncrease: 0,
    maxBinaryVal: 0
  };

  let Plotly;

  // 2成分系の最大安定度を計算する補助関数
  function getBinaryMax(name1, name2, P, T) {
    let maxBinary = -Infinity;
    // 0%から100%まで1%刻みでスキャン
    for (let i = 0; i <= 100; i++) {
      const frac1 = i / 100;
      const frac2 = 1.0 - frac1;
      const diff = calculateStability(name1, name2, frac1, frac2, P, T);
      if (diff !== null && diff > maxBinary) {
        maxBinary = diff;
      }
    }
    return maxBinary;
  }

  async function draw() {
    if (!Plotly) return;

    // --- 1. 3成分系の計算 ---
    const res = calculateTernaryEnergySurface(gas_a, gas_b, gas_c, press, temp, 60);

    let maxZ = -Infinity;
    let minZ = Infinity;
    let maxIdx = -1;
    
    // 全データから3成分系の最大・最小を探索
    for (let i = 0; i < res.flat.z.length; i++) {
      const z = res.flat.z[i];
      if (z !== null) {
        if (z > maxZ) {
          maxZ = z;
          maxIdx = i;
        }
        if (z < minZ) {
          minZ = z;
        }
      }
    }

    // --- 2. シナジー効果の判定 ---
    // (A-B), (B-C), (C-A) の2成分系それぞれの最大値を計算
    const maxAB = getBinaryMax(gas_a, gas_b, press, temp);
    const maxBC = getBinaryMax(gas_b, gas_c, press, temp);
    const maxCA = getBinaryMax(gas_c, gas_a, press, temp);

    // 2成分系の中での絶対的な最大値
    const maxBinary = Math.max(maxAB, maxBC, maxCA);

    // 3成分系の最大値が、2成分系の最大値を上回っているか判定
    const hasSynergy = maxZ > maxBinary + 0.001; // 浮動小数点の誤差を考慮
    const synergyIncrease = hasSynergy ? ((maxZ - maxBinary) / maxBinary * 100) : 0;

    // --- 3. 解析情報の更新とモル分率計算 ---
    if (maxIdx !== -1) {
      const px = res.flat.x[maxIdx];
      const py = res.flat.y[maxIdx];
      const c = py / 0.866025;
      const b = px - 0.5 * c;
      const a = 1.0 - b - c;

      analysisInfo = { 
        maxZ: maxZ, 
        compA: Math.max(0, a), 
        compB: Math.max(0, b), 
        compC: Math.max(0, c),
        hasSynergy: hasSynergy,
        synergyIncrease: synergyIncrease,
        maxBinaryVal: maxBinary
      };
    }

    // --- 4. グラフ描画データの設定 ---
    const maxAbs = Math.max(Math.abs(maxZ), Math.abs(minZ), 0.1); 

    const discreteColorscale = [
      [0.0, '#008080'], // Teal (sI)
      [0.5, '#008080'], // Teal (0未満まで)
      [0.5, '#FF8C00'], // Dark Orange (0以上から)
      [1.0, '#FF8C00']  // Dark Orange (sII)
    ];

    // Mesh3D (曲面)
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

    // Surface (Z=0の境界線)
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
        }
      },
      hoverinfo: 'skip'
    };

    // 基準面 (Z=0)
    const zeroPlane = {
      type: 'mesh3d',
      x: [0, 1, 0.5], y: [0, 0, 0.866], z: [0, 0, 0],
      color: '#ffffff', opacity: 0.2, hoverinfo: 'skip'
    };

    // アノテーション（ラベル）の高さ調整
    const maxZ_plot = Math.max(maxZ, 0.5) + 0.5;

    // Layout
    const layout = {
      title: `Ternary Phase Diagram (T=${temp}K, P=${press}bar)`,
      uirevision: 'true', // カメラ固定
      scene: {
        aspectratio: {x: 1, y: 0.866, z: 0.6},
        // ★ Z軸の標準タイトルを削除
        zaxis: { title: '' }, 
        xaxis: {visible: false}, yaxis: {visible: false},
        annotations: [
          // 頂点ラベル
          { x: 0, y: 0, z: maxZ_plot, text: `A: ${gas_a}`, showarrow:false, font:{size:14, color:'black'}, bgcolor:'rgba(255,255,255,0.8)' },
          { x: 1, y: 0, z: maxZ_plot, text: `B: ${gas_b}`, showarrow:false, font:{size:14, color:'black'}, bgcolor:'rgba(255,255,255,0.8)' },
          { x: 0.5, y: 0.866, z: maxZ_plot, text: `C: ${gas_c}`, showarrow:false, font:{size:14, color:'black'}, bgcolor:'rgba(255,255,255,0.8)' },
          
          // ★ Z軸ラベルのハック (頂点C付近の空中に、常に正しい向きで表示されるテキストを配置)
          {
            x: 0.45, y: 0.9, z: maxAbs / 2, // Z軸の横、高さの中央付近に配置
            text: '<b>ΔμsI - ΔμsII [kJ/mol] ➡</b>', // 矢印を追加
            textangle: -90, // 文字を縦にする (Plotlyのアノテーション角度は標準入力)
            showarrow: false,
            font: { size: 14, color: 'black' },
            bgcolor: 'rgba(255,255,255,0.5)',
            bordercolor: 'black',
            borderwidth: 1,
            borderpad: 4
          }
        ]
      },
      margin: {t: 50, b: 0, l: 0, r: 0},
      height: 600
    };

    Plotly.react('myDiv', [meshTrace, contourTrace, zeroPlane], layout);
  }

  onMount(async () => {
    // Plotlyの読み込み
    const mod = await import('plotly.js-dist-min');
    Plotly = mod.default;
    draw();
  });
</script>

<main>
  <h1>3成分系ハイドレートシミュレータ ver.1.2.0</h1>

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

    <div class="info-box {analysisInfo.hasSynergy ? 'synergy-border' : ''}">
      <div class="info-header">
        <h3>Δμ(sI) - Δμ(sII) の最大安定度 解析</h3>
        {#if analysisInfo.hasSynergy}
          <span class="synergy-badge">🌟 シナジー効果を発見！</span>
        {:else}
          <span class="no-synergy-badge">2成分ブレンドが最適</span>
        {/if}
      </div>

      <div class="info-main-row">
        <div class="info-val-group">
          <span class="label">3成分系最大値:</span>
          <span class="value">{analysisInfo.maxZ.toFixed(4)} kJ/mol</span>
        </div>
        {#if analysisInfo.hasSynergy}
          <div class="info-val-group synergy-text">
            <span class="label">(2成分系より:</span>
            <span class="value">+{analysisInfo.synergyIncrease.toFixed(1)}% 安定)</span>
          </div>
        {/if}
      </div>

      <div class="composition-title">🏆 最適組成比率</div>
      <div class="info-composition centered">
        <span style="color: #d63031;">A: {(analysisInfo.compA * 100).toFixed(1)}%</span>
        <span style="color: #0984e3;">B: {(analysisInfo.compB * 100).toFixed(1)}%</span>
        <span style="color: #00b894;">C: {(analysisInfo.compC * 100).toFixed(1)}%</span>
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
  
  /* 解析・シナジー判定ボックスのスタイル */
  .info-box { background: #f8f9fa; padding: 15px 20px; border-radius: 8px; border-left: 5px solid #bdc3c7; transition: all 0.3s ease; }
  .synergy-border { border-left: 5px solid #f1c40f; box-shadow: 0 0 10px rgba(241, 196, 15, 0.3); } /* シナジー発見時の強調 */
  
  .info-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .info-box h3 { margin: 0; font-size: 0.9rem; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
  
  .synergy-badge { background: #f1c40f; color: #333; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; animation: pulse 2s infinite; }
  .no-synergy-badge { background: #ecf0f1; color: #7f8c8d; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; }

  .info-main-row { display: flex; gap: 15px; margin-bottom: 15px; align-items: baseline; }
  .info-val-group { display: flex; gap: 8px; align-items: baseline; }
  .info-val-group .label { font-size: 0.9rem; color: #7f8c8d; }
  .info-val-group .value { font-size: 1.2rem; font-weight: bold; color: #2c3e50; }
  .synergy-text { color: #f39c12; }
  .synergy-text .value { font-size: 1rem; }

  .composition-title { font-size: 0.8rem; color: #7f8c8d; text-align: center; margin-bottom: 5px; text-transform: uppercase; }
  .info-composition { display: flex; gap: 20px; font-weight: bold; font-size: 1.1rem; }
  
  /* ★ 中央揃えのためのスタイル */
  .centered { justify-content: center; }

  #myDiv { border-radius: 8px; overflow: hidden; border: 1px solid #eee; }

  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(241, 196, 15, 0.4); }
    70% { box-shadow: 0 0 0 10px rgba(241, 196, 15, 0); }
    100% { box-shadow: 0 0 0 0 rgba(241, 196, 15, 0); }
  }

  footer { margin-top: 40px; text-align: right; color: #aaa; font-size: 0.9rem; border-top: 1px solid #eee; padding-top: 10px; }
</style>