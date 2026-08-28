import { useState, useEffect, useCallback } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { api } from '../api/client.js';
import {
  HistoricalPerformanceRange,
  HistoricalPerformanceResponse,
  HistoricalPerformanceTrendPoint,
} from '../types/index.js';
import {
  TrendingUp,
  Award,
  Calendar,
  AlertCircle,
  RefreshCw,
  Activity,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface SignalPerformanceChartProps {
  refreshTrigger?: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0]?.payload as HistoricalPerformanceTrendPoint;
  if (!point) return null;

  return (
    <div className="bg-slate-900/95 border border-slate-700/80 rounded-lg p-3 shadow-2xl text-xs font-mono space-y-1.5 min-w-[180px]">
      <div className="text-slate-300 font-semibold border-b border-slate-800 pb-1 flex items-center justify-between">
        <span>{point.period}</span>
        <span
          className={
            point.successRate !== null
              ? point.successRate >= 50
                ? 'text-emerald-400 font-bold'
                : 'text-amber-400 font-bold'
              : 'text-slate-500'
          }
        >
          {point.successRate !== null ? `${point.successRate}%` : 'N/A'}
        </span>
      </div>
      <div className="flex justify-between text-slate-400">
        <span>Completed:</span>
        <span className="text-white font-bold">{point.completed}</span>
      </div>
      <div className="flex justify-between text-emerald-400">
        <span>Wins:</span>
        <span className="font-bold">{point.wins}</span>
      </div>
      <div className="flex justify-between text-rose-400">
        <span>Losses:</span>
        <span className="font-bold">{point.losses}</span>
      </div>
    </div>
  );
}

export function SignalPerformanceChart({ refreshTrigger }: SignalPerformanceChartProps) {
  const [data, setData] = useState<HistoricalPerformanceResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<HistoricalPerformanceRange>('30D');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getHistoricalPerformance(timeRange);
      if (res && res.success && res.summary) {
        setData(res);
        setError(null);
      } else {
        throw new Error(res?.message || 'Invalid performance response');
      }
    } catch (err: unknown) {
      console.error('[SignalPerformanceChart] Failed to load historical performance:', err);
      setError('Unable to load historical performance.\nPlease try again.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const ranges: HistoricalPerformanceRange[] = ['7D', '30D', '90D', 'ALL'];

  return (
    <div className="bg-slate-950 border border-slate-800/90 rounded-xl p-4 sm:p-6 shadow-xl space-y-6">
      {/* Header & Range Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Historical Signal Performance
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Actual completed signal outcomes over time
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 shrink-0">
            {ranges.map((range) => (
              <button
                key={range}
                type="button"
                id={`btn-range-${range.toLowerCase()}`}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 rounded text-xs font-mono font-medium transition cursor-pointer ${
                  timeRange === range
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-white border border-transparent'
                }`}
              >
                {range}
              </button>
            ))}
          </div>

          <button
            type="button"
            id="btn-refresh-performance"
            onClick={loadData}
            disabled={loading}
            title="Refresh historical performance"
            className="p-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-slate-300 rounded-lg border border-slate-800 transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-8 flex flex-col items-center justify-center min-h-[300px] text-slate-400 space-y-3">
          <Activity className="w-7 h-7 text-emerald-400 animate-spin" />
          <p className="text-xs font-mono text-slate-300">Loading historical performance...</p>
        </div>
      ) : error ? (
        /* Error State */
        <div className="bg-slate-900/50 border border-rose-900/30 rounded-xl p-8 flex flex-col items-center justify-center min-h-[300px] text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-rose-400" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-rose-300">Unable to load historical performance.</p>
            <p className="text-xs text-slate-400">Please try again.</p>
          </div>
          <button
            type="button"
            id="btn-retry-performance"
            onClick={loadData}
            className="mt-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Completed */}
            <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-3 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-mono tracking-wider">Completed</span>
                <span className="text-lg font-bold font-mono text-white mt-0.5 block">
                  {data?.summary.totalCompleted ?? 0}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                <Calendar className="w-4 h-4" />
              </div>
            </div>

            {/* Wins */}
            <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-3 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-mono tracking-wider">Wins</span>
                <span className="text-lg font-bold font-mono text-emerald-400 mt-0.5 block">
                  {data?.summary.wins ?? 0}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>

            {/* Losses */}
            <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-3 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-mono tracking-wider">Losses</span>
                <span className="text-lg font-bold font-mono text-rose-400 mt-0.5 block">
                  {data?.summary.losses ?? 0}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <XCircle className="w-4 h-4" />
              </div>
            </div>

            {/* Success Rate */}
            <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-3 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-mono tracking-wider">Success Rate</span>
                <span className="text-lg font-bold font-mono text-emerald-400 mt-0.5 block">
                  {data?.summary.successRate !== null && data?.summary.successRate !== undefined
                    ? `${data.summary.successRate.toFixed(1)}%`
                    : 'N/A'}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Chart or Empty State */}
          {!data || data.summary.totalCompleted === 0 || data.trend.length === 0 ? (
            /* Empty State */
            <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-8 flex flex-col items-center justify-center min-h-[260px] text-center space-y-2">
              <Award className="w-8 h-8 text-slate-600 mb-1" />
              <p className="text-sm font-semibold text-slate-300">No completed signal results yet</p>
              <p className="text-xs text-slate-500 max-w-sm">
                Performance trends will appear here once signals have recorded final outcomes.
              </p>
            </div>
          ) : (
            /* Recharts Responsive Chart */
            <div className="h-[280px] w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="period"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: '#334155' }}
                  />
                  <YAxis
                    yAxisId="rate"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: '#334155' }}
                    domain={[0, 100]}
                    unit="%"
                    tickFormatter={(val) => `${val}%`}
                  />
                  <YAxis
                    yAxisId="volume"
                    orientation="right"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: '#334155' }}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                    formatter={(value) => <span className="text-slate-300 font-mono">{value}</span>}
                  />
                  <Bar
                    yAxisId="volume"
                    dataKey="wins"
                    name="Wins"
                    fill="#10b981"
                    opacity={0.85}
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    yAxisId="volume"
                    dataKey="losses"
                    name="Losses"
                    fill="#f43f5e"
                    opacity={0.85}
                    radius={[3, 3, 0, 0]}
                  />
                  <Area
                    yAxisId="rate"
                    type="monotone"
                    dataKey="successRate"
                    name="Success Rate (%)"
                    stroke="#38bdf8"
                    fill="rgba(56, 189, 248, 0.08)"
                    strokeWidth={2}
                    connectNulls
                  />
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="successRate"
                    name="Success Rate Trend"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={{ r: 4, fill: '#38bdf8' }}
                    activeDot={{ r: 6, fill: '#7dd3fc' }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
