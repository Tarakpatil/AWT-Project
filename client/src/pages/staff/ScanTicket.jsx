import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import jsQR from 'jsqr';
import { useAuth } from '../../context/AuthContext';
import './staff.css';

export default function ScanTicket() {
  const navigate = useNavigate();
  const { apiFetch } = useAuth();

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scanResult, setScanResult] = useState(null); // null | { status: 'valid'|'invalid'|'used', title, msg, detail }
  const [scannedToday, setScannedToday] = useState(0);
  const [isVerifying, setIsVerifying] = useState(false);
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');

  // Fetch active events so scanner knows which door/event to verify against
  useEffect(() => {
    let cancelled = false;
    const fetchEvents = async () => {
      try {
        const res = await apiFetch('/events');
        if (!cancelled && res.data && res.data.length > 0) {
          setEvents(res.data);
          setSelectedEventId(res.data[0]._id);
        }
      } catch {
        // Fallback or ignore
      }
    };
    fetchEvents();
    return () => { cancelled = true; };
  }, [apiFetch]);

  // Stop camera tracks helper
  const stopCamera = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const handleVerify = useCallback(
    async (scannedData) => {
      if (!scannedData || isVerifying) return;
      setIsVerifying(true);

      let hash = '';
      let ticketId = null;
      let sig = null;

      try {
        const parsed = JSON.parse(scannedData);
        hash = parsed.hash || '';
        ticketId = parsed.ticketId || null;
        sig = parsed.sig || null;
      } catch {
        hash = String(scannedData).trim();
      }

      if (!hash) {
        setIsVerifying(false);
        return;
      }

      try {
        const eventId = selectedEventId || (events[0] ? events[0]._id : null);
        const res = await apiFetch('/tickets/verify', {
          method: 'POST',
          body: JSON.stringify({ hash, ticketId, sig, eventId }),
        });

        if (res.result === 'valid') {
          setScanResult({
            status: 'valid',
            title: 'Valid Ticket',
            msg: `Admitted • Seat: ${res.seatNumber || 'General Admission'}`,
            detail: `Ticket ID: ${res.ticketId ? res.ticketId.slice(0, 12) : ''}…`,
          });
        } else if (res.result === 'already_used') {
          setScanResult({
            status: 'used',
            title: 'Already Used',
            msg: res.reason || 'This ticket has already entered the venue.',
            detail: res.scannedBy ? `Scanned by ${res.scannedBy}` : '',
          });
        } else {
          setScanResult({
            status: 'invalid',
            title: 'Invalid Ticket',
            msg: res.reason || 'Cryptographic signature mismatch or ticket not found.',
            detail: `Scanned hash: ${hash.slice(0, 10)}…`,
          });
        }
      } catch (err) {
        setScanResult({
          status: 'invalid',
          title: 'Verification Failed',
          msg: err.message || 'Error communicating with validation server.',
          detail: '',
        });
      } finally {
        setScannedToday((prev) => prev + 1);
        setIsVerifying(false);
        setManualCode('');
      }
    },
    [apiFetch, events, selectedEventId, isVerifying]
  );

  // Scan video frames using jsQR
  const scanFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data) {
        handleVerify(code.data);
        return; // Pause scanning while result is displayed
      }
    }

    animationFrameRef.current = requestAnimationFrame(scanFrame);
  }, [handleVerify]);

  // Start camera
  const startCamera = useCallback(async () => {
    setCameraError('');
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Camera API is not supported in this browser environment');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        setCameraActive(true);
        animationFrameRef.current = requestAnimationFrame(scanFrame);
      }
    } catch (err) {
      setCameraError(err.message || 'Unable to access camera. Check permissions or upload an image below.');
      setCameraActive(false);
    }
  }, [scanFrame]);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  // Restart scan after dismissing modal
  const dismissResult = () => {
    setScanResult(null);
    if (cameraActive) {
      animationFrameRef.current = requestAnimationFrame(scanFrame);
    } else {
      startCamera();
    }
  };

  // Image upload QR scan fallback
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current || document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          handleVerify(code.data);
        } else {
          setScanResult({
            status: 'invalid',
            title: 'No QR Code Detected',
            msg: 'Could not read a valid QR code in the uploaded image.',
            detail: '',
          });
        }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    handleVerify(manualCode);
  };

  const handleClose = () => {
    stopCamera();
    navigate(-1);
  };

  return (
    <div className="scan-page">
      {/* Hidden canvas for image decoding */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* ---- Header ---- */}
      <header className="scan-header">
        <button className="scan-header-close" onClick={handleClose} aria-label="Close">
          ✕
        </button>
        <h1 className="scan-header-title">Door Scanner</h1>
      </header>

      {/* ---- Body ---- */}
      <div className="scan-body">
        {/* Door / Event Selector */}
        {events.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '340px', width: '100%' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Scanning Door:</span>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              style={{
                flex: 1,
                padding: '6px 10px',
                background: 'var(--bg-secondary, #18181f)',
                border: '1px solid var(--border-color, #272732)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '13px',
              }}
            >
              {events.map((ev) => (
                <option key={ev._id} value={ev._id}>
                  {ev.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* QR Viewfinder with live Video */}
        <div className="scan-viewfinder-wrapper" style={{ overflow: 'hidden', borderRadius: '12px', background: '#000' }}>
          <div className="scan-viewfinder-inner" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }} />

          {/* Live Video Feed */}
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: cameraActive ? 'block' : 'none',
            }}
          />

          {/* Fallback placeholder when camera is not open or errored */}
          {!cameraActive && (
            <div className="scan-camera-area" style={{ padding: '24px', textAlign: 'center' }}>
              <div className="scan-crosshair" />
              <svg className="scan-camera-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" />
                <rect x="7" y="7" width="10" height="10" rx="2" />
                <line x1="12" y1="2" x2="12" y2="7" />
                <line x1="12" y1="17" x2="12" y2="22" />
                <line x1="2" y1="12" x2="7" y2="12" />
                <line x1="17" y1="12" x2="22" y2="12" />
              </svg>
              <p className="scan-camera-text" style={{ marginTop: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                {cameraError || 'Align ticket QR code within viewfinder'}
              </p>
              <button
                type="button"
                onClick={startCamera}
                style={{
                  marginTop: '12px',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  background: 'var(--accent-purple, #8b5cf6)',
                  border: 'none',
                  color: '#fff',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Start Camera
              </button>
            </div>
          )}
        </div>

        {/* Upload QR Image / File Selector */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <label style={{
            fontSize: '12px',
            color: 'var(--accent-purple, #a78bfa)',
            cursor: 'pointer',
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-color, #272732)',
            background: 'var(--bg-secondary, #18181f)',
          }}>
            📁 Scan from Image / Photo
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {/* Manual entry toggle */}
        {!showManualEntry ? (
          <button
            className="scan-manual-link"
            onClick={() => setShowManualEntry(true)}
          >
            Having trouble? Enter code manually
          </button>
        ) : (
          <form className="scan-manual-entry" onSubmit={handleManualSubmit}>
            <input
              type="text"
              className="scan-manual-input"
              placeholder="Paste ticket hash or JSON payload…"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              className="scan-verify-btn"
              disabled={!manualCode.trim() || isVerifying}
            >
              {isVerifying ? 'Verifying…' : 'Verify Ticket'}
            </button>
            <button
              type="button"
              className="scan-manual-link"
              onClick={() => {
                setShowManualEntry(false);
                setManualCode('');
              }}
            >
              Cancel manual entry
            </button>
          </form>
        )}

        {/* Scans counter */}
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Tickets Scanned This Session: <strong style={{ color: '#fff' }}>{scannedToday}</strong>
        </div>

        {/* Reference States */}
        <div className="scan-reference-section">
          <p className="scan-reference-label">Reference States</p>
          <div className="scan-reference-cards">
            <div className="scan-ref-card valid">
              <svg className="ref-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 12l3 3 5-5" />
              </svg>
              VALID
            </div>

            <div className="scan-ref-card invalid">
              <svg className="ref-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              INVALID
            </div>
          </div>
        </div>
      </div>

      {/* Scan Result Overlay Modal */}
      {scanResult && (
        <div className="scan-result-overlay" onClick={dismissResult}>
          <div
            className={`scan-result-card ${scanResult.status}`}
            onClick={(e) => e.stopPropagation()}
          >
            {scanResult.status === 'valid' ? (
              <svg className="scan-result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 12l3 3 5-5" />
              </svg>
            ) : scanResult.status === 'used' ? (
              <svg className="scan-result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            ) : (
              <svg className="scan-result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            )}

            <h2 className="scan-result-title">{scanResult.title}</h2>
            <p className="scan-result-msg">{scanResult.msg}</p>
            {scanResult.detail && (
              <p style={{ fontSize: '11px', color: 'var(--text-muted, #6b7280)', fontFamily: 'monospace' }}>
                {scanResult.detail}
              </p>
            )}

            <button className="scan-result-dismiss" onClick={dismissResult}>
              Scan Next Ticket
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
