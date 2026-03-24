import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { MapPin, Play, Square, AlertCircle, Map as MapIconLucide, Satellite, Route as RouteIcon, Wifi, WifiOff, Camera, Clock3, X, Menu } from 'lucide-react';
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

const getInitials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const size = 240;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, size, size);

        const scale = Math.max(size / image.width, size / image.height);
        const scaledWidth = image.width * scale;
        const scaledHeight = image.height * scale;
        const offsetX = (size - scaledWidth) / 2;
        const offsetY = (size - scaledHeight) / 2;

        context.drawImage(image, offsetX, offsetY, scaledWidth, scaledHeight);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const DriverPage = () => {
  const { user, logout, updateProfile } = useAuth();
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
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: '',
    phone: '',
    avatarUrl: '',
    bio: ''
  });

  const socketRef = useRef(null);
  const watchIdRef = useRef(null);

  // ✅ FIX: Keep refs in sync with state so cleanup/socket callbacks
  // always have fresh values without stale closure problems
  const busRef = useRef(null);
  const isActiveTripRef = useRef(false);

  useEffect(() => { busRef.current = bus; }, [bus]);
  useEffect(() => { isActiveTripRef.current = !!trip; }, [trip]);
  useEffect(() => {
    if (!user) return;

    setProfileForm({
      name: user.name || '',
      phone: user.phone || '',
      avatarUrl: user.avatarUrl || '',
      bio: user.bio || ''
    });
  }, [user]);

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

  const handleProfileSave = async () => {
    setSavingProfile(true);

    try {
      await updateProfile(profileForm);
      setIsEditingProfile(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const openProfileModal = () => {
    setShowHeaderMenu(false);
    setIsEditingProfile(false);
    setShowProfileModal(true);
  };

  const closeProfileModal = () => {
    setShowProfileModal(false);
    setIsEditingProfile(false);
    setProfileForm({
      name: user?.name || '',
      phone: user?.phone || '',
      avatarUrl: user?.avatarUrl || '',
      bio: user?.bio || ''
    });
  };

  const handleProfileImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      setProfileForm((prev) => ({
        ...prev,
        avatarUrl: imageDataUrl
      }));
    } catch (uploadError) {
      setError('Failed to load the selected profile image');
    }
  };

  const handleRemoveProfileImage = () => {
    setProfileForm((prev) => ({
      ...prev,
      avatarUrl: ''
    }));
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
          <button onClick={logout} className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg">Logout</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-slate-900 via-sky-950 to-blue-900 shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={openProfileModal}
              className="w-11 h-11 rounded-full overflow-hidden border-2 border-white/30 shadow-lg hover:scale-105 transition shrink-0"
              title="Open profile"
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-white/15 text-white flex items-center justify-center text-sm font-bold">
                  {getInitials(user?.name)}
                </div>
              )}
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-sky-200">Driver Console</p>
              <h1 className="text-xl md:text-2xl font-bold text-white">Driver Dashboard</h1>
              <p className="text-xs md:text-sm text-sky-100 mt-1">Track trips, share location, and manage your profile.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full ${
              socketConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {socketConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
              {socketConnected ? 'Connected' : 'Reconnecting...'}
            </div>
            <button
              onClick={() => setShowHeaderMenu((prev) => !prev)}
              className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-white text-slate-900 hover:bg-sky-50 transition shadow-sm"
              title="Open menu"
            >
              <Menu size={20} />
            </button>
            {showHeaderMenu && (
              <div className="absolute right-4 top-16 w-48 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                <button
                  onClick={openProfileModal}
                  className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
                >
                  Profile
                </button>
                <button
                  onClick={logout}
                  className="w-full text-left px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 pt-24 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl shadow-md p-5">
            <p className="text-sm font-semibold text-gray-500">Trip Status</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">{trip ? 'On Duty' : 'Ready'}</p>
            <p className="text-sm text-gray-500 mt-1">{trip ? 'Trip is active now' : 'Waiting to start your route'}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-md p-5">
            <p className="text-sm font-semibold text-gray-500">Live Broadcast</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">{isSharing ? 'Online' : 'Offline'}</p>
            <p className="text-sm text-gray-500 mt-1">Passenger updates are {isSharing ? 'being sent live' : 'currently paused'}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-md p-5">
            <p className="text-sm font-semibold text-gray-500">Current Speed</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">{Number(speed || 0).toFixed(1)} km/h</p>
            <p className="text-sm text-gray-500 mt-1">Based on the latest GPS reading</p>
          </div>
          <div className="bg-white rounded-2xl shadow-md p-5">
            <p className="text-sm font-semibold text-gray-500">Route Distance</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">{totalRouteDistance || '--'} km</p>
            <p className="text-sm text-gray-500 mt-1">Estimated full route distance</p>
          </div>
        </div>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle size={20} />
              {error}
            </div>
            <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-md p-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-semibold text-gray-800">{bus.busName}</h2>
              <p className="text-gray-600">Bus Number: {bus.busNumber}</p>
              <p className="text-gray-600">Route: {bus.route?.routeName}</p>
              <p className="text-gray-600">Assigned Driver: {user?.name}</p>
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
          {trip?.startTime && (
            <div className="mt-4 inline-flex items-center gap-2 text-sm text-blue-700 bg-blue-50 px-4 py-2 rounded-xl">
              <Clock3 size={16} />
              Trip started at {new Date(trip.startTime).toLocaleTimeString()}
            </div>
          )}
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
        {showProfileModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl p-6 max-w-xl w-full">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">{isEditingProfile ? 'Edit Profile' : 'My Profile'}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {isEditingProfile
                      ? 'Keep your driver details updated for dispatch and admin visibility.'
                      : 'View your details first, then switch to edit mode when you want to update them.'}
                  </p>
                </div>
                <button onClick={closeProfileModal} className="text-gray-500 hover:text-gray-700">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border">
                  <div className="relative shrink-0">
                    {profileForm.avatarUrl ? (
                      <img src={profileForm.avatarUrl} alt={profileForm.name} className="w-20 h-20 rounded-full object-cover" />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-slate-900 text-white flex items-center justify-center text-2xl font-bold">
                        {getInitials(profileForm.name)}
                      </div>
                    )}
                    {isEditingProfile && (
                      <>
                        <label className="absolute inset-x-0 bottom-0 mx-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-sky-600 text-white shadow-lg hover:bg-sky-700 transition">
                          <Camera size={14} />
                          <input type="file" accept="image/*" className="hidden" onChange={handleProfileImageUpload} />
                        </label>
                        {profileForm.avatarUrl && (
                          <button
                            type="button"
                            onClick={handleRemoveProfileImage}
                            className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white shadow-lg hover:bg-red-600 transition"
                            title="Remove profile picture"
                          >
                            <span className="text-lg leading-none">-</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xl font-semibold text-slate-900">{profileForm.name || 'Driver User'}</p>
                    <p className="text-sm text-slate-500">{user?.email || 'No email available'}</p>
                    <p className="text-xs uppercase tracking-[0.2em] text-sky-600 mt-2">Driver</p>
                  </div>
                </div>

                {isEditingProfile ? (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                      <input
                        type="text"
                        value={profileForm.name}
                        onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Phone</label>
                      <input
                        type="text"
                        value={profileForm.phone}
                        onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Bio</label>
                      <textarea
                        rows="3"
                        value={profileForm.bio}
                        onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
                        placeholder="A short note about you, your shift, or your route experience"
                        className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Full Name</p>
                      <p className="text-sm text-slate-900 mt-1">{profileForm.name || 'Not added yet'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Phone</p>
                      <p className="text-sm text-slate-900 mt-1">{profileForm.phone || 'Not added yet'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Bio</p>
                      <p className="text-sm text-slate-900 mt-1">{profileForm.bio || 'No bio added yet'}</p>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeProfileModal} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold px-4 py-3 rounded-xl transition">
                    Close
                  </button>
                  {isEditingProfile ? (
                    <button type="button" onClick={handleProfileSave} disabled={savingProfile} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-3 rounded-xl transition disabled:opacity-60">
                      {savingProfile ? 'Saving...' : 'Save Profile'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setIsEditingProfile(true)} className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold px-4 py-3 rounded-xl transition">
                      Edit Profile
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DriverPage;
