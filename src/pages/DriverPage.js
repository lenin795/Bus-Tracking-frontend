import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { MapPin, Play, Square, LogOut, AlertCircle, Map as MapIconLucide, Satellite, Route as RouteIcon, Wifi, WifiOff } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import api from '../services/api';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const busIcon = new L.divIcon({
  html: '<div style="background:#3B82F6;border-radius:50%;width:35px;height:35px;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);"><span style="color:white;font-size:22px;">🚌</span></div>',
  className: '',
  iconSize: [35, 35],
  iconAnchor: [17, 17]
});

const routeStopIcon = new L.divIcon({
  html: '<div style="background:#10B981;border:2px solid white;border-radius:50%;width:16px;height:16px;box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>',
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

// ✅ FIX: Use panTo instead of setView so the map slides smoothly
// instead of jumping/resetting zoom on every GPS update
function SmoothMapFollow({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.panTo(center, { animate: true, duration: 0.8 });
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
  const [mapType, setMapType] = useState('street');
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [totalRouteDistance, setTotalRouteDistance] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);

  const socketRef = useRef(null);
  const watchIdRef = useRef(null);

  // ✅ FIX: Keep refs in sync with state so cleanup/socket callbacks
  // always have fresh values without stale closure problems
  const busRef = useRef(null);
  const isActiveTripRef = useRef(false);

  useEffect(() => { busRef.current = bus; }, [bus]);
  useEffect(() => { isActiveTripRef.current = !!trip; }, [trip]);

  useEffect(() => {
    fetchBus();

    const SOCKET_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    socketRef.current.on('connect', () => {
      console.log('✅ Socket connected:', socketRef.current.id);
      setSocketConnected(true);

      // ✅ FIX: On reconnect, re-announce sharing if trip is active
      // Uses ref so this always has the latest bus/trip state
      if (isActiveTripRef.current && busRef.current) {
        console.log('🔄 Reconnected — resuming location sharing for bus:', busRef.current._id);
        socketRef.current.emit('driver:start-sharing', {
          busId: busRef.current._id,
          driverId: user.id
        });
      }
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('❌ Socket disconnected:', reason);
      setSocketConnected(false);
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('🔴 Socket connection error:', error.message);
      setSocketConnected(false);
    });

    socketRef.current.on('driver:sharing-started', (data) => {
      console.log('✅ Sharing confirmed by server:', data);
    });

    return () => {
      // ✅ FIX: stopSharing reads from ref, not the stale closure `bus`
      stopSharingWithRef();
      if (socketRef.current) socketRef.current.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (bus?.route?.stops) {
      fetchCompleteRouteWithRoads(bus.route.stops);
    }
  }, [bus]);

  const fetchCompleteRouteWithRoads = async (stops) => {
    try {
      if (stops.length < 2) return;

      const coordinates = stops
        .map(stop => `${stop.location.longitude},${stop.location.latitude}`)
        .join(';');

      const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.code === 'Ok' && data.routes?.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
        setRouteCoordinates(coords);
        setTotalRouteDistance((route.distance / 1000).toFixed(2));
      } else {
        setRouteCoordinates(stops.map(stop => [stop.location.latitude, stop.location.longitude]));
      }
    } catch (error) {
      console.error('Error fetching route:', error);
      setRouteCoordinates(stops.map(stop => [stop.location.latitude, stop.location.longitude]));
    }
  };

  const fetchBus = async () => {
    try {
      const response = await api.get('/driver/my-bus');
      setBus(response.data.bus);

      try {
        const tripResponse = await api.get('/driver/current-trip');
        if (tripResponse.data.trip) {
          setTrip(tripResponse.data.trip);
          // Resume sharing if there's already an active trip (e.g. page refresh)
          startSharing(response.data.bus);
        }
      } catch {
        // No active trip — normal
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
      startSharing(bus);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to start trip');
    }
  };

  const endTrip = async () => {
    try {
      await api.post('/driver/end-trip', { tripId: trip._id });
      setTrip(null);
      stopSharingWithRef();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to end trip');
    }
  };

  // ✅ FIX: Accept bus as param so it works even before state update settles
  const startSharing = (busData) => {
    const targetBus = busData || busRef.current;
    if (!targetBus) return;

    if (!navigator.geolocation) {
      setError('Geolocation not supported by your browser');
      return;
    }

    setIsSharing(true);

    socketRef.current.emit('driver:start-sharing', {
      busId: targetBus._id,
      driverId: user.id
    });

    console.log('📍 Started sharing location for bus:', targetBus._id);

    // ✅ FIX: Track previous position to calculate speed when GPS doesn't provide it
    let prevPosition = null;
    let prevTimestamp = null;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed: gpsSpeed } = position.coords;

        const locationData = { latitude, longitude, timestamp: new Date() };
        setLocation(locationData);

        // ✅ FIX: Calculate speed from position delta if GPS doesn't provide it
        let speedKmh = gpsSpeed ? gpsSpeed * 3.6 : 0;
        if (speedKmh === 0 && prevPosition && prevTimestamp) {
          const timeDeltaHours = (position.timestamp - prevTimestamp) / 3600000;
          if (timeDeltaHours > 0) {
            const R = 6371;
            const dLat = (latitude - prevPosition.latitude) * Math.PI / 180;
            const dLon = (longitude - prevPosition.longitude) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(prevPosition.latitude * Math.PI / 180) *
              Math.cos(latitude * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
            const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            speedKmh = dist / timeDeltaHours;
          }
        }

        prevPosition = { latitude, longitude };
        prevTimestamp = position.timestamp;

        setSpeed(Math.min(speedKmh, 200).toFixed(1)); // Cap at 200 km/h for display sanity

        if (socketRef.current?.connected) {
          socketRef.current.emit('driver:location-update', {
            busId: targetBus._id,
            latitude,
            longitude,
            speed: speedKmh,
            heading: position.coords.heading || 0
          });
        }

        api.post('/driver/save-location', {
          busId: targetBus._id,
          latitude,
          longitude,
          speed: speedKmh
        }).catch(console.error);
      },
      (err) => {
        console.error('Location error:', err);
        setError('Location error: ' + err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  // ✅ FIX: Uses busRef.current so cleanup always has the right bus ID,
  // even when called from useEffect cleanup where `bus` state would be stale
  const stopSharingWithRef = () => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    const currentBus = busRef.current;
    if (socketRef.current && currentBus) {
      socketRef.current.emit('driver:stop-sharing', { busId: currentBus._id });
      console.log('🛑 Stopped sharing for bus:', currentBus._id);
    }

    setIsSharing(false);
  };

  const toggleMapType = () => setMapType(prev => prev === 'street' ? 'satellite' : 'street');

  const getTileLayerUrl = () =>
    mapType === 'satellite'
      ? 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  const getTileLayerAttribution = () =>
    mapType === 'satellite'
      ? '&copy; <a href="https://www.google.com/maps">Google Maps</a>'
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

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
          <button onClick={logout} className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg">Logout</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Driver Dashboard</h1>
            <p className="text-gray-600">Welcome, {user.name}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* ✅ NEW: Socket connection status indicator */}
            <div className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full ${
              socketConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {socketConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
              {socketConnected ? 'Connected' : 'Reconnecting...'}
            </div>
            <button onClick={logout} className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg">
              <LogOut size={20} />
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle size={20} />
              {error}
            </div>
            <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-semibold text-gray-800">{bus.busName}</h2>
              <p className="text-gray-600">Bus Number: {bus.busNumber}</p>
              <p className="text-gray-600">Route: {bus.route?.routeName}</p>
              {totalRouteDistance && (
                <p className="text-sm text-blue-600 mt-1 flex items-center gap-1">
                  <RouteIcon size={14} />
                  Total Route: {totalRouteDistance} km
                </p>
              )}
            </div>
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-white font-semibold ${
              isSharing ? 'bg-green-500' : 'bg-gray-400'
            }`}>
              {isSharing && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                </span>
              )}
              {isSharing ? 'Live' : 'Offline'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* MAP PANEL */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <MapPin className="text-blue-600" size={24} />
                Live Location
              </h2>
              <button
                onClick={toggleMapType}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                {mapType === 'street'
                  ? <><Satellite size={18} /><span className="text-sm font-semibold">Satellite</span></>
                  : <><MapIconLucide size={18} /><span className="text-sm font-semibold">Street</span></>}
              </button>
            </div>

            {location ? (
              <div className="h-96 rounded-lg overflow-hidden border-2 border-gray-200">
                <MapContainer
                  center={[location.latitude, location.longitude]}
                  zoom={15}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer url={getTileLayerUrl()} attribution={getTileLayerAttribution()} />

                  {routeCoordinates.length > 0 && (
                    <Polyline positions={routeCoordinates} color="#3B82F6" weight={5} opacity={0.7} />
                  )}

                  {bus.route?.stops?.map((stop, index) => (
                    <Marker
                      key={stop._id}
                      position={[stop.location.latitude, stop.location.longitude]}
                      icon={routeStopIcon}
                    >
                      <Popup>
                        <strong>Stop {index + 1}: {stop.stopName}</strong><br />
                        {stop.stopCode}
                      </Popup>
                    </Marker>
                  ))}

                  {/* ✅ Bus marker position updates automatically as `location` state changes */}
                  <Marker position={[location.latitude, location.longitude]} icon={busIcon}>
                    <Popup>
                      <strong>{bus.busName}</strong><br />
                      Speed: {speed} km/h<br />
                      Status: {isSharing ? 'Live Broadcasting' : 'Offline'}
                    </Popup>
                  </Marker>

                  {/* ✅ FIX: Smooth pan instead of jarring setView + zoom reset */}
                  <SmoothMapFollow center={[location.latitude, location.longitude]} />
                </MapContainer>
              </div>
            ) : (
              <div className="h-96 bg-gray-100 rounded-lg flex flex-col items-center justify-center gap-3">
                <MapPin size={48} className="text-gray-300" />
                <p className="text-gray-500 font-semibold">Start a trip to see your live location</p>
                <p className="text-sm text-gray-400">GPS will activate when you start the trip</p>
              </div>
            )}

            {location && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Latitude</p>
                  <p className="font-mono font-semibold text-sm">{location.latitude.toFixed(6)}</p>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Longitude</p>
                  <p className="font-mono font-semibold text-sm">{location.longitude.toFixed(6)}</p>
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

            {routeCoordinates.length > 0 && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs font-semibold text-gray-700 mb-2">Map Legend:</p>
                <div className="flex flex-wrap gap-4 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-1 bg-blue-500 rounded"></div>
                    <span>Road Route ({totalRouteDistance || '?'} km)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
                    <span>Your Bus</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <span>Stops</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* CONTROLS PANEL */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">Trip Controls</h2>

              {!trip ? (
                <button
                  onClick={startTrip}
                  className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-4 px-6 rounded-lg flex items-center justify-center gap-2 transition text-lg"
                >
                  <Play size={22} />
                  Start Trip
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="bg-blue-50 border-2 border-blue-200 p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-blue-800">Trip Active</span>
                      <span className="text-sm text-gray-600">
                        Started {new Date(trip.startTime).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">Route: {trip.route?.routeName}</p>
                    {isSharing && (
                      <div className="mt-2 flex items-center gap-2 text-green-600 text-sm font-semibold">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        Broadcasting to passengers
                      </div>
                    )}
                  </div>

                  <button
                    onClick={endTrip}
                    className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-4 px-6 rounded-lg flex items-center justify-center gap-2 transition text-lg"
                  >
                    <Square size={22} />
                    End Trip
                  </button>
                </div>
              )}
            </div>

            {bus.route?.stops && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Route Stops ({bus.route.stops.length})</h2>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {bus.route.stops.map((stop, index) => (
                    <div key={stop._id} className="flex items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
                      <div className="bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center font-semibold mr-3 text-sm shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{stop.stopName}</p>
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