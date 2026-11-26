import { getWsBaseUrl } from './api';
import type { ServerWsMessage } from '../types/world';

export interface WsClientCallbacks {
  onOpen: () => void;
  onMessage: (msg: ServerWsMessage) => void;
  onDisconnect: (attempt: number) => void;
}

export class WorldWsClient {
  private ws: WebSocket | null = null;
  private closedManually = false;
  private reconnectTimer: number | null = null;
  private attempt = 0;
  private callbacks: WsClientCallbacks;

  constructor(callbacks: WsClientCallbacks) {
    this.callbacks = callbacks;
  }

  public connect(): void {
    this.closedManually = false;
    this.clearTimer();
    this.openSocket();
  }

  public disconnect(): void {
    this.closedManually = true;
    this.clearTimer();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  public reconnectNow(): void {
    this.attempt = 0;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.clearTimer();
    this.openSocket();
  }

  private openSocket(): void {
    if (this.closedManually) return;
    const url = getWsBaseUrl();
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.attempt = 0;
      this.callbacks.onOpen();
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      try {
        const parsed = JSON.parse(String(event.data)) as ServerWsMessage;
        if (parsed && typeof parsed.type === 'string') {
          this.callbacks.onMessage(parsed);
        }
      } catch {
        // Ignore malformed packets gracefully
      }
    };

    socket.onerror = () => {
      // onclose handles backoff cleanup
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      if (!this.closedManually) {
        this.attempt += 1;
        this.callbacks.onDisconnect(this.attempt);
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.closedManually) return;
    this.clearTimer();
    const delayMs = Math.min(12000, 900 * Math.pow(1.6, Math.min(this.attempt - 1, 6)));
    this.reconnectTimer = window.setTimeout(() => {
      this.openSocket();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
