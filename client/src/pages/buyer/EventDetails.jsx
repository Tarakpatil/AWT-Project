import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import BuyerSidebar from '../../components/BuyerSidebar';
import SeatMap from '../../components/SeatMap';
import { useAuth } from '../../context/AuthContext';

const DEFAULT_EVENT_IMAGE = 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?auto=format&fit=crop&w=1200&q=80';

const EventDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { apiFetch } = useAuth();

  const [eventData, setEventData] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    const fetchDetails = async () => {
      try {
        setLoading(true);
        const data = await apiFetch(`/events/${id}`);
        if (!cancelled) {
          setEventData(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load event details');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDetails();
    return () => { cancelled = true; };
  }, [id, apiFetch]);

  const handleSeatSelect = (seatLabel) => {
    setSelectedSeat((prev) => (prev === seatLabel ? null : seatLabel));
  };

  const handleBuyTicket = async () => {
    if (!eventData?.event) return;
    const isReserved = !!eventData.event.seatMap;
    if (isReserved && !selectedSeat) {
      setError('Please select a seat from the map before proceeding');
      return;
    }

    setBuying(true);
    setError('');

    try {
      const payload = {
        eventId: eventData.event._id,
        seatNumber: isReserved ? selectedSeat : null,
      };

      const res = await apiFetch('/tickets/purchase', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setSuccessMsg(`Ticket purchased successfully! Block #${res.ticket?.seq || ''} appended.`);
      setTimeout(() => {
        navigate('/buyer/tickets');
      }, 1200);
    } catch (err) {
      setError(err.message || 'Ticket purchase failed');
    } finally {
      setBuying(false);
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

  if (loading) {
    return (
      <div className="app-layout">
        <BuyerSidebar />
        <main className="main-content">
          <div className="page-container-buyer" style={{ paddingTop: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading event details…
          </div>
        </main>
      </div>
    );
  }

  if (error && !eventData) {
    return (
      <div className="app-layout">
        <BuyerSidebar />
        <main className="main-content">
          <div className="page-container-buyer" style={{ paddingTop: '3rem', textAlign: 'center' }}>
            <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</p>
            <Link to="/buyer/events" style={{ color: 'var(--accent-purple)', textDecoration: 'underline' }}>
              ← Back to all events
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const { event, takenSeats = [], remainingCapacity = 0 } = eventData || {};
  const isSoldOut = remainingCapacity <= 0;
  const isReserved = !!event.seatMap;
  const price = event.price || 0;

  return (
    <div className="app-layout">
      <BuyerSidebar />

      <main className="main-content">
        <div className="page-container-buyer" style={{ paddingTop: '2rem' }}>
          <Link
            to="/buyer/events"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--text-secondary, #9ca3af)',
              textDecoration: 'none',
              marginBottom: '1.5rem',
              fontSize: '14px',
            }}
          >
            ← Back to Events
          </Link>

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

          {successMsg && (
            <div style={{
              background: 'rgba(16,185,129,0.12)',
              border: '1px solid rgba(16,185,129,0.4)',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '16px',
              color: '#10b981',
              fontSize: '14px',
            }}>
              ✓ {successMsg}
            </div>
          )}

          <div className="event-details-layout">
            {/* Main Left Content */}
            <div className="event-details-main">
              <div className="event-hero-image">
                <img src={DEFAULT_EVENT_IMAGE} alt={event.title} />
              </div>

              <span className="event-badge" style={{ marginTop: '1rem' }}>
                {isSoldOut ? 'Sold Out' : `${remainingCapacity} Spots Remaining`}
              </span>
              <h1 className="event-title">{event.title}</h1>

              <div className="event-meta">
                <span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  {formatDate(event.date)}
                </span>
                <span>•</span>
                <span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  {formatTime(event.date)}
                </span>
                <span>•</span>
                <span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                  </svg>
                  {event.venue}
                </span>
              </div>

              <p className="event-description">{event.description}</p>

              {/* Seat Selection */}
              {isReserved ? (
                <SeatMap
                  seatList={Array.isArray(event.seatMap) ? event.seatMap : null}
                  takenSeats={takenSeats}
                  selectedSeats={selectedSeat ? [selectedSeat] : []}
                  onSeatSelect={handleSeatSelect}
                />
              ) : (
                <div style={{
                  padding: '1.5rem',
                  background: 'var(--bg-card, #18181f)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color, #272732)',
                  marginTop: '1.5rem',
                }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>General Admission</h3>
                  <p style={{ margin: 0, color: 'var(--text-secondary, #9ca3af)', fontSize: '14px' }}>
                    This event has open seating. Valid tickets grant admission at the entrance.
                  </p>
                </div>
              )}
            </div>

            {/* Right Sidebar - Order Summary */}
            <div className="event-details-sidebar">
              <div className="order-summary-card">
                <h3>Order Summary</h3>

                <div className="summary-row">
                  <span>Ticket Type</span>
                  <span>{isReserved ? 'Reserved Seat' : 'General Admission'}</span>
                </div>
                {isReserved && (
                  <div className="summary-row">
                    <span>Selected Seat</span>
                    <span style={{ fontWeight: 'bold', color: selectedSeat ? 'var(--accent-purple, #a78bfa)' : 'inherit' }}>
                      {selectedSeat || 'None'}
                    </span>
                  </div>
                )}
                <div className="summary-row">
                  <span>Price per ticket</span>
                  <span>€{price.toFixed(2)}</span>
                </div>

                <div className="summary-subtotal">
                  <span>Total</span>
                  <span>€{price.toFixed(2)}</span>
                </div>

                <button
                  className="btn-checkout"
                  disabled={isSoldOut || (isReserved && !selectedSeat) || buying}
                  onClick={handleBuyTicket}
                  style={{ opacity: isSoldOut || (isReserved && !selectedSeat) || buying ? 0.6 : 1 }}
                >
                  {buying
                    ? 'Minting Ticket on Chain…'
                    : isSoldOut
                    ? 'Sold Out'
                    : isReserved && !selectedSeat
                    ? 'Select a Seat to Buy'
                    : 'Confirm & Buy Ticket'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default EventDetails;
