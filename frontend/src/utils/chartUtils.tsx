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
import { useState } from "react";
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
  sectors: SectorSlice[],
  selectedIndex: number | null
): ChartData<"doughnut"> {
  return {
    labels: sectors.map((sector) => sector.name),
    datasets: [
      {
        data: sectors.map((sector) => sector.value),
        backgroundColor: sectors.map((sector) => sector.color),
        borderWidth: 0,
        borderColor: "transparent",
        offset: sectors.map((_, index) =>
          selectedIndex === index ? 8 : 0
        ),
        hoverOffset: sectors.map((_, index) =>
          selectedIndex === index ? 8 : 0
        ),
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
  return (
    <div className="chartjs-shell chartjs-line-shell">
      <Line data={getProfitChartData(values, labels)} options={profitLineChartOptions()} />
    </div>
  );
}

export function AllocationDoughnutChart({
  sectors,
}: Readonly<{
  sectors: SectorSlice[];
}>) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const activeSector = selectedIndex === null ? null : sectors[selectedIndex];

  return (
    <div
      className="chartjs-shell chartjs-doughnut-shell"
      onMouseLeave={() => setSelectedIndex(null)}
      onTouchEnd={() => setSelectedIndex(null)}
    >
      <Doughnut
        data={getAllocationChartData(sectors, selectedIndex)}
        options={allocationDoughnutChartOptions(setSelectedIndex)}
      />
      {activeSector && (
        <div
          className="donut-selection-tooltip"
          style={{
            borderColor: activeSector.color,
            boxShadow: `0 0 0 1px ${activeSector.color}33`,
          }}
        >
          <span>{activeSector.name}</span>
          <strong>{activeSector.value}%</strong>
        </div>
      )}
    </div>
  );
}
