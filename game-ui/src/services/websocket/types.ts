export const ReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
  UNINSTANTIATED: -1,
} as const;

export type ReadyState = typeof ReadyState[keyof typeof ReadyState];

export interface WSEvent<T = any> {
  event: string;
  payload: T;
}

export type EventCallback<T = any> = (payload: T, rawEvent: WSEvent<T>) => void;

export interface WebSocketContextValue {
  isConnected: boolean;
  username: string;
  setUsername: (username: string) => void;
  emit: <T = any>(event: string, payload?: T) => void;
  subscribe: <T = any>(event: string, callback: EventCallback<T>) => () => void;
  lastError: string | null;
  setLastError: (error: string | null) => void;
}
