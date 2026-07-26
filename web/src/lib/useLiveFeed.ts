import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk, sourceToKeys } from "./api";

export type LiveStatus = "connecting" | "live" | "offline";

/**
 * Subscribes to the server's WebSocket change feed and invalidates the matching
 * React Query caches, so screens refresh when their underlying provider data
 * changes. Returns connection status + the last source that changed (for
 * the flash-on-update affordance).
 */
export function useLiveFeed() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [lastChange, setLastChange] = useState<{ source: string; at: string } | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${location.host}/ws`);

      socket.onopen = () => {
        setStatus("live");
        qc.invalidateQueries({ queryKey: qk.providers });
        qc.invalidateQueries({ queryKey: qk.runtime });
        qc.invalidateQueries({ queryKey: qk.capabilities });
      };
      socket.onclose = () => {
        if (closed) return;
        setStatus("offline");
        retry.current = setTimeout(connect, 1500);
      };
      socket.onerror = () => socket?.close();
      socket.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.kind === "change" && typeof msg.source === "string") {
            setLastChange({ source: msg.source, at: msg.at });
            for (const key of sourceToKeys[msg.source] ?? []) {
              qc.invalidateQueries({ queryKey: key });
            }
          }
        } catch {
          /* ignore malformed frames */
        }
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry.current);
      socket?.close();
    };
  }, [qc]);

  return { status, lastChange };
}
