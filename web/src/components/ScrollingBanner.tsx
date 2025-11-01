"use client";

import React from "react";

type Direction = "left" | "right";

interface ScrollingBannerProps {
  imageUrls: string[];
  heightPx?: number;
  gapPx?: number;
  speedSeconds?: number;
  direction?: Direction;
}

export default function ScrollingBanner({
  imageUrls,
  heightPx = 120,
  gapPx = 16,
  speedSeconds = 40,
  direction = "left",
}: ScrollingBannerProps) {
  const repeated = React.useMemo(() => imageUrls.concat(imageUrls), [imageUrls]);
  const animName = direction === "left" ? "scrollLeft" : "scrollRight";

  return (
    <div className="banner-container" style={{ height: `${heightPx}px` }}>
      <div
        className="banner-track"
        style={{
          gap: `${gapPx}px`,
          animationDuration: `${speedSeconds}s`,
          animationName: animName,
        }}
      >
        {repeated.map((src, idx) => (
          <div className="banner-item" key={`${src}-${idx}`} style={{ height: `${heightPx}px` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="showcase" className="banner-image" />
          </div>
        ))}
      </div>

      <style jsx>{`
        .banner-container {
          position: relative;
          width: 100%;
          overflow: hidden;
          mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
          -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
        }
        .banner-track {
          display: flex;
          align-items: center;
          width: max-content;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .banner-item {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
        }
        .banner-image {
          height: 100%;
          width: auto;
          border-radius: 8px;
          border: 1px solid rgba(0,0,0,0.08);
        }
        @keyframes scrollLeft {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes scrollRight {
          from { transform: translateX(-50%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}


