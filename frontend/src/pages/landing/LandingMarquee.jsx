// src/pages/landing/LandingMarquee.jsx
const TAGS = [
  'Semantic Search', 'Vector Embeddings', 'AI Q&A with Citations',
  'Multi-Document Retrieval', 'Real-Time WebSockets',
  'NestJS · FastAPI · React', 'FAISS Vector Store',
  'HuggingFace LLM', 'Workspace Collaboration',
  'Prisma ORM · PostgreSQL', 'JWT Authentication',
];

const LandingMarquee = () => (
  <div className="marquee-wrap">
    <div className="marquee-track">
      {/* Duplicate set for seamless infinite scroll */}
      {[...TAGS, ...TAGS].map((tag, i) => (
        <div className="marquee-item" key={i}>
          <em>·</em>
          {tag}
        </div>
      ))}
    </div>
  </div>
);

export default LandingMarquee;
