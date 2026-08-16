/**
 * Reusable Status Badge Component
 */

interface StatusBadgeProps {
  status: 'active' | 'configured' | 'unconfigured' | 'standby' | 'error' | 'ok';
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const getStyles = () => {
    switch (status) {
      case 'active':
      case 'configured':
      case 'ok':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          dot: 'bg-emerald-500 animate-pulse',
          defaultText: label || 'Configured',
        };
      case 'standby':
        return {
          bg: 'bg-amber-50 text-amber-800 border-amber-200',
          dot: 'bg-amber-500',
          defaultText: label || 'Standby',
        };
      case 'unconfigured':
      case 'error':
      default:
        return {
          bg: 'bg-slate-100 text-slate-700 border-slate-300',
          dot: 'bg-slate-400',
          defaultText: label || 'Not Configured',
        };
    }
  };

  const config = getStyles();

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${config.bg}`}
    >
      <span className={`w-2 h-2 rounded-full ${config.dot}`} />
      {config.defaultText}
    </span>
  );
}
