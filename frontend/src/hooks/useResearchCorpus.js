import { useCallback, useEffect, useMemo, useState } from "react";
import { collectionsApi, documentsApi, workspacesApi } from "../services/api";
import { useSocket } from "../contexts/SocketContext";
import { enrichDocument } from "../utils/researchData";

const initialState = {
  workspaces: [],
  collections: [],
  papers: [],
};

export default function useResearchCorpus() {
  const socket = useSocket();
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

  useEffect(() => {
    if (!socket?.connected || !data.collections.length) return undefined;

    const collectionIds = data.collections.map((collection) => collection.id);
    collectionIds.forEach((collectionId) => socket.joinCollection(collectionId));

    let refreshTimer;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        load();
      }, 250);
    };

    const unsubscribeUploaded = socket.on("document:uploaded", scheduleRefresh);
    const unsubscribeStatus = socket.on("document:status", scheduleRefresh);
    const unsubscribeDeleted = socket.on("document:deleted", scheduleRefresh);

    return () => {
      window.clearTimeout(refreshTimer);
      unsubscribeUploaded?.();
      unsubscribeStatus?.();
      unsubscribeDeleted?.();
      collectionIds.forEach((collectionId) => socket.leaveCollection(collectionId));
    };
  }, [data.collections, load, socket]);

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
