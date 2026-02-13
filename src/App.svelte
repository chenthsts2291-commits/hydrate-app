<script>
  import { onMount } from 'svelte';
  import { calculateTernaryEnergySurface, inter } from './vdwp_core.js';

  // --- 初期設定 ---
  let temp = 273.15;
  let press = 50.0;
  
  let available_gases = Object.keys(inter).sort();
  let gas_a = "Methane";
  let gas_b = "Ethane";
  let gas_c = "CF4";

  // 最大値情報の格納用
  let maxInfo = { val: 0, a: 0, b: 0, c: 0 };

  let Plotly;

  async function draw() {
    if (!Plotly) return;

    // 計算実行
    const res = calculateTernaryEnergySurface(gas_a, gas_b, gas_c, press, temp, 60);

    // --- 最大値の探索とモル分率計算 ---
    let maxZ = -Infinity;
    let maxIdx = -1;
    
    for (let i = 0; i < res.flat.z.length; i++) {
      const z = res.flat.z[i];
      if (z !== null && z > maxZ) {
        maxZ = z;
        maxIdx = i;
      }
    }

    if (maxIdx !== -1) {
      const px = res.flat.x[maxIdx];
      const py = res.flat.y[maxIdx];
      // 逆算: y = 0.866 * c  => c = y / 0.866
      //       x = b + 0.5*c  => b = x - 0.5*c
      const c = py / 0.866025;
      const b = px - 0.5 * c;
      const a = 1.0 - b - c;

      maxInfo = { 
        val: maxZ, 
        a: Math.max(0, a), 
        b: Math.max(0, b), 
        c: Math.max(0, c) 
      };
    }
    // ---------------------------

    // 1. Mesh3D (見た目担当)
    const meshTrace = {
      type: 'mesh3d',
      x: res.flat.x, y: res.flat.y, z: res.flat.z,
      intensity: res.flat.z, 
      colorscale: 'RdBu',
      showscale: true,
      colorbar: { title: 'Δμ (kJ/mol)' },
      hovertemplate: '安定度: %{z:.3f} kJ/mol<extra></extra>',
      contour: { show: false } 
    };

    // 2. Surface (等高線担当)
    const contourTrace = {
      type: 'surface',
      x: res.matrix.x, y: res.matrix.y, z: res.matrix.z,
      showscale: false, 
      opacity: 0.9,
      surfacecolor: res.matrix.z, 
      colorscale: 'RdBu',
      hidesurface: true, 
      
      contours: {
        z: {
          show: true,
          usecolormap: false,
          project: { z: false }, // 空中に浮かせない
          color: 'black',
          width: 5,
          start: 0,
          end: 0,
        },
        x: { show: false },
        y: { show: false }
      },
      hoverinfo: 'skip'
    };

    // 3. 基準面 (三角形)
    const zeroPlane = {
      type: 'mesh3d',
      x: [0, 1, 0.5], y: [0, 0, 0.866], z: [0, 0, 0],
      color: 'gray', opacity: 0.3, hoverinfo: 'skip'
    };

    const maxZ_plot = Math.max(...res.flat.z, 0.5) + 0.3;
    const layout = {
      title: `Phase Diagram (T=${temp}K, P=${press}bar)`,
      uirevision: 'true', // カメラ固定
      scene: {
        aspectratio: {x: 1, y: 0.866, z: 0.6},
        zaxis: {title: 'sI(青) <---> sII(赤)'},
        xaxis: {visible: false}, yaxis: {visible: false},
        annotations: [
          { x: 0, y: 0, z: maxZ_plot, text: `A: ${gas_a}`, showarrow:false, font:{size:14}, bgcolor:'rgba(255,255,255,0.7)' },
          { x: 1, y: 0, z: maxZ_plot, text: `B: ${gas_b}`, showarrow:false, font:{size:14}, bgcolor:'rgba(255,255,255,0.7)' },
          { x: 0.5, y: 0.866, z: maxZ_plot, text: `C: ${gas_c}`, showarrow:false, font:{size:14}, bgcolor:'rgba(255,255,255,0.7)' }
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
  <h1>3成分系ハイドレートシミュレータ ver.1.1.0</h1>

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
        <div class="label-row"> <span>Press (bar)</span> <input type="number" class="number-input" min="1" max="500" step="1" bind:value={press} on:input={draw}> </div>
        <input type="range" min="1" max="500" step="1" bind:value={press} on:input={draw}>
      </div>
    </div>

    <div class="info-box">
      <h3>📊 Analysis (Max Stability Diff)</h3>
      <div class="info-row">
        <span><b>Max Value:</b> {maxInfo.val.toFixed(4)} kJ/mol</span>
      </div>
      <div class="info-composition">
        <span style="color: #d63031;">A: {(maxInfo.a * 100).toFixed(1)}%</span>
        <span style="color: #0984e3;">B: {(maxInfo.b * 100).toFixed(1)}%</span>
        <span style="color: #00b894;">C: {(maxInfo.c * 100).toFixed(1)}%</span>
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
  
  /* コントロールパネル全体 */
  .controls { background: #fff; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); margin-bottom: 30px; border: 1px solid #eee; }
  
  /* ガス選択部分 */
  .row { display: flex; gap: 20px; justify-content: space-between; flex-wrap: wrap; }
  .gas-box { flex: 1; min-width: 200px; display: flex; flex-direction: column; }
  label { font-weight: bold; font-size: 0.9rem; margin-bottom: 5px; display: flex; align-items: center; gap: 8px; }
  select { padding: 10px; border-radius: 6px; border: 1px solid #ddd; background: #fafafa; font-size: 1rem; cursor: pointer; }
  
  .mark { padding: 4px 10px; border-radius: 4px; color: white; font-size: 0.8rem; font-weight: bold; }
  .bg-a { background-color: #d63031; } 
  .bg-b { background-color: #0984e3; } 
  .bg-c { background-color: #00b894; } 
  
  hr { border: 0; border-top: 1px solid #eee; margin: 25px 0; }
  
  /* スライダー部分 */
  .sliders-container { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 20px; }
  .control-group { display: flex; flex-direction: column; gap: 10px; }
  .label-row { display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #555; font-size: 0.95rem; }
  .number-input { width: 80px; padding: 6px; border: 1px solid #ccc; border-radius: 4px; text-align: right; font-size: 1rem; }
  input[type=range] { width: 100%; cursor: pointer; height: 6px; background: #ddd; border-radius: 5px; outline: none; -webkit-appearance: none; }
  
  /* 分析情報ボックス */
  .info-box { background: #f8f9fa; padding: 15px 20px; border-radius: 8px; border-left: 5px solid #6c5ce7; }
  .info-box h3 { margin: 0 0 10px 0; font-size: 1rem; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
  .info-composition { display: flex; gap: 20px; margin-top: 5px; font-weight: bold; font-size: 1.1rem; }

  /* グラフエリア */
  #myDiv { border-radius: 8px; overflow: hidden; border: 1px solid #eee; }

  /* フッター */
  footer { margin-top: 40px; text-align: right; color: #aaa; font-size: 0.9rem; border-top: 1px solid #eee; padding-top: 10px; }
</style>