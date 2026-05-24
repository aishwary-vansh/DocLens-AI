import Icon from "./Icons";
import { formatDate, formatShortDate, STATUS_META } from "../../utils/researchData";

export function PageHeader({ eyebrow, title, description, actions, meta }) {
  return (
    <header className="research-page-header">
      <div className="research-page-copy">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {meta && <div className="header-meta">{meta}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function ActionButton({ children, icon = "arrowRight", variant = "primary", onClick, disabled, type = "button" }) {
  return (
    <button type={type} className={`rp-button rp-button-${variant}`} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </button>
  );
}

export function ResearchStatCard({ icon, label, value, trend, growth, description, tone = "blue" }) {
  return (
    <article className={`research-stat-card tone-${tone}`}>
      <div className="stat-card-topline">
        <span className="stat-icon"><Icon name={icon} size={20} /></span>
        {trend && <span className="stat-trend"><Icon name="trendUp" size={13} /> {trend}</span>}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      <p>{description}</p>
      {growth && <div className="growth-indicator">{growth}</div>}
    </article>
  );
}

export function ProcessingStatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status || "Unknown", tone: "muted" };
  return (
    <span className={`status-badge status-${meta.tone}`}>
      <span />
      {meta.label}
    </span>
  );
}

export function CitationBadge({ count = 0 }) {
  return (
    <span className="citation-badge">
      <Icon name="citation" size={13} />
      {count} citations
    </span>
  );
}

export function PaperCard({ paper, onOpen }) {
  return (
    <article className="paper-card" onClick={onOpen}>
      <div className="paper-card-header">
        <div className="paper-file-icon"><Icon name="papers" size={20} /></div>
        <ProcessingStatusBadge status={paper.status} />
      </div>
      <h3>{paper.title}</h3>
      <p className="paper-authors">{paper.authors || "Author metadata pending"}</p>
      <div className="paper-meta-grid">
        <span><strong>{formatShortDate(paper.uploadDate || paper.createdAt)}</strong> Uploaded</span>
        <span><strong>{paper.pages || 0}</strong> Pages</span>
      </div>
      <div className="paper-card-footer">
        <span>{paper.collectionName || "Unassigned"}</span>
        <CitationBadge count={paper.citations || 0} />
      </div>
    </article>
  );
}

export function CollectionCard({ collection, metrics, onOpen, suggested = false }) {
  const featureList = collection.features || ["semantic search", "paper intelligence", "literature review"];

  return (
    <article className={`collection-card tone-${collection.tone || "blue"}`}>
      <div className="collection-card-top">
        <span className="collection-icon"><Icon name="collections" size={21} /></span>
        <span className="collection-status">{suggested ? "Template" : "Research domain"}</span>
      </div>
      <h3>{collection.name}</h3>
      <p>{collection.description || "A focused research collection for papers, notes, and literature reviews."}</p>
      <div className="collection-metrics">
        <span><strong>{metrics?.papers ?? collection.papers ?? 0}</strong> Papers</span>
        <span><strong>{metrics?.reviews ?? collection.reviews ?? 0}</strong> Reviews</span>
        <span><strong>{metrics?.citations ?? 0}</strong> Citations</span>
      </div>
      <div className="concept-row">
        {featureList.slice(0, 3).map((feature) => <span key={feature}>{feature}</span>)}
      </div>
      <button className="card-link" onClick={onOpen} disabled={suggested}>
        {suggested ? "Create to activate" : "Open collection"} <Icon name="arrowRight" size={14} />
      </button>
    </article>
  );
}

export function ActivityTimeline({ items = [] }) {
  if (!items.length) {
    return (
      <EmptyState
        compact
        icon="activity"
        title="No research activity yet"
        description="Upload papers, create collections, or ask research questions to populate this timeline."
      />
    );
  }

  return (
    <div className="activity-timeline">
      {items.map((item) => (
        <div className={`activity-item tone-${item.tone || "blue"}`} key={item.id}>
          <div className="activity-dot" />
          <div>
            <span>{item.type}</span>
            <strong>{item.title}</strong>
            <p>{item.meta}</p>
          </div>
          <time>{item.time}</time>
        </div>
      ))}
    </div>
  );
}


export function EmptyState({ icon = "papers", title, description, action, compact = false }) {
  return (
    <div className={`empty-state ${compact ? "empty-state-compact" : ""}`}>
      <div className="empty-icon"><Icon name={icon} size={22} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function LoadingSkeleton({ rows = 3, variant = "card" }) {
  return (
    <div className={`skeleton-stack skeleton-${variant}`}>
      {Array.from({ length: rows }).map((_, index) => (
        <div className="rp-skeleton" key={index}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

export function Panel({ title, eyebrow, children, action, className = "" }) {
  return (
    <section className={`research-panel ${className}`}>
      {(title || eyebrow || action) && (
        <div className="panel-header">
          <div>
            {eyebrow && <span>{eyebrow}</span>}
            {title && <h2>{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="segmented-control" role="tablist">
      {options.map((option) => (
        <button
          className={value === option.value ? "active" : ""}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.icon && <Icon name={option.icon} size={14} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ResearchTable({ columns, rows, emptyTitle, emptyDescription }) {
  if (!rows.length) {
    return <EmptyState compact icon="papers" title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="research-table-wrap">
      <table className="research-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ErrorNotice({ message }) {
  if (!message) return null;
  return (
    <div className="error-notice">
      <Icon name="alert" size={17} />
      <span>{message}</span>
    </div>
  );
}

export function PaperSummaryLine({ paper }) {
  return (
    <div className="paper-summary-line">
      <div>
        <strong>{paper.title}</strong>
        <span>{paper.collectionName} / {formatDate(paper.createdAt)}</span>
      </div>
      <ProcessingStatusBadge status={paper.status} />
    </div>
  );
}
