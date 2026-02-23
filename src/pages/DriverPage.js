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

const firstStopIcon = new L.divIcon({
  html: '<div style="background:#3B82F6;border:3px solid white;border-radius:50%;width:20px;height:20px;box-shadow:0 2px 6px rgba(59,130,246,0.5);"></div>',
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

const lastStopIcon = new L.divIcon({
  html: '<div style="background:#EF4444;border:3px solid white;border-radius:50%;width:20px;height:20px;box-shadow:0 2px 6px rgba(239,68,68,0.5);"></div>',
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

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

  // ✅ Route segments: array of polyline coordinate arrays, one per stop-to-stop segment
  const [routeSegments, setRouteSegments] = useState([]);
  const [totalRouteDistance, setTotalRouteDistance] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);

  const socketRef = useRef(null);
  const watchIdRef = useRef(null);
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
      if (isActiveTripRef.current && busRef.current) {
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
      stopSharingWithRef();
      if (socketRef.current) socketRef.current.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (bus?.route?.stops) {
      fetchRouteSegments(bus.route.stops);
    }
  }, [bus]);

  /**
   * ✅ FIXED: Fetch route segment-by-segment (stop[0]→stop[1], stop[1]→stop[2], ...)
   * This ensures:
   *   1. The drawn polyline follows EXACTLY the stop order (no reversed/looped paths)
   *   2. Each segment is the shortest road path between two consecutive stops
   *   3. The full route is one-directional (first stop → last stop)
   */
  const fetchRouteSegments = async (stops) => {
    if (!stops || stops.length < 2) return;

    const segments = [];
    let totalDistanceKm = 0;

    // Fetch each consecutive pair of stops as a separate OSRM request
    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i];
      const to = stops[i + 1];

      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${from.location.longitude},${from.location.latitude};${to.location.longitude},${to.location.latitude}?overview=full&geometries=geojson`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.code === 'Ok' && data.routes?.length > 0) {
          const route = data.routes[0];
          // Convert [lng, lat] → [lat, lng] for Leaflet
          const coords = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
          segments.push(coords);
          totalDistanceKm += route.distance / 1000;
        } else {
          // Fallback: straight line between the two stops
          segments.push([
            [from.location.latitude, from.location.longitude],
            [to.location.latitude, to.location.longitude]
          ]);
        }
      } catch (err) {
        console.error(`Error fetching segment ${i} → ${i + 1}:`, err);
        segments.push([
          [from.location.latitude, from.location.longitude],
          [to.location.latitude, to.location.longitude]
        ]);
      }
    }

    setRouteSegments(segments);
    setTotalRouteDistance(totalDistanceKm.toFixed(2));
    console.log(`✅ Route built: ${segments.length} segments, ${totalDistanceKm.toFixed(2)} km total`);
  };

  const fetchBus = async () => {
    try {
      const response = await api.get('/driver/my-bus');
      setBus(response.data.bus);

      try {
        const tripResponse = await api.get('/driver/current-trip');
        if (tripResponse.data.trip) {
          setTrip(tripResponse.data.trip);
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

    let prevPosition = null;
    let prevTimestamp = null;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed: gpsSpeed } = position.coords;

        const locationData = { latitude, longitude, timestamp: new Date() };
        setLocation(locationData);

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

        setSpeed(Math.min(speedKmh, 200).toFixed(1));

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

  const stops = bus.route?.stops || [];

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Driver Dashboard</h1>
            <p className="text-gray-600">Welcome, {user.name}</p>
          </div>
          <div className="flex items-center gap-3">
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

        {/* Bus Info Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-semibold text-gray-800">{bus.busName}</h2>
              <p className="text-gray-600">Bus Number: {bus.busNumber}</p>
              <p className="text-gray-600">Route: {bus.route?.routeName}</p>
              {totalRouteDistance && (
                <p className="text-sm text-blue-600 mt-1 flex items-center gap-1">
                  <RouteIcon size={14} />
                  Total Route: {totalRouteDistance} km ({stops.length} stops)
                </p>
              )}
              {/* ✅ Show route direction clearly */}
              {stops.length >= 2 && (
                <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
                  <span className="inline-block w-3 h-3 bg-blue-500 rounded-full"></span>
                  <span className="font-medium">{stops[0].stopName}</span>
                  <span className="text-gray-400">→</span>
                  <span className="inline-block w-3 h-3 bg-red-500 rounded-full"></span>
                  <span className="font-medium">{stops[stops.length - 1].stopName}</span>
                </div>
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

                  {/* ✅ Draw each segment separately — guarantees stop-aligned, one-direction route */}
                  {routeSegments.map((segmentCoords, index) => (
                    <Polyline
                      key={index}
                      positions={segmentCoords}
                      color="#3B82F6"
                      weight={5}
                      opacity={0.75}
                    />
                  ))}

                  {/* ✅ Render stops with first/last visually distinct */}
                  {stops.map((stop, index) => {
                    const isFirst = index === 0;
                    const isLast = index === stops.length - 1;
                    const icon = isFirst ? firstStopIcon : isLast ? lastStopIcon : routeStopIcon;
                    return (
                      <Marker
                        key={stop._id}
                        position={[stop.location.latitude, stop.location.longitude]}
                        icon={icon}
                      >
                        <Popup>
                          <strong>Stop {index + 1}: {stop.stopName}</strong><br />
                          {stop.stopCode}
                          {isFirst && <><br /><span style={{ color: '#3B82F6', fontWeight: 'bold' }}>🟢 Start</span></>}
                          {isLast && <><br /><span style={{ color: '#EF4444', fontWeight: 'bold' }}>🔴 End</span></>}
                        </Popup>
                      </Marker>
                    );
                  })}

                  <Marker position={[location.latitude, location.longitude]} icon={busIcon}>
                    <Popup>
                      <strong>{bus.busName}</strong><br />
                      Speed: {speed} km/h<br />
                      Status: {isSharing ? 'Live Broadcasting' : 'Offline'}
                    </Popup>
                  </Marker>

                  <SmoothMapFollow center={[location.latitude, location.longitude]} />
                </MapContainer>
              </div>
            ) : (
              /* ✅ Show static route preview even before trip starts */
              <div className="h-96 rounded-lg overflow-hidden border-2 border-gray-200">
                {stops.length >= 2 ? (
                  <MapContainer
                    center={[stops[Math.floor(stops.length / 2)].location.latitude, stops[Math.floor(stops.length / 2)].location.longitude]}
                    zoom={12}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer url={getTileLayerUrl()} attribution={getTileLayerAttribution()} />

                    {routeSegments.map((segmentCoords, index) => (
                      <Polyline
                        key={index}
                        positions={segmentCoords}
                        color="#3B82F6"
                        weight={5}
                        opacity={0.75}
                      />
                    ))}

                    {stops.map((stop, index) => {
                      const isFirst = index === 0;
                      const isLast = index === stops.length - 1;
                      const icon = isFirst ? firstStopIcon : isLast ? lastStopIcon : routeStopIcon;
                      return (
                        <Marker
                          key={stop._id}
                          position={[stop.location.latitude, stop.location.longitude]}
                          icon={icon}
                        >
                          <Popup>
                            <strong>Stop {index + 1}: {stop.stopName}</strong><br />
                            {stop.stopCode}
                            {isFirst && <><br /><span style={{ color: '#3B82F6', fontWeight: 'bold' }}>🟢 Start</span></>}
                            {isLast && <><br /><span style={{ color: '#EF4444', fontWeight: 'bold' }}>🔴 End</span></>}
                          </Popup>
                        </Marker>
                      );
                    })}
                  </MapContainer>
                ) : (
                  <div className="h-full bg-gray-100 flex flex-col items-center justify-center gap-3">
                    <MapPin size={48} className="text-gray-300" />
                    <p className="text-gray-500 font-semibold">Start a trip to see your live location</p>
                    <p className="text-sm text-gray-400">GPS will activate when you start the trip</p>
                  </div>
                )}
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

            {routeSegments.length > 0 && (
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
                    <div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow"></div>
                    <span>Start Stop</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow"></div>
                    <span>End Stop</span>
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

            {stops.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold mb-1">Route Stops ({stops.length})</h2>
                {/* ✅ Direction label */}
                {stops.length >= 2 && (
                  <p className="text-sm text-gray-500 mb-4">
                    {stops[0].stopName} → {stops[stops.length - 1].stopName}
                  </p>
                )}
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {stops.map((stop, index) => {
                    const isFirst = index === 0;
                    const isLast = index === stops.length - 1;
                    return (
                      <div
                        key={stop._id}
                        className={`flex items-center p-3 rounded-lg transition ${
                          isFirst
                            ? 'bg-blue-50 border border-blue-200'
                            : isLast
                            ? 'bg-red-50 border border-red-200'
                            : 'bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        <div className={`text-white rounded-full w-8 h-8 flex items-center justify-center font-semibold mr-3 text-sm shrink-0 ${
                          isFirst ? 'bg-blue-500' : isLast ? 'bg-red-500' : 'bg-gray-400'
                        }`}>
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{stop.stopName}</p>
                          <p className="text-xs text-gray-600">{stop.stopCode}</p>
                        </div>
                        {isFirst && (
                          <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded-full shrink-0">Start</span>
                        )}
                        {isLast && (
                          <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-1 rounded-full shrink-0">End</span>
                        )}
                      </div>
                    );
                  })}
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