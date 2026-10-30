import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/admin/Login';
import Register from './pages/admin/Register';
import OrganizerDashboard from './pages/organizer/OrganizerDashboard';
import CreateEvent from './pages/organizer/CreateEvent';
import BrowseEvents from './pages/buyer/BrowseEvents';
import EventDetails from './pages/buyer/EventDetails';
import MyTickets from './pages/buyer/MyTickets';
import AdminDashboard from './pages/admin/AdminDashboard';
import PlatformManagement from './pages/admin/PlatformManagement';
import HashChain from './pages/admin/HashChain';
import ScanTicket from './pages/staff/ScanTicket';
import PrivateRoute from './components/PrivateRoute';

export default function App() {
  return (
    <Routes>
      {/* Auth Routes — public */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Admin Routes — require 'admin' role */}
      <Route
        path="/admin/dashboard"
        element={
          <PrivateRoute allowedRoles={['admin']}>
            <AdminDashboard />
          </PrivateRoute>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <PrivateRoute allowedRoles={['admin']}>
            <PlatformManagement />
          </PrivateRoute>
        }
      />
      <Route
        path="/admin/chain"
        element={
          <PrivateRoute allowedRoles={['admin']}>
            <HashChain />
          </PrivateRoute>
        }
      />

      {/* Organizer Routes — require 'organizer' role */}
      <Route
        path="/organizer/dashboard"
        element={
          <PrivateRoute allowedRoles={['organizer']}>
            <OrganizerDashboard />
          </PrivateRoute>
        }
      />
      <Route
        path="/organizer/create-event"
        element={
          <PrivateRoute allowedRoles={['organizer']}>
            <CreateEvent />
          </PrivateRoute>
        }
      />

      {/* Buyer Routes — require 'buyer' role */}
      <Route
        path="/buyer/events"
        element={
          <PrivateRoute allowedRoles={['buyer']}>
            <BrowseEvents />
          </PrivateRoute>
        }
      />
      <Route
        path="/buyer/events/:id"
        element={
          <PrivateRoute allowedRoles={['buyer']}>
            <EventDetails />
          </PrivateRoute>
        }
      />
      <Route
        path="/buyer/tickets"
        element={
          <PrivateRoute allowedRoles={['buyer']}>
            <MyTickets />
          </PrivateRoute>
        }
      />
      <Route
        path="/buyer/orders"
        element={
          <PrivateRoute allowedRoles={['buyer']}>
            <MyTickets />
          </PrivateRoute>
        }
      />

      {/* Staff Routes — require 'staff' role */}
      <Route
        path="/staff/scan"
        element={
          <PrivateRoute allowedRoles={['staff']}>
            <ScanTicket />
          </PrivateRoute>
        }
      />

      {/* Default — open login page on first visit */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
