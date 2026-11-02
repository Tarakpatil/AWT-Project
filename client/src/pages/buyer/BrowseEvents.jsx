import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import BuyerSidebar from '../../components/BuyerSidebar';
import { useAuth } from '../../context/AuthContext';
import '../../buyer.css';

const DEFAULT_EVENT_IMAGE = 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?auto=format&fit=crop&w=800&q=80';

const BrowseEvents = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const { apiFetch } = useAuth();

  useEffect(() => {
    let cancelled = false;

    const fetchEvents = async () => {
      try {
        setLoading(true);
        const data = await apiFetch('/events');
        if (!cancelled) {
          setEvents(data.data || []);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load events');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchEvents();
    return () => { cancelled = true; };
  }, [apiFetch]);

  const formatDate = (dateStr) => {
    if (!dateStr) return 'TBA';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="app-layout">
      <BuyerSidebar />

      <main className="main-content">
        <div className="page-container-buyer" style={{ paddingTop: '2rem' }}>
          <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary, #fff)', margin: 0 }}>
                Available Tickets
              </h1>
              <p style={{ color: 'var(--text-secondary, #9ca3af)', marginTop: '0.25rem', fontSize: '0.95rem' }}>
                Select an event to pick seats and purchase verifiable tickets.
              </p>
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
              ⚠ {error}
            </div>
          )}

          {/* Events Grid */}
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary, #9ca3af)' }}>
              Loading available events…
            </div>
          ) : events.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary, #9ca3af)' }}>
              No active events found. Check back later!
            </div>
          ) : (
            <div className="events-grid">
              {events.map((event) => {
                const remaining = Math.max(0, (event.capacity || 0) - (event.ticketsSold || 0));
                const isSoldOut = remaining === 0;

                return (
                  <Link
                    key={event._id}
                    to={`/buyer/events/${event._id}`}
                    className="event-card"
                    style={{ textDecoration: 'none', color: 'inherit', display: 'block', transition: 'transform 0.2s' }}
                  >
                    <div className="event-card-image">
                      <img src={DEFAULT_EVENT_IMAGE} alt={event.title} />
                      <span className={`event-card-badge ${isSoldOut ? 'sold-out' : ''}`} style={{
                        background: isSoldOut ? '#ef4444' : '#10b981',
                        color: '#fff',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '600',
                      }}>
                        {isSoldOut ? 'Sold Out' : `${remaining} left`}
                      </span>
                    </div>
                    <div className="event-card-content">
                      <h3 className="event-card-title">{event.title}</h3>
                      <div className="event-card-info">
                        <div className="event-card-info-row">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                          </svg>
                          <span>{formatDate(event.date)}</span>
                        </div>
                        <div className="event-card-info-row">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                          </svg>
                          <span>{event.venue}</span>
                        </div>
                      </div>
                      <div className="event-card-footer" style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>

                        <span style={{
                          padding: '6px 14px',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '600',
                          background: isSoldOut ? '#374151' : 'var(--accent-purple, #8b5cf6)',
                          color: '#fff',
                        }}>
                          {isSoldOut ? 'Sold Out' : 'Select Seats →'}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default BrowseEvents;
