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
  HistoricalSignalOutcomeItem,
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
  Clock,
  ChevronDown,
  ChevronUp,
  Target,
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
  const [showOutcomesList, setShowOutcomesList] = useState<boolean>(false);

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

  const formatPrice = (val?: number) => {
    if (val === undefined || val === null || isNaN(val)) return '—';
    if (val < 0.001) return val.toFixed(6);
    if (val < 1) return val.toFixed(5);
    if (val < 50) return val.toFixed(4);
    return val.toFixed(2);
  };

  const getStatusBadge = (item: HistoricalSignalOutcomeItem) => {
    switch (item.status) {
      case 'WIN':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" />
            WIN
          </span>
        );
      case 'LOSS':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
            <XCircle className="w-3 h-3" />
            LOSS
          </span>
        );
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
            <Activity className="w-3 h-3" />
            ACTIVE
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <Clock className="w-3 h-3" />
            EXPIRED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-800 text-slate-400 border border-slate-700">
            {item.status}
          </span>
        );
    }
  };

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
            Accurate historical completed signal outcomes & audit breakdown
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

          {/* Additional Context Sub-bar if active or expired signals exist */}
          {((data?.summary.activeCount ?? 0) > 0 || (data?.summary.expiredCount ?? 0) > 0) && (
            <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-slate-900/40 rounded-lg border border-slate-800/60 text-xs font-mono text-slate-400">
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-400" />
                Active Setups: <strong className="text-sky-300">{data?.summary.activeCount ?? 0}</strong>
              </span>
              <span className="text-slate-600">•</span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Expired / No Entry: <strong className="text-amber-300">{data?.summary.expiredCount ?? 0}</strong>
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-400">
                Total Signals in Period: <strong className="text-slate-200">{data?.summary.totalSignals ?? 0}</strong>
              </span>
            </div>
          )}

          {/* Chart or Empty State */}
          {!data || data.summary.totalCompleted === 0 || data.trend.length === 0 ? (
            /* Empty State */
            <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-8 flex flex-col items-center justify-center min-h-[260px] text-center space-y-2">
              <Award className="w-8 h-8 text-slate-600 mb-1" />
              <p className="text-sm font-semibold text-slate-300">No completed signal results yet for {timeRange}</p>
              <p className="text-xs text-slate-500 max-w-sm">
                Performance trends will appear here once signals record completed outcomes (Take-Profit or Stop-Loss hits).
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

          {/* Expandable Signal Outcomes & Audit Table */}
          {data && data.recentOutcomes && data.recentOutcomes.length > 0 && (
            <div className="pt-2 border-t border-slate-800/80">
              <button
                type="button"
                id="btn-toggle-outcomes-audit"
                onClick={() => setShowOutcomesList(!showOutcomesList)}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/60 hover:bg-slate-900 text-xs font-mono text-slate-300 rounded-lg border border-slate-800/80 transition cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Target className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Signals Outcome Records ({data.recentOutcomes.length} signals in range)</span>
                </span>
                {showOutcomesList ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>

              {showOutcomesList && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/80">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3">Date / Time</th>
                        <th className="py-2.5 px-3">Symbol</th>
                        <th className="py-2.5 px-3">Dir</th>
                        <th className="py-2.5 px-3">Entry Price</th>
                        <th className="py-2.5 px-3">Take Profit</th>
                        <th className="py-2.5 px-3">Stop Loss</th>
                        <th className="py-2.5 px-3">R:R</th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-300">
                      {data.recentOutcomes.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-900/40 transition">
                          <td className="py-2 px-3 whitespace-nowrap text-slate-400 text-[11px]">
                            {new Date(item.timestamp).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-bold text-white">
                            {item.symbol}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                item.direction === 'BUY'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-rose-500/20 text-rose-400'
                              }`}
                            >
                              {item.direction}
                            </span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-slate-300">
                            {formatPrice(item.entryPrice)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-emerald-400">
                            {formatPrice(item.takeProfit || item.tp1)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-rose-400">
                            {formatPrice(item.stopLoss)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-slate-400">
                            {item.riskRewardRatio ? `${item.riskRewardRatio.toFixed(1)}:1` : '—'}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {getStatusBadge(item)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
