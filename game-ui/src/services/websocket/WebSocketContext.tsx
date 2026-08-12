import React, { createContext, useEffect, useRef, useState, useCallback } from "react";
import type { WSEvent, EventCallback, WebSocketContextValue } from "./types";

export const WebSocketContext = createContext<WebSocketContextValue | null>(null);

interface WebSocketProviderProps {
  children: React.ReactNode;
  username?: string;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children, username: initialUsername = "" }) => {
  const [username, setUsername] = useState<string>(initialUsername);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<EventCallback>>>(new Map());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageQueueRef = useRef<string[]>([]);

  const API_HOST = import.meta.env.VITE_API_HOST || (import.meta.env.MODE === "development" ? "localhost:8000" : window.location.host);
  const WS_PROTO = window.location.protocol === "https:" ? "wss:" : "ws:";

  const connect = useCallback(() => {
    if (!username) return;

    if (socketRef.current) {
      if (
        socketRef.current.readyState === WebSocket.OPEN ||
        socketRef.current.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const wsUrl = `${WS_PROTO}//${API_HOST}/ws?username=${encodeURIComponent(username)}`;
    console.log(`[WebSocket] Connecting to ${wsUrl}...`);
    const ws = new WebSocket(wsUrl);
    (ws as any).isClosedIntentionally = false;
    socketRef.current = ws;

    ws.onopen = () => {
      if ((ws as any).isClosedIntentionally) return;
      console.log(`[WebSocket] Unified socket connected for user: ${username}`);
      setIsConnected(true);
      setLastError(null);

      while (messageQueueRef.current.length > 0) {
        const queuedMessage = messageQueueRef.current.shift();
        if (queuedMessage && ws.readyState === WebSocket.OPEN) {
          console.log("[WebSocket] Flushing queued message on open");
          ws.send(queuedMessage);
        }
      }

      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: "system:ping", payload: { timestamp: Date.now() } }));
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      if ((ws as any).isClosedIntentionally) return;
      try {
        const rawData = JSON.parse(event.data);
        const eventName = rawData.event || rawData.type;
        const payload = rawData.payload !== undefined ? rawData.payload : rawData;
        const parsedEvent: WSEvent = {
          event: eventName,
          payload,
        };

        if (eventName === "system:error") {
          const errorMsg = payload.message || payload.error_message || "WebSocket error occurred";
          setLastError(errorMsg);
        }

        const eventListeners = listenersRef.current.get(eventName);
        if (eventListeners) {
          eventListeners.forEach((cb) => cb(payload, parsedEvent));
        }

        const allListeners = listenersRef.current.get("*");
        if (allListeners) {
          allListeners.forEach((cb) => cb(payload, parsedEvent));
        }
      } catch (e) {
        console.error("[WebSocket] Failed to parse message:", e);
      }
    };

    ws.onerror = (err) => {
      if ((ws as any).isClosedIntentionally) return;
      console.error("[WebSocket] Connection error:", err);
    };

    ws.onclose = () => {
      if ((ws as any).isClosedIntentionally) return;
      console.log("[WebSocket] Unified socket closed");
      setIsConnected(false);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);

      if (username && !(ws as any).isClosedIntentionally) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };
  }, [username, API_HOST, WS_PROTO]);

  useEffect(() => {
    if (username) {
      connect();
    }
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (socketRef.current) {
        (socketRef.current as any).isClosedIntentionally = true;
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [username, connect]);

  const emit = useCallback(<T = any,>(event: string, payload: T = {} as T) => {
    const messageObj: WSEvent<T> = {
      event,
      payload,
    };
    const jsonStr = JSON.stringify(messageObj);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(jsonStr);
    } else if (!socketRef.current || socketRef.current.readyState === WebSocket.CONNECTING) {
      console.log(`[WebSocket] Socket CONNECTING, queuing event '${event}'`);
      messageQueueRef.current.push(jsonStr);
    } else {
      console.warn(`[WebSocket] Cannot emit '${event}', socket state: ${socketRef.current?.readyState}`);
    }
  }, []);

  const subscribe = useCallback(<T = any,>(event: string, callback: EventCallback<T>) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(callback);

    return () => {
      const eventListeners = listenersRef.current.get(event);
      if (eventListeners) {
        eventListeners.delete(callback);
        if (eventListeners.size === 0) {
          listenersRef.current.delete(event);
        }
      }
    };
  }, []);

  return (
    <WebSocketContext.Provider
      value={{
        isConnected,
        username,
        setUsername,
        emit,
        subscribe,
        lastError,
        setLastError,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};
