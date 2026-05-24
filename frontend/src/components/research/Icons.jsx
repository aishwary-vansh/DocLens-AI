const paths = {
  dashboard: [
    "M3 4h7v7H3z",
    "M14 4h7v5h-7z",
    "M14 13h7v7h-7z",
    "M3 15h7v5H3z",
  ],
  collections: [
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    "M3 10h18",
  ],
  papers: [
    "M6 3h8l4 4v14H6z",
    "M14 3v5h5",
    "M8.5 12h7",
    "M8.5 16h7",
  ],
  chat: [
    "M4 5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 5z",
    "M8 8h8",
    "M8 12h5",
  ],

  analytics: [
    "M4 19V9",
    "M10 19V5",
    "M16 19v-7",
    "M22 19H2",
  ],
  settings: [
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    "M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.1 2.1 0 0 1-2.98 2.98l-.04-.04A1.8 1.8 0 0 0 14.8 19.6a1.8 1.8 0 0 0-1.1 1.66V21.3a2.1 2.1 0 0 1-4.2 0v-.04a1.8 1.8 0 0 0-1.1-1.66 1.8 1.8 0 0 0-1.98.36l-.04.04A2.1 2.1 0 0 1 3.4 17l.04-.04A1.8 1.8 0 0 0 3.8 15a1.8 1.8 0 0 0-1.66-1.1H2.1a2.1 2.1 0 0 1 0-4.2h.04A1.8 1.8 0 0 0 3.8 8.6a1.8 1.8 0 0 0-.36-1.98l-.04-.04A2.1 2.1 0 0 1 6.38 3.6l.04.04A1.8 1.8 0 0 0 8.4 4a1.8 1.8 0 0 0 1.1-1.66V2.3a2.1 2.1 0 0 1 4.2 0v.04A1.8 1.8 0 0 0 14.8 4a1.8 1.8 0 0 0 1.98-.36l.04-.04A2.1 2.1 0 0 1 19.8 6.58l-.04.04A1.8 1.8 0 0 0 19.4 8.6a1.8 1.8 0 0 0 1.66 1.1h.04a2.1 2.1 0 0 1 0 4.2h-.04A1.8 1.8 0 0 0 19.4 15z",
  ],
  upload: ["M12 16V4", "M7 9l5-5 5 5", "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"],
  download: ["M12 4v12", "M7 11l5 5 5-5", "M4 20h16"],
  plus: ["M12 5v14", "M5 12h14"],
  search: ["M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z", "M16 16l5 5"],
  arrowRight: ["M5 12h14", "M13 6l6 6-6 6"],
  trendUp: ["M4 16l5-5 4 4 7-8", "M15 7h5v5"],
  activity: ["M4 12h4l3-7 5 14 3-7h3"],
  quote: ["M9 8H5v5h4v5H4", "M20 8h-4v5h4v5h-5"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  book: ["M4 4h7a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H4z", "M20 4h-5a4 4 0 0 0-4 4"],

  link: ["M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1.1 1.1", "M14 11a5 5 0 0 0-7.07 0l-2 2A5 5 0 0 0 12 20.07l1.1-1.1"],
  filter: ["M4 5h16", "M7 12h10", "M10 19h4"],
  grid: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  table: ["M4 5h16v14H4z", "M4 10h16", "M4 15h16", "M10 5v14", "M16 5v14"],
  citation: ["M7 7h10", "M7 12h7", "M7 17h4", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"],
  alert: ["M12 9v4", "M12 17h.01", "M10.3 3.9 2 0 8.9 15.4a2 2 0 0 1-1.7 3H4.5a2 2 0 0 1-1.7-3z"],
  spark: ["M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6z", "M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"],
};

const polylinePaths = new Set(["dashboard", "table"]);

export default function Icon({ name, size = 18, strokeWidth = 1.8, className = "", title }) {
  const iconPaths = paths[name] || paths.dashboard;

  return (
    <svg
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths.map((d, index) => {
        const isRect = d.startsWith("M") && d.includes("h") && d.includes("v") && polylinePaths.has(name);
        return isRect ? <path key={index} d={d} /> : <path key={index} d={d} />;
      })}
    </svg>
  );
}
