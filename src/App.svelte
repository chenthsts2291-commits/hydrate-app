<script>
  import { onMount } from 'svelte';
  import { calculateTernaryEnergySurface, inter } from './vdwp_core.js';

  // 初期値
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

    // 計算実行 (offset引数は削除済み)
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

    // 2. Surface (線担当)
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
          // size指定は削除（自動の方が安全）
        },
        x: { show: false },
        y: { show: false }
      },
      hoverinfo: 'skip'
    };

    // 3. 基準面
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
  <h1>3成分系ハイドレートシミュレータ</h1>
  
  <div class="controls">
    <div class="row">
      <label class="gas-label"> <span class="mark a">A</span> <select bind:value={gas_a} on:change={draw}> {#each available_gases as g}<option>{g}</option>{/each} </select> </label>
      <label class="gas-label"> <span class="mark b">B</span> <select bind:value={gas_b} on:change={draw}> {#each available_gases as g}<option>{g}</option>{/each} </select> </label>
      <label class="gas-label"> <span class="mark c">C</span> <select bind:value={gas_c} on:change={draw}> {#each available_gases as g}<option>{g}</option>{/each} </select> </label>
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
</main>

<style>
  main { max-width: 900px; margin: 0 auto; padding: 20px; font-family: sans-serif; }
  h1 { text-align: center; color: #333; }
  .controls { background: #f8f9fa; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px; }
  .row { display: flex; gap: 15px; justify-content: space-between; margin-bottom: 10px;}
  label { display: flex; flex-direction: column; font-weight: bold; width: 100%; }
  select { margin-top: 8px; padding: 8px; border-radius: 4px; border: 1px solid #ccc; }
  .mark { padding: 2px 8px; border-radius: 4px; color: white; display: inline-block; width: fit-content;}
  .mark.a { background-color: #d63031; } .mark.b { background-color: #0984e3; } .mark.c { background-color: #00b894; } 
  hr { border: 0; border-top: 1px solid #ddd; margin: 20px 0; }
  .sliders-container { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
  .control-group { display: flex; flex-direction: column; gap: 5px; }
  .label-row { display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #444; }
  .number-input { width: 80px; padding: 4px; border: 1px solid #aaa; border-radius: 4px; text-align: right; font-size: 1rem; }
  input[type=range] { width: 100%; cursor: pointer; }
  
  .info-box { background: white; margin-top: 20px; padding: 15px; border-radius: 8px; border-left: 5px solid #6c5ce7; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
  .info-box h3 { margin: 0 0 10px 0; font-size: 1.1rem; color: #333; }
  .info-composition { display: flex; gap: 20px; margin-top: 5px; font-weight: bold; }
</style>