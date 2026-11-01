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
        borderWidth: 0,
        borderColor: "transparent",
        hoverOffset: 6,
        spacing: 0,
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

const PALETTE = [
  "#24c6dc", "#5996eb", "#20d89b", "#f5b942", "#f56b6b",
  "#aa3bff", "#ff7b87", "#38bdf8", "#fb923c", "#a78bfa",
  "#4ade80", "#f43f5e", "#06b6d4", "#eab308", "#818cf8", "#10b981",
];

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

    const usedColors = new Set<string>();

    return sectors.map((s, idx) => {
      const rawColor = s.color ? s.color.trim() : "";
      const isGrey = isGreyOrNeutralColor(rawColor);
      const isDuplicate = Boolean(rawColor && usedColors.has(rawColor.toLowerCase()));

      let finalColor = rawColor;
      if (isGrey || isDuplicate || !finalColor) {
        const unused = PALETTE.find((c) => !usedColors.has(c.toLowerCase()));
        finalColor = unused ?? PALETTE[idx % PALETTE.length];
      }

      usedColors.add(finalColor.toLowerCase());

      return {
        ...s,
        value: Number(Number(s.value).toFixed(2)),
        color: finalColor,
      };
    });
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
