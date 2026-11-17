import {
  ArcElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";
import { useState, useCallback, useMemo } from "react";
import "./chartUtils.css";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler
);

export type ChartRangeKey = "30D" | "6M" | "1Y";

export type SectorSlice = {
  name: string;
  value: number;
  color: string;
};

function getProfitChartData(
  values: number[],
  labels: string[]
): ChartData<"line"> {
  return {
    labels,
    datasets: [
      {
        label: "Portfolio",
        data: values,
        borderColor: "#27c7dc",
        backgroundColor: "rgba(39, 199, 220, 0.18)",
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: "#7ef3ff",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
        fill: true,
        tension: 0.35,
      },
    ],
  };
}

function getAllocationChartData(
  sectors: SectorSlice[]
): ChartData<"doughnut"> {
  return {
    labels: sectors.map((sector) => sector.name),
    datasets: [
      {
        data: sectors.map((sector) => sector.value),
        backgroundColor: sectors.map((sector) => sector.color),
        borderWidth: 2,
        borderColor: "#0b1426",
        hoverBorderColor: "#ffffff",
        hoverOffset: 6,
        spacing: 1,
      },
    ],
  };
}

function profitLineChartOptions(): ChartOptions<"line"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    events: [
      "mousemove",
      "mouseout",
      "click",
      "touchstart",
      "touchmove",
      "touchend",
    ],
    interaction: {
      mode: "nearest",
      intersect: false,
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: "rgba(7, 20, 38, 0.96)",
        titleColor: "#b7faff",
        bodyColor: "#f7fbff",
        borderColor: "rgba(126, 243, 255, 0.5)",
        borderWidth: 1,
        displayColors: false,
        padding: 10,
        callbacks: {
          label: (context) =>
            ` ${(context.parsed.y ?? 0).toLocaleString("en-IN", {
              maximumFractionDigits: 2,
            })}`,
        },
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: "Date",
          color: "#b7faff",
          font: { size: 11, weight: 600 },
        },
        grid: { display: false },
        ticks: { color: "#8ea2b7", maxRotation: 0, autoSkip: true, font: { size: 10 } },
        border: { display: false },
      },
      y: {
        title: {
          display: true,
          text: "Profit",
          color: "#b7faff",
          font: { size: 11, weight: 600 },
        },
        grid: { color: "rgba(148, 163, 184, 0.18)" },
        ticks: {
          color: "#8ea2b7",
          callback: (value) =>
            `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
          font: { size: 9 },
        },
        border: { display: false },
      },
    },
  };
}

function allocationDoughnutChartOptions(
  onSelect: (index: number | null) => void
): ChartOptions<"doughnut"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    events: ["mousemove", "mouseout", "touchstart", "touchmove", "touchend"],
    cutout: "58%",
    interaction: {
      mode: "nearest",
      intersect: true,
    },
    layout: {
      padding: 16,
    },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
    animation: { duration: 150 },
    onHover: (_, elements) => {
      if (elements.length > 0) {
        const index = elements[0].index;
        if (typeof index === "number") {
          onSelect(index);
          return;
        }
      }
      onSelect(null);
    },
  };
}

export function ProfitLineChart({
  values,
  labels,
}: Readonly<{
  values: number[];
  labels: string[];
}>) {
  const chartData = useMemo(() => getProfitChartData(values, labels), [values, labels]);
  const chartOptions = useMemo(() => profitLineChartOptions(), []);

  return (
    <div className="chartjs-shell chartjs-line-shell">
      <Line data={chartData} options={chartOptions} />
    </div>
  );
}

export const DISTINCT_CHART_PALETTE = [
  "#3b82f6", // 1. Vibrant Blue
  "#ff6d00", // 2. Electric Orange
  "#10b981", // 3. Emerald Green
  "#ec4899", // 4. Hot Pink
  "#eab308", // 5. Golden Yellow
  "#8b5cf6", // 6. Vivid Purple
  "#00e5ff", // 7. Neon Cyan
  "#ef4444", // 8. Crimson Red
  "#84cc16", // 9. Lime Green
  "#6366f1", // 10. Indigo Blue
  "#d946ef", // 11. Electric Magenta
  "#14b8a6", // 12. Deep Teal
  "#f97316", // 13. Sunset Orange
  "#38bdf8", // 14. Sky Azure
  "#b45309", // 15. Warm Bronze
  "#c084fc", // 16. Lilac Lavender
  "#2dd4bf", // 17. Aquamarine
  "#f43f5e", // 18. Coral Rose
  "#06b6d4", // 19. Aqua Cyan
  "#a855f7", // 20. Neon Purple
  "#e11d48", // 21. Ruby Red
  "#22c55e", // 22. Spring Green
  "#0ea5e9", // 23. Light Azure
  "#fb7185", // 24. Salmon Rose
];

export const PALETTE = DISTINCT_CHART_PALETTE;

export function parseColorToRgb(colorStr?: string): { r: number; g: number; b: number } | null {
  if (!colorStr) return null;
  const c = colorStr.trim().toLowerCase();
  if (c.startsWith("#")) {
    let hex = c.slice(1);
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return { r, g, b };
      }
    }
  }
  const rgbMatch = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return { r, g, b };
    }
  }
  return null;
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (delta !== 0) {
    if (max === rNorm) {
      h = ((gNorm - bNorm) / delta) % 6;
    } else if (max === gNorm) {
      h = (bNorm - rNorm) / delta + 2;
    } else {
      h = (rNorm - gNorm) / delta + 4;
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  return { h, s, l };
}

/**
 * Calculates human perceptual color distance using the Redmean formula (standard approximation of CIELAB ΔE).
 * Returns a value from 0 (identical) to ~765 (complete opposites like black vs white).
 */
export function getColorDistance(c1?: string, c2?: string): number {
  if (!c1 || !c2) return 999;
  if (c1.trim().toLowerCase() === c2.trim().toLowerCase()) return 0;
  const rgb1 = parseColorToRgb(c1);
  const rgb2 = parseColorToRgb(c2);
  if (!rgb1 || !rgb2) return 999;

  const rmean = (rgb1.r + rgb2.r) / 2;
  const dr = rgb1.r - rgb2.r;
  const dg = rgb1.g - rgb2.g;
  const db = rgb1.b - rgb2.b;
  return Math.sqrt(
    (2 + rmean / 256) * dr * dr +
    4 * dg * dg +
    (2 + (255 - rmean) / 256) * db * db
  );
}

/**
 * Checks whether two colors are perceptually identical or too similar in hue/shade.
 * Detects both low mathematical distance and same hue family (e.g. green vs light green, amber vs yellow).
 */
export function areColorsTooClose(c1?: string, c2?: string, threshold = 100): boolean {
  if (!c1 || !c2) return false;
  if (c1.trim().toLowerCase() === c2.trim().toLowerCase()) return true;

  const rgb1 = parseColorToRgb(c1);
  const rgb2 = parseColorToRgb(c2);
  if (!rgb1 || !rgb2) return false;

  const dist = getColorDistance(c1, c2);
  if (dist < threshold) return true;

  // Check hue family proximity: if both have clear saturation, check hue difference
  const hsl1 = rgbToHsl(rgb1.r, rgb1.g, rgb1.b);
  const hsl2 = rgbToHsl(rgb2.r, rgb2.g, rgb2.b);

  if (hsl1.s > 0.18 && hsl2.s > 0.18 && hsl1.l > 0.15 && hsl2.l > 0.15) {
    const hueDiff = Math.min(Math.abs(hsl1.h - hsl2.h), 360 - Math.abs(hsl1.h - hsl2.h));
    // If hues are closer than 32° and distance is under 160, human eye perceives them as the same color family
    if (hueDiff < 32 && dist < 160) {
      return true;
    }
  }

  return false;
}

function hslToHex(h: number, s: number, l: number): string {
  const normH = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((normH / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (normH < 60) { r = c; g = x; b = 0; }
  else if (normH < 120) { r = x; g = c; b = 0; }
  else if (normH < 180) { r = 0; g = c; b = x; }
  else if (normH < 240) { r = 0; g = x; b = c; }
  else if (normH < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Generates a golden-angle color (~137.5° hue progression) for maximum perceptual separation.
 */
export function getGoldenAngleColor(index: number): string {
  const hue = Math.round((index * 137.5077) % 360);
  const lightness = index % 2 === 0 ? 56 : 64;
  return hslToHex(hue, 85, lightness);
}

/**
 * Guarantees that every item in the list receives a genuinely distinct, unique color.
 * Replaces duplicate, conflicting, or perceptually indistinguishable colors with unique vibrant hues.
 */
export function ensureDistinctColors<T extends { color?: string }>(items: T[]): (T & { color: string })[] {
  if (!items || items.length === 0) return [];

  const assignedColors: string[] = [];

  return items.map((item, index) => {
    const rawColor = item.color ? item.color.trim() : "";
    const isGrey = isGreyOrNeutralColor(rawColor);

    let isValid = Boolean(rawColor && !isGrey);
    if (isValid) {
      for (const existing of assignedColors) {
        if (areColorsTooClose(rawColor, existing, 100)) {
          isValid = false;
          break;
        }
      }
    }

    let finalColor = isValid ? rawColor : "";

    if (!finalColor) {
      // 1. Search in DISTINCT_CHART_PALETTE for a color with sufficient perceptual and hue distance
      for (const candidate of DISTINCT_CHART_PALETTE) {
        let candidateOk = true;
        for (const existing of assignedColors) {
          if (areColorsTooClose(candidate, existing, 100)) {
            candidateOk = false;
            break;
          }
        }
        if (candidateOk) {
          finalColor = candidate;
          break;
        }
      }

      // 2. If palette is exhausted or saturated, generate using golden-angle / equidistant algorithm
      if (!finalColor) {
        let bestCandidate = getGoldenAngleColor(index);
        let maxMinDistance = -1;
        for (let attempt = 0; attempt < 24; attempt++) {
          const candidate = getGoldenAngleColor(index * 3 + attempt * 7);
          let minDist = Infinity;
          for (const existing of assignedColors) {
            const dist = getColorDistance(candidate, existing);
            if (dist < minDist) minDist = dist;
          }
          if (minDist > maxMinDistance) {
            maxMinDistance = minDist;
            bestCandidate = candidate;
          }
          if (minDist >= 100) {
            bestCandidate = candidate;
            break;
          }
        }
        finalColor = bestCandidate;
      }
    }

    assignedColors.push(finalColor);

    return {
      ...item,
      color: finalColor,
    };
  });
}

export function isGreyOrNeutralColor(colorStr?: string): boolean {
  if (!colorStr) return true;
  const c = colorStr.trim().toLowerCase();
  if (
    c === "" ||
    c === "transparent" ||
    c === "none" ||
    c === "gray" ||
    c === "grey" ||
    c === "#808080" ||
    c === "#94a3b8" ||
    c === "#64748b" ||
    c === "#9ca3af" ||
    c === "#cbd5e1" ||
    c === "#8ea2b7" ||
    c === "#9fb3c8" ||
    c === "#475569" ||
    c === "#334155" ||
    c === "#718096" ||
    c === "#a0aec0" ||
    c === "#e2e8f0" ||
    c === "#f1f5f9"
  ) {
    return true;
  }
  if (c.startsWith("#")) {
    let hex = c.slice(1);
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        if (Math.max(r, g, b) - Math.min(r, g, b) < 24) {
          return true;
        }
      }
    }
  }
  const rgbMatch = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    if (Math.max(r, g, b) - Math.min(r, g, b) < 24) {
      return true;
    }
  }
  return false;
}

export function AllocationDoughnutChart({
  sectors,
}: Readonly<{
  sectors: SectorSlice[];
}>) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const handleSelect = useCallback((nextIndex: number | null) => {
    setSelectedIndex((prev) => (prev === nextIndex ? prev : nextIndex));
  }, []);

  const coloredSectors = useMemo(() => {
    if (!sectors || sectors.length === 0) return [];
    return ensureDistinctColors(
      sectors.map((s) => ({
        ...s,
        value: Number(Number(s.value).toFixed(2)),
      }))
    );
  }, [sectors]);

  const chartData = useMemo(() => getAllocationChartData(coloredSectors), [coloredSectors]);
  const chartOptions = useMemo(
    () => allocationDoughnutChartOptions(handleSelect),
    [handleSelect]
  );

  const activeSector = selectedIndex === null ? null : coloredSectors[selectedIndex];

  return (
    <div
      className="chartjs-shell chartjs-doughnut-shell"
      onMouseLeave={() => handleSelect(null)}
      onTouchEnd={() => handleSelect(null)}
    >
      <Doughnut data={chartData} options={chartOptions} />
      {activeSector && (
        <div
          className="donut-selection-tooltip"
          style={{
            borderColor: activeSector.color,
            boxShadow: `0 0 0 1px ${activeSector.color}33`,
          }}
        >
          <span>{activeSector.name}</span>
          <strong>{Number(Number(activeSector.value).toFixed(2))}%</strong>
        </div>
      )}
    </div>
  );
}
