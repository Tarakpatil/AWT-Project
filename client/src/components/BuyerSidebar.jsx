import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const BuyerSidebar = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <rect x="2" y="2" width="20" height="20" rx="2" />
            <path d="M7 7h4v4H7zM13 7h4v4h-4zM7 13h4v4H7z" />
          </svg>
        </div>
        <div className="sidebar-brand-text">
          <h1>TicketFlow</h1>
          <span>Fintech Ticketing</span>
        </div>
      </div>

      {/* Navigation: Only Tickets, Orders, and Logout */}
      <nav className="sidebar-nav">
        <NavLink
          to="/buyer/events"
          className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="10" width="18" height="10" rx="2" ry="2" />
            <line x1="7" y1="10" x2="7" y2="10.01" />
            <line x1="11" y1="10" x2="11" y2="10.01" />
            <line x1="15" y1="10" x2="15" y2="10.01" />
            <path d="M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
          </svg>
          Tickets
        </NavLink>

        <NavLink
          to="/buyer/tickets"
          className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          Orders
        </NavLink>
      </nav>

      {/* Footer / Logout */}
      <div className="sidebar-footer">
        <button className="sidebar-logout" onClick={handleLogout} style={{ width: '100%', cursor: 'pointer', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary, #9ca3af)', padding: '12px 16px', fontSize: '14px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Logout
        </button>
      </div>
    </aside>
  );
};

export default BuyerSidebar;
