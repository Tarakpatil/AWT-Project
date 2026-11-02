import { useState, useEffect } from 'react';
import AdminSidebar from '../../components/AdminSidebar';
import { useAuth } from '../../context/AuthContext';
import './admin.css';

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState('');

  const { apiFetch } = useAuth();

  useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      try {
        setLoadingStats(true);
        const data = await apiFetch('/admin/stats');
        if (!cancelled) {
          setStats(data);
          setStatsError('');
        }
      } catch (err) {
        if (!cancelled) setStatsError(err.message || 'Failed to load stats');
      } finally {
        if (!cancelled) setLoadingStats(false);
      }
    };

    fetchStats();

    // Poll every 30 seconds for live updates
    const interval = setInterval(fetchStats, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiFetch]);

  return (
    <div className="app-layout">
      <AdminSidebar />

      <main className="main-content">
        <div className="page-container" style={{ padding: '0 var(--space-2xl) var(--space-2xl) var(--space-2xl)' }}>
          {/* Header without notification / profile */}
          <header className="admin-header" style={{ marginBottom: '1.5rem' }}>
            <h1>Admin Control Center</h1>
          </header>

          {/* Error Banner */}
          {statsError && (
            <div style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '16px',
              color: '#f87171',
              fontSize: '14px',
            }}>
              {statsError}
            </div>
          )}

          {/* Stats Grid */}
          <div className="admin-stats-grid">
            <div className="admin-stat-card">
              <h3>Total Tickets Sold</h3>
              <p className="admin-stat-value">
                {loadingStats ? '…' : (stats?.ticketsSold ?? 0).toLocaleString()}
              </p>
              <p className="admin-stat-subtext highlight">Live count</p>
            </div>

            <div className="admin-stat-card">
              <h3>Active Events</h3>
              <p className="admin-stat-value">
                {loadingStats ? '…' : (stats?.activeEvents ?? 0).toLocaleString()}
              </p>
              <p className="admin-stat-subtext highlight">Live globally</p>
            </div>

            <div className="admin-stat-card">
              <h3>Entries Scanned</h3>
              <p className="admin-stat-value">
                {loadingStats ? '…' : (stats?.entriesScanned ?? 0).toLocaleString()}
              </p>
              <p className="admin-stat-subtext">All time</p>
            </div>

            <div className="admin-stat-card">
              <h3>Fraud Attempts</h3>
              <p className="admin-stat-value warning">
                {loadingStats ? '…' : (stats?.fraudAttemptsBlocked ?? 0).toLocaleString()}
              </p>
              <p className="admin-stat-subtext">Blocked securely</p>
            </div>
          </div>

          {/* Main Grid: Chain Status & Platform Overview */}
          <div style={{ marginTop: '1.5rem' }}>
            <div className="admin-list-card" style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0 }}>Hash Chain Verification Status</h2>
                {stats?.chain && (
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: '600',
                    background: stats.chain.chainValid ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: stats.chain.chainValid ? '#34d399' : '#f87171',
                    border: `1px solid ${stats.chain.chainValid ? 'rgba(52, 211, 153, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
                  }}>
                    {stats.chain.chainValid ? 'CHAIN VALID' : 'TAMPER DETECTED'}
                  </span>
                )}
              </div>

              {loadingStats ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', padding: '16px 0' }}>Loading chain data…</p>
              ) : stats?.chain ? (
                <div style={{ padding: '8px 0' }}>
                  <div className="flagged-item">
                    <div className={`flagged-icon ${stats.chain.chainValid ? '' : 'error'}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                        {stats.chain.chainValid ? (
                          <polyline points="20 6 9 17 4 12"></polyline>
                        ) : (
                          <>
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                          </>
                        )}
                      </svg>
                    </div>
                    <div className="flagged-content">
                      <h4 className="flagged-title">
                        {stats.chain.chainValid ? 'Cryptographic Hash-Chain Integrity Verified' : 'Hash Chain Break Detected!'}
                      </h4>
                      <span className="flagged-meta">
                        {stats.chain.validLinks} of {stats.chain.totalLinks} transaction blocks valid
                        {stats.chain.firstBrokenSeq != null && ` • First broken sequence: #${stats.chain.firstBrokenSeq}`}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', padding: '16px 0' }}>No chain data available yet.</p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
