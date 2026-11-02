import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../../components/Sidebar';
import './organizer.css';

const CreateEvent = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    eventName: '',
    description: '',
    category: '',
    date: '',
    time: '',
    venue: ''
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSave = (e) => {
    e.preventDefault();
    console.log('Saving event...', formData);
    // Add API call here later
    navigate('/organizer/dashboard');
  };

  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content form-page-layout">
        <div className="page-header-fixed">
          <h1 className="page-title">Create Event</h1>
        </div>

        <div className="scrollable-content">
          <div className="form-container">
            {/* Basic Info Card */}
            <div className="form-card">
              <h2 className="form-card-title">Basic Info</h2>
              
              <div className="input-group">
                <label htmlFor="eventName">Event Name</label>
                <input 
                  type="text" 
                  id="eventName" 
                  name="eventName" 
                  placeholder="e.g., Cyberpunk Synthwave Festival 2045" 
                  value={formData.eventName}
                  onChange={handleChange}
                />
              </div>

              <div className="input-group">
                <label htmlFor="description">Description</label>
                <textarea 
                  id="description" 
                  name="description" 
                  placeholder="Provide details about the event..." 
                  rows="4"
                  value={formData.description}
                  onChange={handleChange}
                ></textarea>
              </div>

              <div className="input-group">
                <label htmlFor="category">Category</label>
                <div className="select-wrapper">
                  <select 
                    id="category" 
                    name="category" 
                    value={formData.category}
                    onChange={handleChange}
                  >
                    <option value="" disabled hidden>Select a category</option>
                    <option value="music">Music Festival</option>
                    <option value="tech">Tech Conference</option>
                    <option value="art">Art Exhibition</option>
                    <option value="workshop">Workshop</option>
                  </select>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="select-icon">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </div>
            </div>

            {/* Date & Venue Card */}
            <div className="form-card">
              <h2 className="form-card-title">Date & Venue</h2>
              
              <div className="form-row">
                <div className="input-group half-width">
                  <label htmlFor="date">Date</label>
                  <input 
                    type="date" 
                    id="date" 
                    name="date" 
                    value={formData.date}
                    onChange={handleChange}
                  />
                </div>
                <div className="input-group half-width">
                  <label htmlFor="time">Time</label>
                  <input 
                    type="time" 
                    id="time" 
                    name="time" 
                    value={formData.time}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="venue">Venue / Location</label>
                <div className="input-with-icon-left">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="input-icon">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                  </svg>
                  <input 
                    type="text" 
                    id="venue" 
                    name="venue" 
                    placeholder="Enter venue name or address" 
                    value={formData.venue}
                    onChange={handleChange}
                  />
                </div>
              </div>
            </div>
            
            {/* Spacer for bottom bar */}
            <div style={{ height: '80px' }}></div>
          </div>
        </div>

        {/* Fixed Bottom Bar */}
        <div className="form-bottom-bar">
          <div className="bottom-bar-content">
            <button 
              type="button" 
              className="btn-cancel" 
              onClick={() => navigate('/organizer/dashboard')}
            >
              Cancel
            </button>
            <button 
              type="button" 
              className="btn-save" 
              onClick={handleSave}
            >
              Save Event
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CreateEvent;
