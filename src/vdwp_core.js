// src/vdwp_core.js

// === 1. 物理定数 ===
const NkB = 1.380649e-23; 
const NA = 6.02214076e23; 
const R_gas = NkB * NA;   

// === 2. 物質パラメータ ===
const gasTableRaw = `
Methane  3.758 148.6
C2H2     4.221 185
Ethane   4.520 208.8
C2H4     4.232 205
c-propane 4.811 301.5
n-propane 5.061 254
n-butane 4.997 410
c-butane 4.950 320.0
i-butane 5.341 313
c-pentane 5.373 386.83
c-hexane 5.674 419.2
c-octane 6.249 489.9
Ne       2.749  35.6
Ar       3.405 119.8
Kr       3.60  171.0
Xe       4.047 231.0
Br2      4.93   540
CO2      4.486 189.0
CS2      4.551 417.87
THF      5.35 409.4
He       2.63 6.03
H2       2.87 29.2
NO       3.17 131
N2       3.698 95.05
O2       3.58 117.5
CO       3.763 100.2
N2O      4.59 189
H2S      3.834 282.5
neopentane 5.672 328.3
benzene    5.365 425.5
adamantane 6.598 500.9
methylbutanes 5.760 363.4
methylc-hexane 6.046 433.1
CF4      4.70 152.5
CCl4     5.881 327
`;

const tip4pice = { sig: 3.1668, epsK: 106.1 };
export const inter = {};

gasTableRaw.split('\n').forEach(line => {
    let cleanLine = line.split('#')[0].trim();
    if (!cleanLine) return;
    const cols = cleanLine.split(/\s+/);
    if (cols.length < 3) return;
    const name = cols[0];
    const gasSig = parseFloat(cols[1]);
    const gasEpsK = parseFloat(cols[2]);
    if (!isNaN(gasSig) && !isNaN(gasEpsK)) {
        inter[name] = {
            sig: (gasSig + tip4pice.sig) / 2.0,
            epsK: Math.sqrt(gasEpsK * tip4pice.epsK)
        };
    }
});

// === 3. 結晶データ (crystals.py) ===
const crystals = {
    mu_e: { "CS1": -59.841454832900, "CS2": -59.922551474335 },
    Nw: { "CS1": 46.0, "CS2": 136.0 },
    cage_counts: {
        "CS1": { "12": 2.0, "14": 6.0 }, 
        "CS2": { "12": 16.0, "16": 8.0 } 
    },
    radii: { "12": 3.988, "14": 4.331, "16": 4.587 },
    z: { "12": 20, "14": 24, "16": 28 }
};

// === 4. LJDポテンシャル ===
function cellPotential_LJD(r, sigma, epsilon, z, R) {
    const a = 0.0;
    function delta(N) {
        const t1 = 1.0 - r/R - a/R;
        const t2 = 1.0 + r/R - a/R;
        if (t1 === 0 || t2 === 0) return 0;
        return (Math.pow(t1, -N) - Math.pow(t2, -N)) / N;
    }
    if (r === 0) return 0;
    const term1 = (Math.pow(sigma, 12) / (Math.pow(R, 11) * r)) * (delta(10) + a * delta(11) / R);
    const term2 = (Math.pow(sigma, 6)  / (Math.pow(R,  5) * r)) * (delta(4) + a * delta(5) / R);
    return 2 * z * epsilon * (term1 - term2);
}

// === 5. ラングミュア定数 ===
function calculateLangmuir_LJD(temp, R, z, sigma, epsK) {
    const beta = 1.0 / (NkB * temp);
    const epsilon = epsK * NkB; 
    const points = 100;
    const step = R / (points - 1);
    let integral_sum = 0.0;
    for (let i = 1; i < points; i++) {
        const r = i * step;
        const cp = cellPotential_LJD(r, sigma, epsilon, z, R);
        if (cp * beta > 100) continue; 
        integral_sum += Math.exp(-cp * beta) * r * r;
    }
    return (4 * Math.PI * integral_sum * step * 1e-30) * beta;
}

// === 6. メイン計算 ===
// offset 引数を削除しました
export function calculateTernaryEnergySurface(gas_a, gas_b, gas_c, pressure_bar, temp_k, n_points = 60) {
    if (!inter[gas_a]) gas_a = "Methane";
    if (!inter[gas_b]) gas_b = "Ethane";
    if (!inter[gas_c]) gas_c = "CF4";

    const P_Pa = pressure_bar * 100000;
    const gas_names = [gas_a, gas_b, gas_c];

    // C計算
    const C_vals = {}; 
    ["12", "14", "16"].forEach(cageID => {
        C_vals[cageID] = {};
        gas_names.forEach(name => {
            const p = inter[name];
            C_vals[cageID][name] = calculateLangmuir_LJD(
                temp_k, crystals.radii[cageID], crystals.z[cageID], p.sig, p.epsK
            );
        });
    });

    let z_matrix = [], x_matrix = [], y_matrix = [];
    let x_flat = [], y_flat = [], z_flat = [];

    for (let i = 0; i <= n_points; i++) {
        let z_row = [], x_row = [], y_row = [];
        for (let j = 0; j <= n_points; j++) {
            if (i + j > n_points) {
                z_row.push(null); x_row.push(null); y_row.push(null);
                continue;
            }

            let k = n_points - i - j;
            let fracs = [k / n_points, j / n_points, i / n_points]; 
            let mu_total = { "CS1": 0, "CS2": 0 };
            
            for (let type of ["CS1", "CS2"]) {
                const water_count = crystals.Nw[type];
                let sum_term = 0;
                for (let [cageID, count] of Object.entries(crystals.cage_counts[type])) {
                    let sigma_CP = 0;
                    gas_names.forEach((name, idx) => {
                        if (fracs[idx] > 0) {
                            sigma_CP += C_vals[cageID][name] * (P_Pa * fracs[idx]);
                        }
                    });
                    sum_term += (count / water_count) * Math.log(1.0 + sigma_CP);
                }
                const delta_mu = -R_gas * temp_k * sum_term; 
                mu_total[type] = (crystals.mu_e[type] * 1000.0) + delta_mu; 
            }

            // [kJ/mol] (offsetなし)
            const val = (mu_total["CS1"] - mu_total["CS2"]) / 1000.0;
            
            const px = 1.0 * fracs[1] + 0.5 * fracs[2];
            const py = 0.866025 * fracs[2];

            z_row.push(val); x_row.push(px); y_row.push(py);
            x_flat.push(px); y_flat.push(py); z_flat.push(val);
        }
        z_matrix.push(z_row); x_matrix.push(x_row); y_matrix.push(y_row);
    }

    return { 
        matrix: { x: x_matrix, y: y_matrix, z: z_matrix },
        flat:   { x: x_flat,   y: y_flat,   z: z_flat }
    };
}