export const STATUS_META = {
  PENDING: { label: "Uploaded", tone: "info" },
  UPLOADED: { label: "Uploaded", tone: "info" },
  EXTRACTING: { label: "Processing", tone: "warning" },
  CHUNKING: { label: "Processing", tone: "warning" },
  EMBEDDING: { label: "Processing", tone: "warning" },
  INDEXING: { label: "Processing", tone: "warning" },
  READY: { label: "Ready", tone: "success" },
  COMPLETED: { label: "Ready", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
};

export const PROCESSING_STATUSES = ["UPLOADED", "EXTRACTING", "CHUNKING", "EMBEDDING", "INDEXING"];
export const READY_STATUSES = ["READY", "COMPLETED"];

export const suggestedCollections = [
  {
    id: "suggested-nlp",
    name: "NLP Research",
    description: "Language models, retrieval, evaluation, and applied natural language systems.",
    papers: 0,
    notes: 0,
    reviews: 0,
    tone: "green",
  },
  {
    id: "suggested-transformers",
    name: "Transformers",
    description: "Architectures, attention variants, scaling behavior, and inference efficiency.",
    papers: 0,
    notes: 0,
    reviews: 0,
    tone: "blue",
  },
  {
    id: "suggested-timeseries",
    name: "Time-Series Analysis",
    description: "Forecasting, temporal representation learning, and probabilistic modeling.",
    papers: 0,
    notes: 0,
    reviews: 0,
    tone: "amber",
  },
  {
    id: "suggested-anomaly",
    name: "Anomaly Detection",
    description: "Outlier detection, monitoring, unsupervised signals, and drift analysis.",
    papers: 0,
    notes: 0,
    reviews: 0,
    tone: "rose",
  },
];

export const sampleConcepts = [
  "retrieval augmented generation",
  "contrastive learning",
  "temporal graph networks",
  "attention sparsity",
  "evaluation benchmarks",
  "vector indexing",
  "citation grounding",
  "knowledge distillation",
];

export const sampleQueries = [
  "Which papers compare transformer efficiency tradeoffs?",
  "What methods are used for anomaly detection in temporal data?",
  "Summarize the evidence for retrieval improving factuality.",
  "Find datasets used to evaluate long-context models.",
];

export function formatDate(value, fallback = "No date") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatShortDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function estimatePages(document) {
  if (document.pageCount) return document.pageCount;
  if (!document.fileSize) return 12;
  return Math.max(4, Math.min(80, Math.round(document.fileSize / 95000)));
}

export function enrichDocument(document, collection, workspace) {
  const title = document.title || document.filename || "Untitled paper";
  const pages = estimatePages(document);
  const completed = READY_STATUSES.includes(document.status);

  return {
    ...document,
    title,
    uploadDate: document.createdAt,
    authors: document.metadata?.authors?.length ? document.metadata.authors.join(", ") : document.authors || "Author metadata pending",
    pages,
    collectionName: collection?.name || "Unassigned",
    collectionDescription: collection?.description || "",
    workspaceName: workspace?.name || "Research Workspace",
    workspaceId: workspace?.id || collection?.workspaceId,
    conceptsExtracted: document.metadata?.conceptsCount ?? 0,
    citations: document.metadata?.citationsCount ?? 0,
  };
}

export function buildResearchStats({ workspaces = [], collections = [], papers = [], serverStats = null }) {
  const completed = papers.filter((paper) => READY_STATUSES.includes(paper.status)).length;
  const processing = papers.filter((paper) => PROCESSING_STATUSES.includes(paper.status)).length;
  const citations = papers.reduce((sum, paper) => sum + (paper.citations || 0), 0);
  
  const localQueries = serverStats ? serverStats.queriesAsked : Number(localStorage.getItem("doclens_query_count") || 0);
  const literatureReviewsGenerated = serverStats ? serverStats.literatureReviews : Number(localStorage.getItem("doclens_review_count") || 0);

  return {
    papersUploaded: serverStats ? serverStats.papersUploaded : papers.length,
    collectionsCreated: serverStats ? serverStats.collectionsCreated : collections.length,
    literatureReviews: literatureReviewsGenerated,
    citationsGenerated: citations,
    queriesAsked: localQueries,
    workspaces: workspaces.length,
    completed,
    processing,
    failed: papers.filter((paper) => paper.status === "FAILED").length,
    readyRate: papers.length ? Math.round((completed / papers.length) * 100) : 0,
  };
}

export function buildActivityFeed({ collections = [], papers = [] }) {
  const paperItems = papers.slice(0, 6).map((paper) => ({
    id: `paper-${paper.id}`,
    type: "Paper uploaded",
    title: paper.title,
    meta: `${paper.collectionName} - ${STATUS_META[paper.status]?.label || paper.status}`,
    time: formatShortDate(paper.createdAt),
    tone: READY_STATUSES.includes(paper.status) ? "success" : paper.status === "FAILED" ? "danger" : "info",
  }));

  const collectionItems = collections.slice(0, 4).map((collection) => ({
    id: `collection-${collection.id}`,
    type: "Collection created",
    title: collection.name,
    meta: collection.workspaceName || "Research workspace",
    time: formatShortDate(collection.createdAt),
    tone: "violet",
  }));

  return [...paperItems, ...collectionItems]
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))
    .slice(0, 8);
}

export function getCollectionMetrics(collection, papers = []) {
  const collectionPapers = papers.filter((paper) => paper.collectionId === collection?.id);
  const citations = collectionPapers.reduce((sum, paper) => sum + (paper.citations || 0), 0);
  return {
    papers: collectionPapers.length,
    ready: collectionPapers.filter((paper) => READY_STATUSES.includes(paper.status)).length,
    notes: collection?.notesCount || 0,
    reviews: collection?.reviewsCount || 0,
    citations,
  };
}
