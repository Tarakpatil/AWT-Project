import { useState, useEffect, useCallback } from 'react';
import AdminSidebar from '../../components/AdminSidebar';
import { useAuth } from '../../context/AuthContext';
import './admin.css';

const PlatformManagement = () => {
  const [activeTab, setActiveTab] = useState('users');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Fixed: was useState(true) — modal should start closed
  const [confirmModal, setConfirmModal] = useState({ open: false, type: null, id: null, name: '' });

  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const { apiFetch } = useAuth();
  const PAGE_SIZE = 10;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: currentPage,
        limit: PAGE_SIZE,
        ...(search ? { q: search } : {}),
        ...(roleFilter !== 'all' ? { role: roleFilter } : {}),
      });
      const data = await apiFetch(`/admin/users?${params}`);
      setUsers(data.data || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, currentPage, search, roleFilter]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: currentPage,
        limit: PAGE_SIZE,
        ...(search ? { q: search } : {}),
      });
      const data = await apiFetch(`/admin/events?${params}`);
      setEvents(data.data || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, currentPage, search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, search, roleFilter]);

  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
    else fetchEvents();
  }, [activeTab, currentPage, fetchUsers, fetchEvents]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const getRoleBadgeClass = (role) => {
    switch ((role || '').toLowerCase()) {
      case 'admin': return 'role-badge admin';
      case 'organizer': return 'role-badge organizer';
      case 'buyer': return 'role-badge buyer';
      default: return 'role-badge';
    }
  };

  const openDeleteModal = (type, id, name) => {
    setConfirmModal({ open: true, type, id, name });
  };

  const handleConfirmDelete = async () => {
    if (!confirmModal.id) return;
    setActionLoading(true);
    try {
      await apiFetch(`/admin/events/${confirmModal.id}`, { method: 'DELETE' });
      setConfirmModal({ open: false, type: null, id: null, name: '' });
      fetchEvents();
    } catch (err) {
      setError(err.message || 'Delete failed');
      setConfirmModal({ open: false, type: null, id: null, name: '' });
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  };

  return (
    <div className="app-layout">
      <AdminSidebar />

      <main className="main-content">
        <div className="page-container" style={{ padding: '0 var(--space-2xl) var(--space-2xl) var(--space-2xl)' }}>

          {/* Page Title */}
          <div className="pm-header">
            <h1>Platform Management</h1>
          </div>

          {/* Error */}
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

          {/* Tabs */}
          <div className="pm-tabs">
            <button
              className={`pm-tab ${activeTab === 'users' ? 'active' : ''}`}
              onClick={() => setActiveTab('users')}
            >
              Users
            </button>
            <button
              className={`pm-tab ${activeTab === 'events' ? 'active' : ''}`}
              onClick={() => setActiveTab('events')}
            >
              Events
            </button>
          </div>

          {/* Filters */}
          <div className="pm-filters">
            <div className="pm-search-wrapper">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder={activeTab === 'users' ? 'Search users by name or email...' : 'Search events...'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {activeTab === 'users' && (
              <div className="pm-filter-select-wrapper">
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                  <option value="all">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="organizer">Organizer</option>
                  <option value="buyer">Buyer</option>
                  <option value="staff">Staff</option>
                </select>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="select-chevron">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            )}
          </div>

          {/* Table */}
          {loading ? (
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px', padding: '32px 0', textAlign: 'center' }}>
              Loading…
            </div>
          ) : activeTab === 'users' ? (
            <div className="pm-table-wrapper">
              <table className="pm-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '24px' }}>No users found</td></tr>
                  ) : users.map(user => (
                    <tr key={user._id}>
                      <td className="pm-name-cell">{user.name}</td>
                      <td className="pm-email-cell">{user.email}</td>
                      <td>
                        <span className={getRoleBadgeClass(user.role)}>{user.role}</span>
                      </td>
                      <td>{formatDate(user.createdAt)}</td>
                      <td>
                        <div className="pm-actions">
                          {/* Edit role not implemented in UI — placeholder */}
                          <button className="pm-action-btn" title="Edit" disabled>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="pm-pagination">
                  <span className="pm-pagination-info">
                    Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, total)} of {total} entries
                  </span>
                  <div className="pm-pagination-controls">
                    <button className="pm-page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>&lt;</button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                      <button key={p} className={`pm-page-btn ${currentPage === p ? 'active' : ''}`} onClick={() => setCurrentPage(p)}>{p}</button>
                    ))}
                    <button className="pm-page-btn" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>&gt;</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="pm-table-wrapper">
              <table className="pm-table">
                <thead>
                  <tr>
                    <th>Event Name</th>
                    <th>Organizer</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '24px' }}>No events found</td></tr>
                  ) : events.map(event => (
                    <tr key={event._id}>
                      <td className="pm-name-cell">{event.title}</td>
                      <td className="pm-email-cell">{event.organizerId?.name || '—'}</td>
                      <td>{formatDate(event.date)}</td>
                      <td className={`pm-status ${event.cancelled ? 'inactive' : 'active'}`}>
                        {event.cancelled ? 'Cancelled' : 'Active'}
                      </td>
                      <td>
                        <div className="pm-actions">
                          <button
                            className="pm-action-btn danger"
                            title="Remove"
                            onClick={() => openDeleteModal('event', event._id, event.title)}
                            disabled={event.cancelled}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="pm-pagination">
                  <span className="pm-pagination-info">
                    Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, total)} of {total} entries
                  </span>
                  <div className="pm-pagination-controls">
                    <button className="pm-page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>&lt;</button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                      <button key={p} className={`pm-page-btn ${currentPage === p ? 'active' : ''}`} onClick={() => setCurrentPage(p)}>{p}</button>
                    ))}
                    <button className="pm-page-btn" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>&gt;</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Confirm Delete Modal */}
        {confirmModal.open && (
          <div className="modal-overlay">
            <div className="confirm-modal">
              <div className="confirm-modal-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </div>
              <h2>Remove "{confirmModal.name}"?</h2>
              <p>This will cancel the event and cannot be undone. All associated ticket data will be preserved.</p>
              <div className="confirm-modal-actions">
                <button
                  className="btn-confirm-cancel"
                  onClick={() => setConfirmModal({ open: false, type: null, id: null, name: '' })}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button
                  className="btn-confirm-delete"
                  onClick={handleConfirmDelete}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Removing…' : 'Confirm Remove'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default PlatformManagement;
