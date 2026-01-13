import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { MapPin, Navigation, Play, Square, LogOut, AlertCircle, Map as MapIconLucide, Satellite } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
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

// Custom bus icon
const busIcon = new L.divIcon({
  html: '<div style="background: #3B82F6; border-radius: 50%; width: 35px; height: 35px; display: flex; align-items: center; justify-center; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"><span style="color: white; font-size: 22px;">🚌</span></div>',
  className: '',
  iconSize: [35, 35],
  iconAnchor: [17, 17]
});

// Route stop icon
const routeStopIcon = new L.divIcon({
  html: '<div style="background: #10B981; border: 2px solid white; border-radius: 50%; width: 16px; height: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>',
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
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
  const [mapType, setMapType] = useState('street'); // 'street' or 'satellite'
  const [routeCoordinates, setRouteCoordinates] = useState([]);

  const socketRef = useRef(null);
  const watchIdRef = useRef(null);

  useEffect(() => {
    fetchBus();
    
    // Initialize Socket.IO
    const SOCKET_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    socketRef.current.on('connect', () => {
      console.log('✅ Socket connected:', socketRef.current.id);
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('❌ Socket disconnected:', reason);
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('🔴 Socket connection error:', error.message);
    });

    socketRef.current.on('driver:sharing-started', (data) => {
      console.log('✅ Sharing started confirmed:', data);
    });
    
    return () => {
      stopSharing();
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
    // eslint-disable-next-line
  }, []);

  // Generate route coordinates when bus is loaded
  useEffect(() => {
    if (bus?.route?.stops) {
      const coords = bus.route.stops.map(stop => [
        stop.location.latitude,
        stop.location.longitude
      ]);
      setRouteCoordinates(coords);
    }
  }, [bus]);

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

    console.log('📍 Started sharing location for bus:', bus._id);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed: gpsSpeed } = position.coords;
        
        const locationData = { latitude, longitude, timestamp: new Date() };
        setLocation(locationData);
        
        const speedKmh = gpsSpeed ? (gpsSpeed * 3.6) : 0;
        setSpeed(speedKmh.toFixed(1));

        // Emit to Socket.IO
        socketRef.current.emit('driver:location-update', {
          busId: bus._id,
          latitude,
          longitude,
          speed: speedKmh,
          heading: position.coords.heading || 0
        });

        console.log('📍 Location sent:', latitude, longitude, 'Speed:', speedKmh.toFixed(1), 'km/h');

        // Save to database
        api.post('/driver/save-location', {
          busId: bus._id,
          latitude,
          longitude,
          speed: speedKmh
        }).catch(console.error);
      },
      (error) => {
        console.error('Location error:', error);
        setError('Location error: ' + error.message);
      },
      { 
        enableHighAccuracy: true, 
        timeout: 5000, 
        maximumAge: 0 
      }
    );
  };

  const stopSharing = () => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    
    if (socketRef.current && bus) {
      socketRef.current.emit('driver:stop-sharing', { busId: bus._id });
      console.log('🛑 Stopped sharing location for bus:', bus._id);
    }
    
    setIsSharing(false);
  };

  const toggleMapType = () => {
    setMapType(prev => prev === 'street' ? 'satellite' : 'street');
  };

  const getTileLayerUrl = () => {
    if (mapType === 'satellite') {
      return 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
    } else {
      return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    }
  };

  const getTileLayerAttribution = () => {
    if (mapType === 'satellite') {
      return '&copy; <a href="https://www.google.com/maps">Google Maps</a>';
    } else {
      return '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    }
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
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold flex items-center">
                <MapPin className="mr-2 text-blue-600" size={24} />
                Live Location
              </h2>
              <button
                onClick={toggleMapType}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
                title={mapType === 'street' ? 'Switch to Satellite View' : 'Switch to Street View'}
              >
                {mapType === 'street' ? (
                  <>
                    <Satellite size={18} />
                    <span className="text-sm font-semibold">Satellite</span>
                  </>
                ) : (
                  <>
                    <MapIconLucide size={18} />
                    <span className="text-sm font-semibold">Street</span>
                  </>
                )}
              </button>
            </div>
            {location ? (
              <div className="h-96 rounded-lg overflow-hidden border-2 border-gray-200">
                <MapContainer
                  center={[location.latitude, location.longitude]}
                  zoom={15}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    url={getTileLayerUrl()}
                    attribution={getTileLayerAttribution()}
                  />
                  
                  {/* Route Line */}
                  {routeCoordinates.length > 0 && (
                    <Polyline
                      positions={routeCoordinates}
                      color="#3B82F6"
                      weight={4}
                      opacity={0.6}
                      dashArray="10, 10"
                    />
                  )}
                  
                  {/* Route Stops */}
                  {bus.route?.stops?.map((stop) => (
                    <Marker
                      key={stop._id}
                      position={[stop.location.latitude, stop.location.longitude]}
                      icon={routeStopIcon}
                    >
                      <Popup>
                        <strong>{stop.stopName}</strong><br />
                        {stop.stopCode}
                      </Popup>
                    </Marker>
                  ))}
                  
                  {/* Current Bus Position */}
                  <Marker position={[location.latitude, location.longitude]} icon={busIcon}>
                    <Popup>
                      <strong>{bus.busName}</strong><br />
                      Speed: {speed} km/h<br />
                      Status: {isSharing ? 'Live Broadcasting' : 'Offline'}
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
                    <div key={stop._id} className="flex items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
                      <div className="bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center font-semibold mr-3 text-sm">
                        {index + 1}
                      </div>
                      <div className="flex-1">
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