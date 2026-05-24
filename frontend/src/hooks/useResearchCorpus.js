import { useCallback, useEffect, useMemo, useState } from "react";
import { collectionsApi, documentsApi, workspacesApi } from "../services/api";
import { enrichDocument } from "../utils/researchData";

const initialState = {
  workspaces: [],
  collections: [],
  papers: [],
};

export default function useResearchCorpus() {
  const [data, setData] = useState(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const workspaces = await workspacesApi.list();
      const allCollections = [];
      const allPapers = [];

      await Promise.all(
        workspaces.map(async (workspace) => {
          const workspaceCollections = await collectionsApi.list(workspace.id);
          const collectionsWithWorkspace = workspaceCollections.map((collection) => ({
            ...collection,
            workspaceName: workspace.name,
            workspaceDescription: workspace.description,
          }));

          allCollections.push(...collectionsWithWorkspace);

          await Promise.all(
            collectionsWithWorkspace.map(async (collection) => {
              const documents = await documentsApi.list(collection.id);
              allPapers.push(
                ...documents.map((document) => enrichDocument(document, collection, workspace)),
              );
            }),
          );
        }),
      );

      allCollections.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      allPapers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      setData({ workspaces, collections: allCollections, papers: allPapers });
    } catch (err) {
      setData(initialState);
      setError(err?.message || "Unable to load the research corpus.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return useMemo(
    () => ({
      ...data,
      loading,
      error,
      refresh: load,
    }),
    [data, error, load, loading],
  );
}
