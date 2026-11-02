import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Sidebar from '../../components/Sidebar';
import { useAuth } from '../../context/AuthContext';

const OrganizerDashboard = () => {
  const [stats, setStats] = useState({ totalEvents: 0, ticketsSold: 0, totalRevenue: 0 });
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const { apiFetch } = useAuth();

  useEffect(() => {
    let cancelled = false;

    const fetchOrganizerData = async () => {
      try {
        setLoading(true);
        const data = await apiFetch('/events?organizer=me');
        if (!cancelled) {
          const list = data.data || [];
          setEvents(list);

          const totalSold = list.reduce((sum, e) => sum + (e.ticketsSold || 0), 0);
          const revenue = list.reduce((sum, e) => sum + ((e.ticketsSold || 0) * (e.price || 0)), 0);

          setStats({
            totalEvents: data.total || list.length,
            ticketsSold: totalSold,
            totalRevenue: revenue,
          });
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load events');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchOrganizerData();
    return () => { cancelled = true; };
  }, [apiFetch]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount) => {
    return `€${(amount || 0).toLocaleString()}`;
  };

  const getPercentage = (sold, capacity) => {
    if (!capacity) return 0;
    return Math.round((sold / capacity) * 100);
  };

  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">
        <div className="page-container">
          {/* Page Header */}
          <div className="page-header">
            <h1 className="page-title">My Events</h1>
            <Link to="/organizer/create-event" className="btn-create">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create Event
            </Link>
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

          {/* Stats Cards */}
          <div className="stats-grid">
            <div className="stat-card">
              <p className="stat-label">Total Events</p>
              <p className="stat-value">{loading ? '…' : stats.totalEvents}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Tickets Sold</p>
              <p className="stat-value">{loading ? '…' : stats.ticketsSold.toLocaleString()}</p>
            </div>
            <div className="stat-card revenue">
              <p className="stat-label">Total Revenue</p>
              <p className="stat-value">{loading ? '…' : formatCurrency(stats.totalRevenue)}</p>
            </div>
          </div>

          {/* Events Table */}
          <div className="events-table-wrapper">
            <table className="events-table">
              <thead>
                <tr>
                  <th>Event Name</th>
                  <th>Date</th>
                  <th>Tickets Sold / Capacity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                      Loading events…
                    </td>
                  </tr>
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                      No events created yet. Click "Create Event" to get started!
                    </td>
                  </tr>
                ) : (
                  events.map((event) => {
                    const percent = getPercentage(event.ticketsSold, event.capacity);
                    const isFull = percent >= 100;
                    const eventStatus = event.cancelled ? 'cancelled' : new Date(event.date) < new Date() ? 'past' : 'upcoming';

                    return (
                      <tr key={event._id}>
                        <td>
                          <span className="event-name">{event.title}</span>
                        </td>
                        <td>
                          <span className="event-date">{formatDate(event.date)}</span>
                        </td>
                        <td>
                          <div className="ticket-progress">
                            <div className="progress-bar-wrapper">
                              <span className="progress-text">
                                {event.ticketsSold || 0}/{event.capacity}
                              </span>
                              <div className="progress-bar-track">
                                <div
                                  className={`progress-bar-fill ${isFull ? 'full' : ''}`}
                                  style={{ width: `${Math.min(percent, 100)}%` }}
                                />
                              </div>
                            </div>
                            <span className="progress-percent">{percent}%</span>
                          </div>
                        </td>
                        <td>
                          <span className={`status-badge ${eventStatus}`}>
                            {eventStatus.charAt(0).toUpperCase() + eventStatus.slice(1)}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

export default OrganizerDashboard;
