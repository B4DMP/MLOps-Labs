import { useContext, useEffect } from "react";
import { WebSocketContext } from "./WebSocketContext";
import type { EventCallback } from "./types";

export const useGameWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useGameWebSocket must be used within a WebSocketProvider");
  }
  return context;
};

export const useWebSocketEvent = <T = any,>(event: string, callback: EventCallback<T>) => {
  const { subscribe } = useGameWebSocket();

  useEffect(() => {
    const unsubscribe = subscribe(event, callback);
    return () => unsubscribe();
  }, [event, callback, subscribe]);
};
