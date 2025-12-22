import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { MapPin, Navigation, Play, Square, LogOut, AlertCircle } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import api from '../services/api';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Component to update map center
function ChangeMapView({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, 15);
    }
  }, [center, map]);
  return null;
}

const DriverPage = () => {
  const { user, logout } = useAuth();
  const [bus, setBus] = useState(null);
  const [trip, setTrip] = useState(null);
  const [isSharing, setIsSharing] = useState(false);
  const [location, setLocation] = useState(null);
  const [speed, setSpeed] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const socketRef = useRef(null);
  const watchIdRef = useRef(null);
  const token = localStorage.getItem('token');

  useEffect(() => {
    fetchBus();
    socketRef.current = io(process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000');
    
    return () => {
      stopSharing();
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
    // eslint-disable-next-line
  }, []);

  const fetchBus = async () => {
    try {
      const response = await api.get('/driver/my-bus');
      setBus(response.data.bus);
      
      try {
        const tripResponse = await api.get('/driver/current-trip');
        setTrip(tripResponse.data.trip);
      } catch (err) {
        // No active trip
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch bus');
    } finally {
      setLoading(false);
    }
  };

  const startTrip = async () => {
    try {
      const response = await api.post('/driver/start-trip', { busId: bus._id });
      setTrip(response.data.trip);
      startSharing();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to start trip');
    }
  };

  const endTrip = async () => {
    try {
      await api.post('/driver/end-trip', { tripId: trip._id });
      setTrip(null);
      stopSharing();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to end trip');
    }
  };

  const startSharing = () => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      return;
    }

    setIsSharing(true);
    
    socketRef.current.emit('driver:start-sharing', {
      busId: bus._id,
      driverId: user.id
    });

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed: gpsSpeed } = position.coords;
        
        const locationData = { latitude, longitude, timestamp: new Date() };
        setLocation(locationData);
        setSpeed(gpsSpeed ? (gpsSpeed * 3.6).toFixed(1) : 0);

        socketRef.current.emit('driver:location-update', {
          busId: bus._id,
          latitude,
          longitude,
          speed: gpsSpeed ? gpsSpeed * 3.6 : 0
        });

        api.post('/driver/save-location', {
          busId: bus._id,
          latitude,
          longitude,
          speed: gpsSpeed ? gpsSpeed * 3.6 : 0
        }).catch(console.error);
      },
      (error) => setError('Location error: ' + error.message),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  };

  const stopSharing = () => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    
    if (socketRef.current && bus) {
      socketRef.current.emit('driver:stop-sharing', { busId: bus._id });
    }
    
    setIsSharing(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!bus) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">No Bus Assigned</h2>
          <p className="text-gray-600 mb-4">Please contact admin to assign you a bus</p>
          <button onClick={logout} className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg">
            Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Driver Dashboard</h1>
            <p className="text-gray-600">Welcome, {user.name}</p>
          </div>
          <button onClick={logout} className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg">
            <LogOut size={20} />
            Logout
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Error Message */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-center">
            <AlertCircle className="mr-2" size={20} />
            {error}
          </div>
        )}

        {/* Bus Info */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-semibold text-gray-800">{bus.busName}</h2>
              <p className="text-gray-600">Bus Number: {bus.busNumber}</p>
              <p className="text-gray-600">Route: {bus.route?.routeName}</p>
            </div>
            <div className={`px-4 py-2 rounded-full text-white font-semibold ${isSharing ? 'bg-green-500' : 'bg-gray-400'}`}>
              {isSharing ? '● Live' : 'Offline'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Map */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <MapPin className="mr-2 text-blue-600" size={24} />
              Live Location
            </h2>
            {location ? (
              <div className="h-96 rounded-lg overflow-hidden border-2 border-gray-200">
                <MapContainer
                  center={[location.latitude, location.longitude]}
                  zoom={15}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  />
                  <Marker position={[location.latitude, location.longitude]}>
                    <Popup>
                      <strong>{bus.busName}</strong><br />
                      Speed: {speed} km/h
                    </Popup>
                  </Marker>
                  <ChangeMapView center={[location.latitude, location.longitude]} />
                </MapContainer>
              </div>
            ) : (
              <div className="h-96 bg-gray-100 rounded-lg flex items-center justify-center">
                <p className="text-gray-500">Location not available. Start trip to see map.</p>
              </div>
            )}
            
            {location && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Latitude</p>
                  <p className="font-mono font-semibold">{location.latitude.toFixed(6)}</p>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Longitude</p>
                  <p className="font-mono font-semibold">{location.longitude.toFixed(6)}</p>
                </div>
                <div className="bg-green-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Speed</p>
                  <p className="font-semibold text-green-700">{speed} km/h</p>
                </div>
                <div className="bg-purple-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Status</p>
                  <p className="font-semibold text-purple-700">{isSharing ? 'Broadcasting' : 'Offline'}</p>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="space-y-6">
            {/* Trip Controls */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">Trip Controls</h2>
              
              {!trip ? (
                <button onClick={startTrip} className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-lg flex items-center justify-center transition">
                  <Play className="mr-2" size={20} />
                  Start Trip
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold">Trip Active</span>
                      <span className="text-sm text-gray-600">
                        {new Date(trip.startTime).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">Route: {trip.route?.routeName}</div>
                  </div>
                  
                  <button onClick={endTrip} className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-6 rounded-lg flex items-center justify-center transition">
                    <Square className="mr-2" size={20} />
                    End Trip
                  </button>
                </div>
              )}
            </div>

            {/* Route Stops */}
            {bus.route?.stops && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Route Stops</h2>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {bus.route.stops.map((stop, index) => (
                    <div key={stop._id} className="flex items-center p-3 bg-gray-50 rounded-lg">
                      <div className="bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center font-semibold mr-3 text-sm">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-semibold">{stop.stopName}</p>
                        <p className="text-xs text-gray-600">{stop.stopCode}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriverPage;