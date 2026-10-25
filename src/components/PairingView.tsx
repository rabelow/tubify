/**
 * Tubify PairingView Component
 * 
 * Provides:
 * - LAN Host IP & Companion Port inputs with smart default
 * - "Connect & Pair" action initiating 2-step pairing
 * - Large 4-digit code display and 30-second countdown timer while awaiting PC approval
 * - Helpful error banner with instructions for AUTHORIZATION_DISABLED
 * - Cancel button to abort pairing
 */

import React, { useState, useEffect } from 'react';
import type { ConnectionStatus } from '../types/companion';
import { getDefaultHost } from '../lib/storage';

export interface PairingViewProps {
  status: ConnectionStatus;
  pairingCode: string | null;
  error: string | null;
  initialHost?: string;
  initialPort?: number;
  onStartPairing: (host: string, port: number) => Promise<void> | void;
  onCancel: () => void;
  onClose?: () => void;
  isModal?: boolean;
}

export const PairingView: React.FC<PairingViewProps> = ({
  status,
  pairingCode,
  error,
  initialHost,
  initialPort = 9863,
  onStartPairing,
  onCancel,
  onClose,
  isModal = false,
}) => {
  const [host, setHost] = useState<string>(() => initialHost || getDefaultHost());
  const [port, setPort] = useState<number>(() => initialPort);
  const [countdown, setCountdown] = useState<number>(30);

  // Synchronize initialHost changes
  useEffect(() => {
    if (initialHost) {
      setHost(initialHost);
    }
  }, [initialHost]);

  // 30-second countdown effect when awaiting approval
  useEffect(() => {
    if (status !== 'awaiting_approval') {
      setCountdown(30);
      return;
    }

    setCountdown(30);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [status, pairingCode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'checking' || status === 'requesting_code' || status === 'awaiting_approval') {
      return;
    }
    const cleanHost = host.trim() || getDefaultHost();
    const cleanPort = Number(port) || 9863;
    onStartPairing(cleanHost, cleanPort);
  };

  const isBusy = status === 'checking' || status === 'requesting_code';
  const isAwaiting = status === 'awaiting_approval';

  return (
    <div className={`pairing-container ${isModal ? 'modal-mode' : ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="pairing-title">Connect to Desktop</h2>
        {onClose && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            aria-label="Close"
            style={{ minWidth: 36, padding: '4px 8px', borderRadius: '50%' }}
          >
            ✕
          </button>
        )}
      </div>

      <p className="pairing-desc">
        Pair Tubify directly with <strong>YouTube Music Desktop App</strong> running on your Windows PC.
      </p>

      {/* Error banner */}
      {error && (
        <div className="banner-error" role="alert">
          <p style={{ fontWeight: 700, marginBottom: 4 }}>Connection Error</p>
          <p>{error}</p>
          {error.includes('Settings -> Integrations') && (
            <p style={{ marginTop: 6, fontSize: '0.8rem', opacity: 0.9 }}>
              Tip: The authorization window in YTMDesktop remains active for 5 minutes once enabled.
            </p>
          )}
        </div>
      )}

      {/* Awaiting desktop approval with 4-digit code */}
      {isAwaiting && pairingCode ? (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
            Look at your Windows PC! Click <strong>Allow</strong> on the popup:
          </p>

          <div className="pairing-code-card">
            <span className="pairing-code-text">{pairingCode}</span>
            <div className="countdown-bar">
              <div
                className="countdown-progress"
                style={{ width: `${Math.max(0, (countdown / 30) * 100)}%` }}
              />
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
              {countdown > 0 ? `Waiting for approval (${countdown}s remaining)` : 'Authorization window expiring...'}
            </p>
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            style={{ width: '100%', marginTop: 8 }}
          >
            Cancel Pairing
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="pairing-input-group">
            <label htmlFor="host-input">Windows PC LAN IP Address</label>
            <input
              id="host-input"
              type="text"
              className="pairing-input"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.0.144"
              disabled={isBusy}
              required
            />
          </div>

          <div className="pairing-input-group">
            <label htmlFor="port-input">Companion Server Port</label>
            <input
              id="port-input"
              type="number"
              className="pairing-input"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              placeholder="9863"
              disabled={isBusy}
              min={1}
              max={65535}
              required
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={isBusy}
            style={{ width: '100%', height: 46, marginTop: 6 }}
          >
            {isBusy ? (
              <span>Connecting & Requesting Code...</span>
            ) : (
              <span>Connect & Pair</span>
            )}
          </button>

          {onClose && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              style={{ width: '100%' }}
            >
              Close
            </button>
          )}
        </form>
      )}
    </div>
  );
};
