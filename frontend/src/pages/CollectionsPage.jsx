import { useMemo, useState } from "react";
import { collectionsApi, workspacesApi } from "../services/api";
import { useApp, PAGES } from "../contexts/AppContext";
import useResearchCorpus from "../hooks/useResearchCorpus";
import {
  ActionButton,
  CollectionCard,
  EmptyState,
  ErrorNotice,
  LoadingSkeleton,
  PageHeader,
  Panel,
  ResearchStatCard,
} from "../components/research/ResearchComponents";
import { buildResearchStats, getCollectionMetrics, suggestedCollections } from "../utils/researchData";
import Modal from "../components/ui/Modal";

const CollectionsPage = () => {
  const { navigateTo } = useApp();
  const { workspaces, collections, papers, loading, error, refresh } = useResearchCorpus();
  const [showCreate, setShowCreate] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const stats = useMemo(() => buildResearchStats({ workspaces, collections, papers }), [collections, papers, workspaces]);

  const openCreate = () => {
    setWorkspaceId(workspaces[0]?.id || "");
    setName("");
    setDescription("");
    setCreateError("");
    setShowCreate(true);
  };

  const createCollection = async (event) => {
    event.preventDefault();
    if (!name.trim()) return setCreateError("Collection name is required.");

    setCreating(true);
    setCreateError("");
    try {
      let targetWorkspaceId = workspaceId;
      if (!targetWorkspaceId) {
        const workspace = await workspacesApi.create({
          name: "Research Workspace",
          description: "Default DocLens workspace for research collections.",
        });
        targetWorkspaceId = workspace.id;
      }

      await collectionsApi.create({ workspaceId: targetWorkspaceId, name: name.trim(), description: description.trim() || undefined });
      setShowCreate(false);
      await refresh();
    } catch (err) {
      setCreateError(err?.message || "Failed to create collection.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Collections"
        description="Group papers by topic. Questions, reviews and comparisons are scoped to a collection."
        actions={<ActionButton icon="plus" onClick={openCreate}>Create Collection</ActionButton>}
      />

      <ErrorNotice message={error && "Collection data could not be loaded from the API. The page is using graceful onboarding states."} />

      <section className="analytics-grid">
        <ResearchStatCard icon="collections" label="Collections" value={stats.collectionsCreated} growth={`${stats.workspaces} workspaces`} description="Active research domains in DocLens." tone="green" />
        <ResearchStatCard icon="papers" label="Papers" value={stats.papersUploaded} growth={`${stats.completed} indexed`} description="Papers distributed across collections." tone="blue" />
        <ResearchStatCard icon="book" label="Literature Reviews" value={stats.literatureReviews} growth="multi-paper reports" description="Generated reviews for this domain." tone="cyan" />
      </section>

      <Panel title={collections.length ? "Research Collections" : "Suggested Research Domains"} eyebrow="Domains">
        <div className="panel-padding">
          {loading ? (
            <LoadingSkeleton rows={4} />
          ) : collections.length ? (
            <div className="collection-card-grid">
              {collections.map((collection) => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  metrics={getCollectionMetrics(collection, papers)}
                  onOpen={() => navigateTo(PAGES.COLLECTION, collection.workspaceId, collection.id)}
                />
              ))}
            </div>
          ) : (
            <>
              <EmptyState
                compact
                icon="collections"
                title="No research collections yet"
                description="Create a domain such as NLP Research, Transformers, Time-Series Analysis, or Anomaly Detection to organize papers."
                action={<ActionButton icon="plus" onClick={openCreate}>Create Collection</ActionButton>}
              />
              <div className="collection-card-grid">
                {suggestedCollections.map((collection) => (
                  <CollectionCard key={collection.id} collection={collection} suggested />
                ))}
              </div>
            </>
          )}
        </div>
      </Panel>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        busy={creating}
        title="Create collection"
        description="Group papers by topic. Questions, reviews and comparisons are scoped to a collection."
        onSubmit={createCollection}
        footer={
          <>
            <ActionButton icon={null} variant="ghost" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</ActionButton>
            <ActionButton icon="plus" type="submit" disabled={creating || !name.trim()}>{creating ? "Creating…" : "Create collection"}</ActionButton>
          </>
        }
      >
        <div className="form-row">
          <label htmlFor="create-workspace">Workspace</label>
          <select id="create-workspace" className="field-control" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            {!workspaces.length && <option value="">Default workspace will be created</option>}
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="create-name">Name</label>
          <input id="create-name" className="field-control" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Transformer research" maxLength={80} />
        </div>
        <div className="form-row">
          <label htmlFor="create-description">Description <span className="field-optional">optional</span></label>
          <textarea id="create-description" className="field-control" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="What papers and topics belong here?" />
        </div>
        {createError && <ErrorNotice message={createError} />}
      </Modal>
    </>
  );
};

export default CollectionsPage;
