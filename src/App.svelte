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

    // --- 最大値・最小値の探索 ---
    let maxZ = -Infinity;
    let minZ = Infinity;
    let maxIdx = -1;
    
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

    // --- 0を境界にした「パキッとした2色分け」のためのスケール計算 ---
    // Zの絶対値の最大値をとることで、カラースケールの中心(0.5)を必ず 0 kJ/mol に固定する
    const maxAbs = Math.max(Math.abs(maxZ), Math.abs(minZ), 0.1); 

    const discreteColorscale = [
      [0.0, '#008080'], // Teal (sI)
      [0.5, '#008080'], // Teal (0未満まで)
      [0.5, '#FF8C00'], // Dark Orange (0以上から)
      [1.0, '#FF8C00']  // Dark Orange (sII)
    ];

    // --- モル分率計算 ---
    if (maxIdx !== -1) {
      const px = res.flat.x[maxIdx];
      const py = res.flat.y[maxIdx];
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

    // 1. Mesh3D (見た目担当)
    const meshTrace = {
      type: 'mesh3d',
      x: res.flat.x, y: res.flat.y, z: res.flat.z,
      intensity: res.flat.z, 
      cmin: -maxAbs, // カラースケールの下限
      cmax: maxAbs,  // カラースケールの上限
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

    // 2. Surface (Z=0の境界線担当)
    const contourTrace = {
      type: 'surface',
      x: res.matrix.x, y: res.matrix.y, z: res.matrix.z,
      showscale: false, 
      opacity: 1.0,
      surfacecolor: res.matrix.z, 
      cmin: -maxAbs,
      cmax: maxAbs,
      colorscale: discreteColorscale,
      hidesurface: true, // 面自体は隠して、等高線だけを描画
      
      contours: {
        z: {
          show: true,
          usecolormap: false,
          project: { z: false }, // 空中に浮かせない
          color: 'black',        // 境界線の色
          width: 6,              // 線を太く強調
          start: 0,              // 0 の位置だけに線を引く
          end: 0,
          size: 1
        },
        x: { show: false },
        y: { show: false }
      },
      hoverinfo: 'skip'
    };

    // 3. 基準面 (Z=0 の透明な氷の板)
    const zeroPlane = {
      type: 'mesh3d',
      x: [0, 1, 0.5], y: [0, 0, 0.866], z: [0, 0, 0],
      color: '#ffffff', opacity: 0.3, hoverinfo: 'skip'
    };

    const maxZ_plot = Math.max(maxZ, 0.5) + 0.5; // テキストが埋もれないように少し高くする
    const layout = {
      title: `Ternary Phase Diagram (T=${temp}K, P=${press}bar)`,
      uirevision: 'true', // カメラ固定（スライダーを動かしても視点がリセットされない）
      scene: {
        aspectratio: {x: 1, y: 0.866, z: 0.6},
        // ★ zaxis の指定方法を Plotly の最新仕様に修正
        zaxis: { title: { text: '<b>ΔμsI - ΔμsII [kJ/mol]</b>' } },
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
  <h1>3成分系ハイドレートシミュレータ ver.1.1.2</h1>

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

    <div class="info-box">
      <h3>Δμ(sI) - Δμ(sII) の最大値</h3>
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
  
  .info-box { background: #f8f9fa; padding: 15px 20px; border-radius: 8px; border-left: 5px solid #6c5ce7; }
  /* ★ 大文字変換 (text-transform: uppercase;) を削除して μ が M になるバグを修正 */
  .info-box h3 { margin: 0 0 10px 0; font-size: 1rem; color: #555; letter-spacing: 0.5px; }
  .info-composition { display: flex; gap: 20px; margin-top: 5px; font-weight: bold; font-size: 1.1rem; }

  #myDiv { border-radius: 8px; overflow: hidden; border: 1px solid #eee; }

  footer { margin-top: 40px; text-align: right; color: #aaa; font-size: 0.9rem; border-top: 1px solid #eee; padding-top: 10px; }
</style>