/**
 * Registers the Chart.js pieces the results tabs use, once. Chart.js is tree-shaken, so a chart
 * that is not registered renders nothing rather than erroring, and two files registering the same
 * pieces is harmless but noisy: keep it here and import this for its side effect.
 */
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);
