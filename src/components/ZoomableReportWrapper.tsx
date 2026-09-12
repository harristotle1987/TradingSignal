import React from 'react';

interface ZoomableReportWrapperProps {
  zoomLevel: number;
  children: React.ReactNode;
  className?: string;
  id?: string;
}

/**
 * ZoomableReportWrapper
 *
 * Scales children elements proportionally using modern CSS `zoom`,
 * with an overflow-x-auto container so larger zoom levels can be smoothly scrolled
 * and inspected without clipping or layout breaking.
 */
export const ZoomableReportWrapper: React.FC<ZoomableReportWrapperProps> = ({
  zoomLevel,
  children,
  className = '',
  id,
}) => {
  return (
    <div
      id={id}
      className={`w-full overflow-x-auto overflow-y-visible transition-[zoom] duration-150 ease-out ${className}`}
    >
      <div
        style={{
          zoom: zoomLevel,
          minWidth: zoomLevel > 1 ? `${Math.round(zoomLevel * 100)}%` : '100%',
        }}
        className="w-full origin-top-left transition-transform duration-150"
      >
        {children}
      </div>
    </div>
  );
};
