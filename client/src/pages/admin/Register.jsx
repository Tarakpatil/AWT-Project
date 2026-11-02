import { useState } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from "../../context/AuthContext";

const Register = () => {
  const [role, setRole] = useState('buyer');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { register } = useAuth();
  const navigate = useNavigate();

  const showPasswordError = confirmPassword.length > 0 && password !== confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (showPasswordError) return;

    setError('');
    setLoading(true);

    try {
      const user = await register({ name: fullName, email, password, role });

      // Redirect based on role after successful registration
      const roleHome = {
        admin: '/admin/dashboard',
        organizer: '/organizer/dashboard',
        buyer: '/buyer/events',
        staff: '/staff/scan',
      };
      navigate(roleHome[user.role] || '/buyer/events', { replace: true });
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-wrapper">
      <div className="header">
        <h1 className="title">Register</h1>
      </div>
      <div className="register-card">
        <div className="card-header">
          <h2>Create your account</h2>
          <p>Enter your details to register</p>
        </div>

        {error && (
          <div className="error-banner" style={{
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

        <form onSubmit={handleSubmit}>
          <div className="input-group role-group">
            <label>I AM A</label>
            <div className="role-toggle-container">
              <button type="button" className={`role-btn ${role === 'buyer' ? 'active' : ''}`}
                onClick={() => setRole('buyer')} disabled={loading}>Buyer
              </button>
              <button type="button" className={`role-btn ${role === 'organizer' ? 'active' : ''}`}
                onClick={() => setRole('organizer')} disabled={loading}>Organizer
              </button>
              <button type="button" className="role-button-disabled" disabled>
                Staff
              </button>
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="fullName">Full Name</label>
            <input type="text" id="fullName" placeholder="enter name" value={fullName} onChange={(e) => setFullName(e.target.value)} required disabled={loading} />
          </div>
          <div className="input-group">
            <label htmlFor="email">Email Address</label>
            <input type="email" id="email" placeholder="enter email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loading} />
          </div>
          <div className="input-group">
            <label htmlFor="password">Password</label>
            <input type="password" id="password" placeholder="******" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loading} />
          </div>
          <div className={`input-group ${showPasswordError ? 'has-error' : ''}`}>
            <label htmlFor="confirmPassword">Confirm Password</label>
            <div className="input-with-icon">
              <input type="password" id="confirmPassword" placeholder="******" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required disabled={loading} />
              {showPasswordError && (
                <span className="error-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                </span>
              )}
            </div>
            {showPasswordError && (
              <p className="error-message">Passwords do not match</p>
            )}
          </div>
          <button type="submit" className="submit-button" disabled={loading || showPasswordError}>
            {loading ? 'Creating Account…' : 'Create Account'}
          </button>
        </form>
        <div className="login-footer">
          <p>Already have an account? <Link to='/login'>Log In</Link></p>
        </div>
      </div>
    </div>
  );
};

export default Register;
