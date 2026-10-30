import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function PrivateRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-primary, #0f0f13)',
        color: 'var(--text-secondary, #9ca3af)',
        fontFamily: 'Inter, sans-serif',
        fontSize: '14px',
      }}>
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redirect to the appropriate dashboard for the user's actual role
    const roleHome = {
      admin: '/admin/dashboard',
      organizer: '/organizer/dashboard',
      buyer: '/buyer/events',
      staff: '/staff/scan',
    };
    return <Navigate to={roleHome[user.role] || '/login'} replace />;
  }

  return children;
}
