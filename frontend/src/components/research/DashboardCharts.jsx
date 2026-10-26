/**
 * Dashboard charts
 * Small hand-built SVG/HTML charts for the overview page: library activity per
 * day or week, index status, and papers per collection. Each chart has a hover
 * and keyboard readout, and every value is also available without hovering
 * (legend counts, direct labels or a screen-reader table).
 *
 * Colours: one series colour (the app accent, --viz-series) and the fixed
 * status palette in design-system.css (--viz-good / --viz-warning / --viz-critical).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icons";
import { PROCESSING_STATUSES, READY_STATUSES } from "../../utils/researchData";

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
// en-CA formats as YYYY-MM-DD, the same day key the server uses.
const dayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });

/** The viewer's IANA time zone, sent to the analytics endpoint so both series use local days. */
export const viewerTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
};
/** Width of an element, kept current with a ResizeObserver. */
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(node);
    setWidth(Math.floor(node.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Papers added and questions asked per bucket over the last `rangeDays` days,
 * in the viewer's local days (queriesByDay must be grouped in the same time
 * zone, see viewerTimeZone). Ranges over 30 days use weeks.
 */
export function buildActivitySeries({ papers = [], queriesByDay = [], rangeDays = 30 }) {
  const step = rangeDays > 30 ? 7 : 1;
  const count = Math.ceil(rangeDays / step);
  // Walk calendar days with setDate so DST changes never skip or repeat a day.
  const days = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (count * step - 1));
  for (let i = 0; i < count * step; i++) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  const buckets = Array.from({ length: count }, (_, index) => {
    const start = days[index * step];
    const end = days[index * step + step - 1];
    const label = step === 1 ? shortDate.format(start) : `${shortDate.format(start)} – ${shortDate.format(end)}`;
    return { key: dayKey.format(start), label, tick: shortDate.format(start), papers: 0, questions: 0 };
  });
  const bucketOfDay = new Map(days.map((day, i) => [dayKey.format(day), Math.floor(i / step)]));
  const place = (key, field, amount = 1) => {
    const index = bucketOfDay.get(key);
    if (index !== undefined) buckets[index][field] += amount;
  };
  for (const paper of papers) {
    const time = new Date(paper.createdAt);
    if (!Number.isNaN(time.getTime())) place(dayKey.format(time), "papers");
  }
  for (const row of queriesByDay) place(row.date, "questions", row.count || 0);
  return buckets;
}

function niceMax(value) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s * 4 >= value) || magnitude * 10;
  return step * 4;
}

/** Column path with 4px rounded top corners, anchored flat on the baseline. */
function columnPath(x, y, width, height) {
  const r = Math.min(4, width / 2, height);
  const bottom = y + height;
  return `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${bottom}Z`;
}

/** Single-series column chart with a per-column tooltip (pointer and arrow keys). */
export function ColumnChart({ title, data, field, unit, height = 168 }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const pad = { top: 10, right: 4, bottom: 24, left: 30 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d[field])));
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(26, band * 0.7, band - 2));
  const y = (value) => pad.top + plotH - (value / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelIndexes = data.length > 2 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : data.map((_, i) => i);
  const total = data.reduce((sum, d) => sum + d[field], 0);
  const current = active == null ? null : data[active];

  const onKeyDown = (event) => {
    if (!data.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setActive((value) => Math.min(data.length - 1, Math.max(0, (value ?? (delta > 0 ? -1 : data.length)) + delta)));
    }
    if (event.key === "Escape") setActive(null);
  };

  const tipLeft = current ? Math.min(Math.max(pad.left + band * (active + 0.5), 70), Math.max(70, width - 70)) : 0;

  return (
    <figure className="viz-chart">
      <figcaption className="viz-chart-head">
        <span>{title}</span>
        <strong>{total}</strong>
      </figcaption>
      <div className="viz-plot" ref={ref} style={{ height }} onPointerLeave={() => setActive(null)}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${title}: ${total} ${unit} in this range. Use the left and right arrow keys to read each ${data.length > 13 ? "week" : "day"}.`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="viz-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
                <text className="viz-axis" x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{tick}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const value = d[field];
              const x = pad.left + band * i + (band - barW) / 2;
              const h = (value / max) * plotH;
              return (
                <g key={d.key} className={active != null && active !== i ? "viz-dim" : undefined}>
                  {value > 0 && <path className="viz-column" d={columnPath(x, pad.top + plotH - h, barW, h)} />}
                  <rect
                    className="viz-hit"
                    x={pad.left + band * i}
                    y={pad.top}
                    width={band}
                    height={plotH}
                    onPointerEnter={() => setActive(i)}
                  />
                </g>
              );
            })}
            {current && (
              <line
                className="viz-crosshair"
                x1={pad.left + band * (active + 0.5)}
                x2={pad.left + band * (active + 0.5)}
                y1={pad.top}
                y2={pad.top + plotH}
              />
            )}
            {labelIndexes.map((i, n) => (
              <text
                key={data[i].key}
                className="viz-axis"
                x={pad.left + band * (i + 0.5)}
                y={height - 6}
                textAnchor={n === 0 && labelIndexes.length > 1 ? "start" : n === labelIndexes.length - 1 && labelIndexes.length > 1 ? "end" : "middle"}
              >
                {data[i].tick}
              </text>
            ))}
          </svg>
        )}
        {current && (
          <div className="viz-tooltip" style={{ left: tipLeft }} role="status">
            <strong>{current[field]}</strong> <span>{current[field] === 1 ? unit.replace(/s$/, "") : unit}</span>
            <small>{current.label}</small>
          </div>
        )}
      </div>
      <table className="viz-sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}><th scope="row">{d.label}</th><td>{d[field]}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const STATUS_GROUPS = [
  { key: "ready", label: "Ready", icon: "check", tone: "good", match: (s) => READY_STATUSES.includes(s) },
  { key: "indexing", label: "Indexing", icon: "clock", tone: "warning", match: (s) => s === "PENDING" || PROCESSING_STATUSES.includes(s) },
  { key: "failed", label: "Failed", icon: "close", tone: "critical", match: (s) => s === "FAILED" },
];

/** One 100% bar of paper statuses with a legend that doubles as the readout. */
export function StatusMeter({ papers = [], onSelect }) {
  const [active, setActive] = useState(null);
  const groups = useMemo(
    () => STATUS_GROUPS.map((group) => ({ ...group, value: papers.filter((p) => group.match(p.status)).length })),
    [papers],
  );
  const total = papers.length;
  const pct = (value) => (total ? Math.round((value / total) * 100) : 0);

  return (
    <div className="viz-status" onPointerLeave={() => setActive(null)}>
      <div className="viz-meter" role="img" aria-label={groups.map((g) => `${g.label} ${g.value}`).join(", ")}>
        {total === 0 && <span className="viz-meter-empty" />}
        {groups.filter((g) => g.value > 0).map((g) => (
          <span
            key={g.key}
            className={`viz-meter-seg tone-${g.tone} ${active && active !== g.key ? "viz-dim" : ""}`}
            style={{ flexGrow: g.value }}
            onPointerEnter={() => setActive(g.key)}
          />
        ))}
      </div>
      <ul className="viz-legend">
        {groups.map((g) => (
          <li key={g.key}>
            <button
              type="button"
              className={`viz-legend-row ${active === g.key ? "is-active" : ""}`}
              onPointerEnter={() => setActive(g.key)}
              onFocus={() => setActive(g.key)}
              onBlur={() => setActive(null)}
              onClick={() => onSelect?.(g.key)}
            >
              <span className={`viz-legend-icon tone-${g.tone}`}><Icon name={g.icon} size={13} /></span>
              <span className="viz-legend-label">{g.label}</span>
              <strong>{g.value}</strong>
              <small>{pct(g.value)}%</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars, one per collection (top six, the rest folded into "Other"). */
export function CollectionBars({ collections = [], papers = [], onOpen }) {
  const [active, setActive] = useState(null);
  const rows = useMemo(() => {
    const all = collections
      .map((collection) => {
        const own = papers.filter((p) => p.collectionId === collection.id);
        return {
          id: collection.id,
          workspaceId: collection.workspaceId,
          name: collection.name,
          value: own.length,
          ready: own.filter((p) => READY_STATUSES.includes(p.status)).length,
        };
      })
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    if (all.length <= 7) return all;
    const rest = all.slice(6);
    return [
      ...all.slice(0, 6),
      {
        id: "other",
        name: `Other (${rest.length} collections)`,
        value: rest.reduce((sum, r) => sum + r.value, 0),
        ready: rest.reduce((sum, r) => sum + r.ready, 0),
      },
    ];
  }, [collections, papers]);
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <ul className="viz-bars" onPointerLeave={() => setActive(null)}>
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            className={`viz-bar-row ${active && active !== row.id ? "viz-dim" : ""}`}
            onPointerEnter={() => setActive(row.id)}
            onFocus={() => setActive(row.id)}
            onBlur={() => setActive(null)}
            onClick={() => row.id !== "other" && onOpen?.(row)}
            disabled={row.id === "other"}
            aria-label={`${row.name}: ${row.value} papers, ${row.ready} ready`}
          >
            <span className="viz-bar-name">{row.name}</span>
            <span className="viz-bar-track">
              {row.value > 0 && <span className="viz-bar-fill" style={{ width: `${(row.value / max) * 100}%` }} />}
            </span>
            <span className="viz-bar-value">
              <strong>{row.value}</strong>
              {active === row.id && <small>{row.ready} ready</small>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
