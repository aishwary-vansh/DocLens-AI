/* eslint-disable react-refresh/only-export-components */
// src/contexts/SocketContext.jsx
// Socket.io client — connects once on auth, joins collection rooms on demand.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { tokenStorage } from '../services/api';

const SocketCtx = createContext(null);
export const useSocket = () => useContext(SocketCtx);

const SOCKET_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace('/api/v1', '')
  : 'http://localhost:3001';

export const SocketProvider = ({ children }) => {
  const socketRef  = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = tokenStorage.get();
    if (!token) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on('connect',    () => { setConnected(true);  console.log('[Socket] connected'); });
    socket.on('disconnect', () => { setConnected(false); console.log('[Socket] disconnected'); });
    socket.on('connect_error', (err) => console.warn('[Socket] error:', err.message));

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, []);

  const joinCollection = (collectionId) => {
    socketRef.current?.emit('join:collection', collectionId);
  };

  const leaveCollection = (collectionId) => {
    socketRef.current?.emit('leave:collection', collectionId);
  };

  const on = (event, handler) => {
    socketRef.current?.on(event, handler);
    return () => socketRef.current?.off(event, handler);
  };

  return (
    <SocketCtx.Provider value={{ connected, joinCollection, leaveCollection, on, socket: socketRef }}>
      {children}
    </SocketCtx.Provider>
  );
};
