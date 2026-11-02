import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import BuyerSidebar from '../../components/BuyerSidebar';
import { useAuth } from '../../context/AuthContext';

const MyTickets = () => {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState('');

  const { apiFetch } = useAuth();

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/tickets/mine');
      setTickets(data.data || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleOpenTransfer = (ticket) => {
    if (ticket.status !== 'valid') return;
    setSelectedTicket(ticket);
    setRecipientEmail('');
    setTransferError('');
    setTransferModalOpen(true);
  };

  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    if (!selectedTicket || !recipientEmail) return;

    setTransferring(true);
    setTransferError('');

    try {
      await apiFetch('/tickets/transfer', {
        method: 'POST',
        body: JSON.stringify({
          ticketId: selectedTicket._id,
          toEmail: recipientEmail.trim(),
        }),
      });
      setTransferModalOpen(false);
      fetchTickets();
    } catch (err) {
      setTransferError(err.message || 'Transfer failed');
    } finally {
      setTransferring(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'TBA';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="app-layout">
      <BuyerSidebar />

      <main className="main-content">
        <div className="page-container" style={{ paddingTop: '2rem' }}>
          <div className="page-header-tickets">
            <div className="tickets-title-section">
              <h1>My Orders & Tickets</h1>
              <p>Cryptographically verified tickets anchored to the hash chain.</p>
            </div>
            <div className="tickets-action-section">
              <Link
                to="/buyer/events"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'var(--accent-purple, #8b5cf6)',
                  color: '#fff',
                  textDecoration: 'none',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                + Buy More Tickets
              </Link>
            </div>
          </div>

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '16px',
              color: '#f87171',
              fontSize: '14px',
            }}>
               {error}
            </div>
          )}

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading your tickets…
            </div>
          ) : tickets.length === 0 ? (
            <div style={{
              padding: '3rem',
              textAlign: 'center',
              background: 'var(--bg-card, #18181f)',
              borderRadius: '12px',
              border: '1px solid var(--border-color, #272732)',
              marginTop: '1.5rem',
            }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                You have not purchased any tickets yet.
              </p>
              <Link
                to="/buyer/events"
                style={{
                  background: 'var(--accent-purple, #8b5cf6)',
                  color: '#fff',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontWeight: '600',
                }}
              >
                Explore Events & Buy Tickets
              </Link>
            </div>
          ) : (
            <div className="tickets-list">
              {tickets.map((ticket) => {
                const event = ticket.eventId || {};
                const isTransferred = ticket.status === 'transferred';
                const isUsed = ticket.status === 'used';
                const isDimmed = isTransferred || isUsed;
                const qrData = ticket.qrPayload || ticket.currentHash || ticket._id;
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`;

                return (
                  <div key={ticket._id} className={`ticket-card ${isDimmed ? 'disabled' : ''}`}>
                    {/* QR Code Section */}
                    <div className="ticket-qr-section">
                      {isTransferred ? (
                        <div className="ticket-qr-box transferred">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="32" height="32" style={{ color: 'var(--text-muted)' }}>
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                          </svg>
                        </div>
                      ) : (
                        <div className="ticket-qr-box">
                          <img src={qrUrl} alt="Ticket QR" />
                        </div>
                      )}
                      <span className="ticket-hash" title={ticket.currentHash}>
                        {ticket.currentHash ? `${ticket.currentHash.slice(0, 10)}…` : 'Transferred'}
                      </span>
                    </div>

                    {/* Info Section */}
                    <div className="ticket-info-section">
                      <h3 className="ticket-title">{event.title || 'Event Ticket'}</h3>
                      <div className="ticket-meta-row">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                          <line x1="16" y1="2" x2="16" y2="6"></line>
                          <line x1="8" y1="2" x2="8" y2="6"></line>
                          <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <span>{formatDate(event.date)}</span>
                        <span>•</span>
                        <span>{formatTime(event.date)}</span>
                      </div>
                      <div className="ticket-meta-row">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                          <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        <span>{event.venue || 'Venue TBA'}</span>
                      </div>
                      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          Seat: <strong style={{ color: '#fff' }}>{ticket.seatNumber || 'General Admission'}</strong>
                        </span>
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          Chain Seq: <strong style={{ color: 'var(--accent-purple)' }}>#{ticket.seq}</strong>
                        </span>
                      </div>
                    </div>

                    {/* Status & Actions */}
                    <div className="ticket-actions-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                      <span className={`ticket-status ${ticket.status}`}>
                        {ticket.status.toUpperCase()}
                      </span>

                      {ticket.status === 'valid' && (
                        <button
                          type="button"
                          className="btn-filter"
                          onClick={() => handleOpenTransfer(ticket)}
                          style={{ cursor: 'pointer', fontSize: '12px', padding: '6px 12px' }}
                        >
                          Transfer Ticket
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Transfer Modal */}
          {transferModalOpen && selectedTicket && (
            <div className="modal-overlay" style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}>
              <div className="confirm-modal" style={{
                background: 'var(--bg-card, #18181f)',
                border: '1px solid var(--border-color, #272732)',
                borderRadius: '14px',
                padding: '24px',
                maxWidth: '420px',
                width: '90%',
              }}>
                <h2 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>Transfer Ticket #{selectedTicket.seq}</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
                  Transferring will revoke this ticket and append a replacement ticket for the new owner to the hash chain.
                </p>

                {transferError && (
                  <div style={{
                    background: 'rgba(239,68,68,0.12)',
                    border: '1px solid rgba(239,68,68,0.4)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: '#f87171',
                    fontSize: '13px',
                    marginBottom: '14px',
                  }}>
                    {transferError}
                  </div>
                )}

                <form onSubmit={handleTransferSubmit}>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Recipient Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="recipient@example.com"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-primary, #0f0f13)',
                      border: '1px solid var(--border-color, #272732)',
                      borderRadius: '8px',
                      color: '#fff',
                      marginBottom: '18px',
                    }}
                  />

                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setTransferModalOpen(false)}
                      disabled={transferring}
                      style={{
                        padding: '8px 16px',
                        borderRadius: '8px',
                        background: 'transparent',
                        border: '1px solid var(--border-color, #272732)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={transferring || !recipientEmail}
                      style={{
                        padding: '8px 18px',
                        borderRadius: '8px',
                        background: 'var(--accent-purple, #8b5cf6)',
                        border: 'none',
                        color: '#fff',
                        fontWeight: '600',
                        cursor: transferring ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {transferring ? 'Transferring…' : 'Confirm Transfer'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default MyTickets;
