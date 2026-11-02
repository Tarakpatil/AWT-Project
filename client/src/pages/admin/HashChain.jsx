import { useState, useEffect, useCallback } from 'react';
import AdminSidebar from '../../components/AdminSidebar';
import { useAuth } from '../../context/AuthContext';
import './admin.css';

const HashChain = () => {
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [blocks, setBlocks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 20;

  const { apiFetch } = useAuth();

  const fetchChain = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(`/admin/chain?page=${page}&limit=${LIMIT}`);
      setBlocks(data.data || []);
      setSummary(data.summary || null);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message || 'Failed to load chain');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, page]);

  useEffect(() => {
    fetchChain();
  }, [fetchChain]);

  const totalPages = Math.ceil(total / LIMIT);

  const handleBlockClick = (block) => {
    setSelectedBlock(block);
    setDetailsOpen(true);
  };

  const shortHash = (hash) => hash ? `${hash.slice(0, 10)}…` : '—';

  return (
    <div className="app-layout">
      <AdminSidebar />

      <main className="main-content">
        <div className="page-container" style={{ padding: '0 var(--space-2xl) var(--space-2xl) var(--space-2xl)', height: '100vh', display: 'flex', flexDirection: 'column' }}>

          {/* Header */}
          <div className="chain-header">
            <div>
              <h1>Hash Chain</h1>
              <p>Live verification stream of ticket transactions.</p>
            </div>
            <div className="chain-header-actions">
              <button className="chain-btn-outline" onClick={fetchChain} disabled={loading}>
                <span>{loading ? 'Refreshing…' : 'REFRESH'}</span>
              </button>
            </div>
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

          {/* Chain Summary */}
          {summary && (
            <div style={{
              display: 'flex',
              gap: '16px',
              marginBottom: '16px',
              flexWrap: 'wrap',
            }}>
              <div className="admin-stat-card" style={{ flex: 1, minWidth: '140px' }}>
                <h3>Chain Status</h3>
                <p className={`admin-stat-value ${summary.chainValid ? '' : 'warning'}`}>
                  {summary.chainValid ? '✓ Valid' : '✗ Broken'}
                </p>
              </div>
              <div className="admin-stat-card" style={{ flex: 1, minWidth: '140px' }}>
                <h3>Total Links</h3>
                <p className="admin-stat-value">{summary.totalLinks ?? 0}</p>
              </div>
              <div className="admin-stat-card" style={{ flex: 1, minWidth: '140px' }}>
                <h3>Valid Links</h3>
                <p className="admin-stat-value">{summary.valid ?? 0}</p>
              </div>
              {summary.firstBrokenSeq != null && (
                <div className="admin-stat-card" style={{ flex: 1, minWidth: '140px' }}>
                  <h3>First Broken</h3>
                  <p className="admin-stat-value warning">#{summary.firstBrokenSeq}</p>
                </div>
              )}
            </div>
          )}

          {/* Main Content */}
          <div className="chain-main" style={{ flex: 1, overflow: 'hidden' }}>
            {/* Visualization Area */}
            <div className="chain-viz-area" style={{ overflowX: 'auto', overflowY: 'auto' }}>
              {loading ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', padding: '32px' }}>Loading chain…</p>
              ) : blocks.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', padding: '32px' }}>
                  No tickets in the chain yet.
                </p>
              ) : (
                <>
                  <div className="chain-blocks-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
                    {blocks.map((block) => (
                      <div key={block.seq ?? block._id} className="chain-block-group">
                        <div
                          className={`chain-block ${selectedBlock?._id === block._id ? 'selected' : ''} ${block.valid ? 'valid' : 'tampered'}`}
                          onClick={() => handleBlockClick(block)}
                        >
                          <div className="chain-block-header">
                            <span className="chain-block-id">#{block.seq}</span>
                            <span className={`chain-block-dot ${block.valid ? 'valid' : 'tampered'}`}></span>
                          </div>
                          <div className="chain-block-body">
                            <span className="chain-block-label">Hash</span>
                            <span className="chain-block-hash">{block.displayHash || shortHash(block.currentHash)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="pm-pagination" style={{ marginTop: '16px' }}>
                      <span className="pm-pagination-info">Page {page} of {totalPages} ({total} total blocks)</span>
                      <div className="pm-pagination-controls">
                        <button className="pm-page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>&lt;</button>
                        <button className="pm-page-btn active">{page}</button>
                        <button className="pm-page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>&gt;</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Details Panel */}
            {detailsOpen && selectedBlock && (
              <div className="chain-details-panel">
                <div className="chain-details-header">
                  <h2>Block Details</h2>
                  <button className="chain-details-close" onClick={() => setDetailsOpen(false)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>

                <div className="chain-details-body">
                  {/* Status Badge */}
                  <div className="chain-detail-badge-row">
                    <span className={`chain-status-badge ${selectedBlock.valid ? 'valid' : 'tampered'}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                        {!selectedBlock.valid ? (
                          <>
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                          </>
                        ) : (
                          <polyline points="20 6 9 17 4 12"></polyline>
                        )}
                      </svg>
                      {selectedBlock.valid ? 'VALID' : 'TAMPERED'}
                    </span>
                  </div>

                  {/* Block Index */}
                  <div className="chain-detail-section">
                    <label>Block Sequence</label>
                    <p className="chain-detail-value-large">#{selectedBlock.seq}</p>
                  </div>

                  {/* Full Hash */}
                  <div className="chain-detail-section">
                    <label>Current Hash</label>
                    <div className="chain-hash-box">
                      {selectedBlock.currentHash || '—'}
                    </div>
                  </div>

                  {/* Previous Hash */}
                  <div className="chain-detail-section">
                    <label>Previous Hash</label>
                    <div className="chain-hash-box">
                      {selectedBlock.prevHash || '—'}
                    </div>
                    {!selectedBlock.valid && (
                      <div className="chain-mismatch-warning">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </svg>
                        Hash mismatch detected — chain integrity broken
                      </div>
                    )}
                  </div>

                  {/* Ticket ID */}
                  {selectedBlock.ticketId && (
                    <div className="chain-detail-section">
                      <label>Ticket Reference</label>
                      <div className="chain-ticket-ref">
                        <div className="chain-ticket-ref-icon">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                            <rect x="3" y="10" width="18" height="10" rx="2" ry="2" />
                            <path d="M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
                          </svg>
                        </div>
                        <div>
                          <p className="chain-ticket-ref-title">Ticket ID</p>
                          <p className="chain-ticket-ref-seat" style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                            {selectedBlock.ticketId}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default HashChain;
